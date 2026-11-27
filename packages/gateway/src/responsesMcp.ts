import type { ChatMessage } from './index.ts';
import { GatewayError } from './index.ts';
import { asRecord } from './directMetrics.ts';

const approvalKey = 'streaik_mcp_approvals';
const historyKey = 'streaik_mcp_history';
type Invocation = Extract<ChatMessage['parts'][number], { toolCallId: string }>;

export function isResponsesMcpApproval(part: Invocation) {
  return part.providerExecuted === true && !!part.approval &&
    (part.type === 'dynamic-tool' ? part.toolName : part.type.slice(5)).startsWith('mcp.');
}

export function responsesMcpReplay(messages: ChatMessage[], url: string, model: string, gateway: boolean) {
  const records = new Map<string, { item: Record<string, unknown>; beforeUser: number }>();
  const decisions: Record<string, unknown>[] = [];
  const proofs: Record<string, string> = Object.create(null);
  const historyProofs: Record<string, string> = Object.create(null);
  const sent = new Set<string>();
  let beforeUser = 0;
  for (const message of messages) {
    if (message.role === 'user') beforeUser++;
    if (message.role !== 'assistant') continue;
    const replay = asRecord(message.metadata?.responsesMcp);
    if (replay?.url === url && replay.model === model && Array.isArray(replay.completed)) {
      const receipts = asRecord(replay.receipts);
      for (const value of replay.completed) {
        const item = asRecord(value);
        if (item?.type !== 'mcp_call' || typeof item.id !== 'string') continue;
        const receipt = receipts?.[item.id];
        if (gateway && item.id.startsWith('mcp_streaik_')) {
          if (typeof receipt !== 'string') continue;
          historyProofs[item.id] = receipt;
        }
        records.set(item.id, { item, beforeUser });
      }
    }
    for (const part of message.parts) {
      if (!('toolCallId' in part) || !isResponsesMcpApproval(part) || part.state !== 'approval-responded') continue;
      const { id, approved } = part.approval;
      if (sent.has(id)) continue;
      const current = replay?.url === url && replay.model === model && Array.isArray(replay.pending) ? replay.pending : [];
      const entry = current.map(asRecord).find(entry => asRecord(entry?.item)?.id === id);
      const item = asRecord(entry?.item);
      if (item?.type !== 'mcp_approval_request' || gateway && typeof entry?.proof !== 'string') {
        throw new GatewayError('The MCP approval context is unavailable. The tool has not been approved by this request.');
      }
      sent.add(id);
      if (gateway) proofs[id] = entry!.proof as string;
      decisions.push(item, { type: 'mcp_approval_response', approval_request_id: id, approve: approved });
    }
  }

  return {
    messages: messages.map(message => ({ ...message, parts: message.parts.filter(part => !('toolCallId' in part && isResponsesMcpApproval(part))) })),
    body(value: RequestInit['body']) {
      if (!records.size && !decisions.length || typeof value !== 'string') return value;
      const body = JSON.parse(value);
      const input: unknown[] = Array.isArray(body.input) ? body.input : [];
      const alreadyIncluded = new Set(input.map(item => asRecord(item)?.id));
      const history = [...records.values()].filter(({ item }) => !alreadyIncluded.has(item.id));
      const output: unknown[] = [];
      let users = 0;
      for (const item of input) {
        if (asRecord(item)?.role === 'user') {
          output.push(...history.filter(record => record.beforeUser === users).map(record => record.item));
          users++;
        }
        output.push(item);
      }
      output.push(...history.filter(record => record.beforeUser >= users).map(record => record.item), ...decisions);
      return JSON.stringify({ ...body, input: output, ...(gateway && decisions.length > 0 && { [approvalKey]: proofs }),
        ...(gateway && Object.keys(historyProofs).length > 0 && { [historyKey]: historyProofs }) });
    },
  };
}

export function responsesMcpOutput(url: string, model: string, previous?: ChatMessage) {
  const pending = new Map<string, Record<string, unknown>>();
  const completed = new Map<string, Record<string, unknown>>();
  const prior = asRecord(previous?.metadata?.responsesMcp);
  if (prior?.url === url && prior.model === model && Array.isArray(prior.completed)) {
    for (const value of prior.completed) {
      const item = asRecord(value);
      if (item?.type === 'mcp_call' && typeof item.id === 'string') completed.set(item.id, item);
    }
  }
  let proofs: Record<string, unknown> | undefined;
  let receipts = prior?.url === url && prior.model === model ? asRecord(prior.receipts) : undefined;
  function read(value: unknown) {
    const item = asRecord(value);
    if (typeof item?.id !== 'string') return;
    if (item.type === 'mcp_approval_request' && typeof item.name === 'string' && typeof item.server_label === 'string') {
      const { id, type, name, server_label, arguments: args } = item;
      pending.set(id, { type, id, name, server_label, ...(typeof args === 'string' && { arguments: args }) });
    } else if (item.type === 'mcp_call' && typeof item.approval_request_id === 'string') {
      const { id, type, name, server_label, arguments: args, output, error, status } = item;
      // The approval decision is single-use. Later turns replay only the completed result.
      completed.set(id, { type, id, name, server_label, arguments: args, output, error, status });
    }
  }
  return {
    observe(value: unknown) {
      const frame = asRecord(value);
      if (frame?.type === 'response.output_item.done') read(frame.item);
      if (frame?.type === 'response.completed' || frame?.type === 'response.incomplete') {
        const response = asRecord(frame.response);
        if (Array.isArray(response?.output)) response.output.forEach(read);
        proofs = asRecord(asRecord(response?.metadata)?.[approvalKey]);
        const issued = asRecord(asRecord(response?.metadata)?.[historyKey]);
        if (issued) receipts = { ...receipts, ...issued };
      }
    },
    metadata() {
      return pending.size || completed.size || prior?.url === url && prior.model === model ? {
        responsesMcp: { url, model, pending: [...pending.values()].map(item => ({ item, proof: proofs?.[String(item.id)] })),
          completed: [...completed.values()], receipts },
      } : {};
    },
  };
}
