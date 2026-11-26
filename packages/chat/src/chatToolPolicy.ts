import type { ChatMessage, ChatToolChoice } from '@streaik/gateway';
import type { Invocation } from './ChatActivity';
import { toolPartName } from './localPlugins.ts';

export type ChatToolPolicy = { toolChoice?: ChatToolChoice; maxToolCalls?: number; stopTools: string[] };

export function normalizeToolPolicy(value: unknown): ChatToolPolicy {
  const policy = value && typeof value === 'object' ? value as Partial<ChatToolPolicy> : {};
  const { toolChoice, maxToolCalls } = policy;
  const limit = typeof maxToolCalls === 'number' && Number.isSafeInteger(maxToolCalls) && maxToolCalls > 0 ? maxToolCalls : undefined;
  const stopTools = Array.isArray(policy.stopTools)
    ? [...new Set(policy.stopTools.flatMap(name => typeof name === 'string' && name.trim() ? [name.trim()] : []))] : [];
  return { stopTools, ...(limit !== undefined && { maxToolCalls: limit }),
    ...((toolChoice === 'none' || toolChoice === 'required' && (limit !== undefined || stopTools.length > 0)) && { toolChoice }) };
}

export function toolPolicyForTurn(policy: ChatToolPolicy, activeTools: ReadonlySet<string>): ChatToolPolicy {
  return normalizeToolPolicy({ ...policy, stopTools: policy.stopTools.filter(name => activeTools.has(name)) });
}

export const toolComplete = (part: Invocation) => part.state === 'output-available' || part.state === 'output-error' ||
  part.state === 'approval-responded' || part.state === 'output-denied';

export type ToolProgress = { seen: Set<string>; completed: number };

export function continueToolPolicy(policy: ChatToolPolicy, parts: ChatMessage['parts'], progress: ToolProgress): ChatToolChoice | undefined {
  let stop = false;
  for (const part of parts) {
    if (!('toolCallId' in part) || !toolComplete(part) || progress.seen.has(part.toolCallId)) continue;
    progress.seen.add(part.toolCallId);
    progress.completed++;
    const name = toolPartName(part);
    if (name && policy.stopTools.includes(name)) stop = true;
  }
  // Don't drop results from parallel calls: apply the policy to the next model request, not to individual calls in this batch.
  return stop || (policy.maxToolCalls !== undefined && progress.completed >= policy.maxToolCalls) ? 'none' : policy.toolChoice;
}
