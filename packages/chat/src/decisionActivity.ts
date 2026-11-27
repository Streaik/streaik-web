import type { ChatMessage } from '@streaik/gateway';
import type { UIMessageChunk } from 'ai';
import type { DecisionAgentContext, ModelDecision } from './modelDecisions';

const toolName = 'streaik_client_model_decision';
const callPrefix = 'streaik_decision_';
export const decisionFailedMessage = 'No model could be selected.';

export function isDecisionActivity(part: ChatMessage['parts'][number]) {
  return part.type === 'dynamic-tool' && part.providerExecuted === true && part.toolName === toolName && part.toolCallId.startsWith(callPrefix);
}

export function decisionActivity({ endpoint, model, instructions, choices }: ModelDecision, agent: DecisionAgentContext | undefined,
  result?: { selectedModel: string | undefined; fallback?: true }): UIMessageChunk[] {
  // Build the display input from routing configuration, never from the serialized conversation.
  const input = { endpoint, model, instructions, choices,
    ...(agent && { agent: { name: agent.name, description: agent.description, instructions: agent.instructions } }) };
  const tool = { toolName, toolCallId: `${callPrefix}${crypto.randomUUID()}`, input, dynamic: true, providerExecuted: true };
  return result ? [{ type: 'tool-input-available', ...tool }, { type: 'tool-output-available', toolCallId: tool.toolCallId,
    output: result, providerExecuted: true, dynamic: true }]
    : [{ type: 'tool-input-error', ...tool, errorText: decisionFailedMessage }];
}

export function withoutDecisionActivity(messages: ChatMessage[]) {
  return messages.flatMap(message => {
    const parts = message.parts.filter(part => !isDecisionActivity(part));
    if (parts.length === message.parts.length) return [message];
    return parts.some(part => part.type !== 'step-start') ? [{ ...message, parts }] : [];
  });
}

type ReplyStream = ReadableStream<UIMessageChunk>;

export function withDecisionActivity(source: { stream: ReplyStream } | { error: unknown }, parts: readonly UIMessageChunk[], model?: string): ReplyStream {
  const reader = 'stream' in source ? source.stream.getReader() : undefined;
  let failure = 'error' in source ? source : undefined;
  let first: ReadableStreamReadResult<UIMessageChunk> | undefined;
  let index = -1;

  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      if (index < 0) {
        try { first = await reader?.read(); } catch (error) { failure = { error }; }
        // Keep the provider's message ID and normalized metadata whenever there is a reply start.
        if (first?.value?.type === 'start') {
          controller.enqueue(first.value);
          first = undefined;
        } else controller.enqueue({ type: 'start', messageMetadata: { model, timestamp: new Date().toISOString() } });
        index = 0;
      } else if (index < parts.length) controller.enqueue(parts[index++]);
      else if (failure) throw failure.error;
      else {
        const next = first ?? await reader?.read();
        first = undefined;
        if (!next || next.done) { reader?.releaseLock(); controller.close(); }
        else controller.enqueue(next.value);
      }
    },
    cancel(reason) { return reader?.cancel(reason); },
    // Let useChat consume the activity before surfacing an error from the stream.
  }, { highWaterMark: 0 });
}
