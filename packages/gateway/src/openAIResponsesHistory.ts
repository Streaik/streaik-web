import type { InferUIMessageChunk } from 'ai';
import { createParser } from 'eventsource-parser';
import { asRecord } from './directMetrics.ts';
import { GatewayError } from './index.ts';
import type { ChatMessage } from './index.ts';

type Part = ChatMessage['parts'][number];
type Chunk = InferUIMessageChunk<ChatMessage>;
type Item = Record<string, unknown>;
const records = (values: unknown[]): Item[] => values.map(asRecord).filter((item): item is Item => item !== undefined);
const replayKey = 'responsesReplay';
const hostedKey = 'responsesHosted';
type Replay = { model: string; items: Item[] };

export function isOpenAIHostedTool(part: Part) {
  return 'toolCallId' in part && part.providerExecuted === true && !part.approval && part.callProviderMetadata?.openai?.[hostedKey] === true;
}

function readReplay(part: Part) {
  const metadata = 'toolCallId' in part ? isOpenAIHostedTool(part) ? part.resultProviderMetadata : undefined
    : part.type === 'text' || part.type === 'reasoning' ? part.providerMetadata : undefined;
  const replay = asRecord(metadata?.openai?.[replayKey]);
  if (typeof replay?.model !== 'string' || !Array.isArray(replay.items)) return;
  return { model: replay.model, items: records(replay.items) };
}

/** These UI projections and opaque metadata are for native OpenAI Responses only. */
export function apiChatResponsesHistory(messages: ChatMessage[], model: unknown, metadata: unknown) {
  const compatible = typeof model === 'string' && model.startsWith('openai/') && isOpenAIMultiAgent(metadata);
  return messages.flatMap(message => {
    const parts = message.parts.flatMap((part): Part[] => {
      if (part.type.startsWith('data-')) return [];
      const replay = readReplay(part);
      if (isOpenAIHostedTool(part)) return compatible && (!replay || replay.model === model) ? [part] : [];
      if (replay && (!compatible || replay.model !== model) && (part.type === 'text' || part.type === 'reasoning')) {
        return [{ ...part, providerMetadata: withoutReplay(part.providerMetadata) }];
      }
      return [part];
    });
    return parts.length === message.parts.length && parts.every((part, i) => part === message.parts[i]) ? [message]
      : parts.some(part => part.type !== 'step-start') ? [{ ...message, parts }] : [];
  });
}

function withoutReplay(metadata: Extract<Part, { type: 'text' }>['providerMetadata']) {
  if (!metadata?.openai || !(replayKey in metadata.openai)) return metadata;
  const { [replayKey]: _replay, ...openai } = metadata.openai;
  return { ...metadata, openai };
}

export function isOpenAIMultiAgent(providerMetadata: unknown) {
  return asRecord(asRecord(asRecord(providerMetadata)?.openai)?.multi_agent)?.enabled === true;
}

export function openAIResponseAgent(item?: Item) {
  const name = asRecord(item?.agent)?.agent_name;
  return typeof name === 'string' && name.length ? name : '/root';
}

const collaboration = new Set(['multi_agent_call', 'multi_agent_call_output', 'agent_message']);
const activity = (item: Item) => collaboration.has(String(item.type)) || item.type === 'web_search_call';
const internalMessage = (item: Item) => (item.type === 'message' || item.type === 'reasoning') && openAIResponseAgent(item) !== '/root';

function jsonObject(value: unknown) {
  if (typeof value !== 'string') return;
  try { return asRecord(JSON.parse(value)); } catch { return; }
}

function routingFields(value: Item | undefined) {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([key, field]) =>
    ['task_name', 'target', 'timeout_ms', 'timed_out', 'fork_turns'].includes(key) && ['string', 'number', 'boolean'].includes(typeof field)));
}

type ActivityResult = Extract<Chunk, { type: 'tool-output-available' }>;
const replayMetadata = (replay: Replay) => ({ [replayKey]: replay }) as unknown as NonNullable<ActivityResult['providerMetadata']>['openai'];

/** Only the native Responses transport needs the raw SSE tap. Other routes keep their original codecs. */
export function openAIResponsesCapture(model: string) {
  const indexed = new Map<number, Item>();
  const ids = new Map<string, Item>();
  const textSeen = new Set<string>();
  const added = new Set<string>();
  const done = new Set<string>();
  const pending: Chunk[] = [];
  let write = (chunk: Chunk) => { pending.push(chunk); };
  const tools = new Map<string, { available: boolean; input?: string; output?: ActivityResult }>();
  let fallback: Replay | undefined;

  function observeTool(item: Item, finished: boolean, terminal = false) {
    const search = item.type === 'web_search_call';
    const action = item.type === 'multi_agent_call' || item.type === 'multi_agent_call_output';
    if (!search && !action) return;
    const toolCallId = search ? item.id : item.call_id;
    const toolName = search ? 'web_search' : item.action;
    if (typeof toolCallId !== 'string' || typeof toolName !== 'string' || !toolCallId || !toolName) return;
    const agent = openAIResponseAgent(item);
    const call = { toolCallId, dynamic: true, providerExecuted: true } as const;
    let state = tools.get(toolCallId);
    const providerMetadata = { openai: { [hostedKey]: true, agent } };
    if (!state) {
      tools.set(toolCallId, state = { available: false });
      if (!finished) write({ type: 'tool-input-start', ...call, toolName, providerMetadata });
    }
    if (!finished) return;
    let inputChanged = false;
    if (!state.available || item.type !== 'multi_agent_call_output') {
      const { type, query, queries, url, pattern } = asRecord(item.action) ?? {};
      const input = { agent, ...(search ? { type, query, queries, url, pattern } : routingFields(jsonObject(item.arguments))) };
      const key = JSON.stringify(input);
      if (state.input !== key) {
        write({ type: 'tool-input-available', ...call, toolName, input, providerMetadata });
        state.input = key;
        inputChanged = true;
      }
      state.available = true;
    }
    if (item.type === 'multi_agent_call_output' || search || terminal && !state.output) {
      const detail = search ? {} : routingFields(jsonObject(records(Array.isArray(item.output) ? item.output : []).find(part => part.type === 'output_text')?.text));
      const output = { ...detail, status: search ? (item.status === 'searching' || item.status === 'in_progress' ? 'stopped' : item.status)
        : item.type === 'multi_agent_call_output' ? 'completed' : 'no_result', ...(item.status === 'failed' && { isError: true }) };
      if (!state.output || JSON.stringify(output) !== JSON.stringify(state.output.output)) {
        state.output = { type: 'tool-output-available', ...call, output };
        inputChanged = true;
      }
    }
    if (inputChanged && state.output) write(state.output);
  }

  return {
    tap(response: Response) {
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) return response;
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      let reader: (bytes: Uint8Array) => void;
      let finish: () => void;
      const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        start(controller) {
          const send = (data: string, event?: string) => controller.enqueue(encoder.encode(
            `${event ? `event: ${event}\n` : ''}${data.split('\n').map(line => `data: ${line}\n`).join('')}\n`));
          const emit = (frame: Item) => send(JSON.stringify(frame));
          const missingText = (item: Item, output_index: number) => {
            const item_id = item.id;
            if (item.type !== 'message' || item.role !== 'assistant' || internalMessage(item) || typeof item_id !== 'string' || !Array.isArray(item.content)) return;
            for (const [content_index, value] of item.content.entries()) {
              const part = asRecord(value);
              const key = JSON.stringify([item_id, content_index]);
              if (part?.type !== 'output_text' || typeof part.text !== 'string' || !part.text || textSeen.has(key)) continue;
              textSeen.add(key);
              emit({ type: 'response.output_text.delta', item_id, output_index, content_index, delta: part.text, logprobs: [] });
            }
          };
          const parser = createParser({ onEvent(event) {
            const forward = () => send(event.data, event.event);
            let frame: Item | undefined;
            try { frame = asRecord(JSON.parse(event.data)); } catch { forward(); return; }
            if (!frame || typeof frame.type !== 'string') { forward(); return; }
            const type = frame.type;
            const response = asRecord(frame.response);
            const index = typeof frame.output_index === 'number' ? frame.output_index : undefined;
            const streamed = asRecord(frame.item);
            let item = typeof frame.item_id === 'string' ? ids.get(frame.item_id) : undefined;
            item ??= index === undefined ? undefined : indexed.get(index);
            if (streamed && index !== undefined && (type === 'response.output_item.added' || type === 'response.output_item.done')) {
              const agent = streamed.agent ?? frame.agent ?? item?.agent;
              item = agent == null ? { ...streamed } : { ...streamed, agent };
              indexed.set(index, item);
              if (typeof item.id === 'string') {
                ids.set(item.id, item);
                if (type === 'response.output_item.added') added.add(item.id);
                else {
                  done.add(item.id);
                  if (!added.has(item.id) && item.type === 'message' && item.role === 'assistant' && !internalMessage(item)) {
                    emit({ type: 'response.output_item.added', output_index: index, item: { ...item, content: [], status: 'in_progress' } });
                    added.add(item.id);
                  }
                  if (added.has(item.id)) missingText(item, index);
                }
              }
              // The output item only contains a result on done; give the actual action the visible slot.
              if (item.type !== 'multi_agent_call_output' || type === 'response.output_item.done')
                observeTool(item, type === 'response.output_item.done');
            }
            const agent = frame.agent == null ? openAIResponseAgent(item) : openAIResponseAgent(frame);
            if (type === 'response.output_text.delta' && agent === '/root' && typeof frame.item_id === 'string')
              textSeen.add(JSON.stringify([frame.item_id, frame.content_index]));
            if (response && (type === 'response.completed' || type === 'response.incomplete') && Array.isArray(response.output)) {
              const items = records(response.output).map(entry => {
                const agent = typeof entry.id === 'string' ? ids.get(entry.id)?.agent : undefined;
                return entry.agent == null && agent != null ? { ...entry, agent } : entry;
              });
              const results = new Set(items.filter(entry => entry.type === 'multi_agent_call_output').map(entry => entry.call_id));
              for (const item of items) observeTool(item, true, !results.has(item.call_id));
              for (const [output_index, entry] of items.entries()) {
                if (typeof entry.id !== 'string' || done.has(entry.id) || internalMessage(entry)
                  || !(entry.type === 'message' && entry.role === 'assistant' || entry.type === 'function_call')) continue;
                if (!added.has(entry.id)) emit({ type: 'response.output_item.added', output_index, item: { ...entry, status: 'in_progress',
                  ...(entry.type === 'message' ? { content: [] } : { arguments: '' }) } });
                missingText(entry, output_index);
                emit({ type: 'response.output_item.done', output_index, item: entry });
              }
              if (type === 'response.completed' && items.length) {
                const replay = { model, items };
                const anchor = [...tools.values()].findLast(tool => tool.output)?.output;
                if (anchor) write({ ...anchor, providerMetadata: { openai: replayMetadata(replay) } });
                else fallback = replay;
              }
              // The SDK operates on the visible root transcript. Hosted actions use standard UI tool chunks.
              send(JSON.stringify({ ...frame, response: { ...response, output: items.filter(entry => !activity(entry) && !internalMessage(entry)) } }), event.event);
              return;
            }
            if (item && (internalMessage(item) || collaboration.has(String(item.type)) || item.type === 'web_search_call')) return;
            if (agent !== '/root' && /^(response\.(output_text|refusal|reasoning|content_part))/.test(type)) return;
            forward();
          } });
          reader = bytes => parser.feed(decoder.decode(bytes, { stream: true }));
          finish = () => parser.feed(decoder.decode());
        },
        transform(bytes) { reader(bytes); },
        flush() { finish(); },
      }));
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    },
    merge(stream: ReadableStream<Chunk>) {
      let lastEnd: Extract<Chunk, { type: 'text-end' | 'reasoning-end' }> | undefined;
      return stream.pipeThrough(new TransformStream<Chunk, Chunk>({ transform(chunk, controller) {
        if (chunk.type === 'start-step' || chunk.type === 'start') controller.enqueue(chunk);
        if (chunk.type !== 'start') {
          write = next => controller.enqueue(next);
          for (const item of pending.splice(0)) write(item);
        }
        if (chunk.type === 'text-end' || chunk.type === 'reasoning-end') {
          if (lastEnd) controller.enqueue(lastEnd);
          lastEnd = chunk;
        } else if (chunk.type !== 'start' && chunk.type !== 'start-step') {
          if (lastEnd && (chunk.type === 'finish-step' || chunk.type === 'finish' || chunk.type === 'error' || chunk.type === 'abort')) {
            const providerMetadata = lastEnd.providerMetadata;
            controller.enqueue(fallback ? { ...lastEnd, providerMetadata: { ...providerMetadata,
              openai: { ...providerMetadata?.openai, ...replayMetadata(fallback) } } } : lastEnd);
            lastEnd = undefined;
          }
          controller.enqueue(chunk);
        }
        if (chunk.type === 'finish' || chunk.type === 'error' || chunk.type === 'abort') write = () => {};
      }, flush(controller) { if (lastEnd) controller.enqueue(lastEnd); write = () => {}; } }));
    },
  };
}

const replayTypes = new Set(['message', 'reasoning', 'web_search_call', 'file_search_call', 'multi_agent_call', 'multi_agent_call_output', 'agent_message', 'compaction']);

function equalJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((value, index) => equalJson(value, b[index]));
  const left = asRecord(a), right = asRecord(b);
  return !!left && !!right && Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every(key => Object.hasOwn(right, key) && equalJson(left[key], right[key]));
}

function matchingArguments(a: unknown, b: unknown) {
  if (a === b) return true;
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  try { return equalJson(JSON.parse(a), JSON.parse(b)); } catch { return false; }
}

/** Keep SDK conversion for ordinary turns, attachments and client tool outputs. A marker replaces only a captured step. */
export function prepareOpenAIResponsesHistory(messages: ChatMessage[], model: string, enabled: boolean) {
  const snapshots = new Map<string, Item[]>();
  const prepared = messages.map(message => {
    let step: Part[] = [];
    const parts: Part[] = [];
    const flush = () => {
      const snapshot = enabled && message.role === 'assistant' ? step.map(readReplay).find(data => data?.model === model) : undefined;
      const ordinary = step.filter(part => !isOpenAIHostedTool(part) && !part.type.startsWith('data-')).map(part =>
        part.type === 'text' || part.type === 'reasoning' ? { ...part, providerMetadata: withoutReplay(part.providerMetadata) } : part);
      if (snapshot?.items.length) {
        const marker = `streaik-native-history:${crypto.randomUUID()}`;
        snapshots.set(marker, snapshot.items);
        parts.push({ type: 'text', text: marker });
        const coversText = snapshot.items.some(item => item.type === 'message' && item.role === 'assistant' && !internalMessage(item));
        parts.push(...ordinary.filter(part => (!coversText || part.type !== 'text') && part.type !== 'reasoning'));
      } else parts.push(...ordinary);
      step = [];
    };
    for (const part of message.parts) {
      if (part.type === 'step-start') { flush(); parts.push(part); }
      else step.push(part);
    }
    flush();
    return { ...message, parts };
  });
  return {
    messages: prepared,
    body(value: RequestInit['body']) {
      if (!snapshots.size || typeof value !== 'string') return value;
      const body = JSON.parse(value);
      if (!Array.isArray(body.input)) throw new GatewayError('Unable to assemble OpenAI Responses history.');
      const calls = new Map<string, Item>();
      for (const value of body.input) {
        const item = asRecord(value);
        if (item?.type === 'function_call' && typeof item.call_id === 'string') calls.set(item.call_id, item);
      }
      const emitted = new Set<string>();
      const replacedCalls = new Set<Item>();
      const replacedMarkers = new Set<string>();
      const input: unknown[] = [];
      const append = (items: Item[]) => {
        for (const native of items) {
          if (typeof native.id !== 'string' || emitted.has(native.id)) continue;
          if (native.type === 'function_call') {
            const call = typeof native.call_id === 'string' ? calls.get(native.call_id) : undefined;
            if (!call || replacedCalls.has(call) || native.name !== call.name || (native.namespace ?? null) !== (call.namespace ?? null)
              || !matchingArguments(native.arguments, call.arguments)) continue;
            replacedCalls.add(call);
          } else if (!replayTypes.has(String(native.type))) continue;
          if (native.type === 'message' && native.role !== 'assistant' && !(native.role === 'user' && internalMessage(native))) continue;
          emitted.add(native.id);
          input.push(native);
        }
      };
      for (const value of body.input) {
        const item = asRecord(value);
        if (item && (replacedCalls.has(item) || typeof item.id === 'string' && emitted.has(item.id))) continue;
        if (item?.role !== 'assistant') { input.push(value); continue; }
        if (typeof item.content === 'string') {
          const items = snapshots.get(item.content);
          if (items) { replacedMarkers.add(item.content); append(items); }
          else input.push(value);
          continue;
        }
        if (!Array.isArray(item.content)) { input.push(value); continue; }
        let remaining: unknown[] = [];
        const flush = () => { if (remaining.length) input.push({ ...item, content: remaining }); remaining = []; };
        for (const part of item.content) {
          const text = asRecord(part)?.text;
          if (typeof text !== 'string') { remaining.push(part); continue; }
          const items = snapshots.get(text);
          if (!items) { remaining.push(part); continue; }
          flush();
          replacedMarkers.add(text);
          append(items);
        }
        flush();
      }
      if (replacedMarkers.size !== snapshots.size) throw new GatewayError('Unable to assemble OpenAI Responses history.');
      return JSON.stringify({ ...body, input });
    },
  };
}
