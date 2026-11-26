import type { LanguageModelUsage, TextStreamPart, ToolSet } from 'ai';
import type { ChatMessageMetadata, NativeChatEndpoint } from './index.ts';
import { amount } from './tokenPricing.ts';
import type { TokenRates } from './tokenPricing.ts';

export type DirectMetricsOptions = { provider: string; rates: (resolvedModel?: string) => TokenRates | undefined };

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function tokens(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function unpriced(usage: Record<string, unknown> | undefined) {
  if (!usage) return false;
  const input = asRecord(usage.prompt_tokens_details ?? usage.input_tokens_details);
  const output = asRecord(usage.completion_tokens_details ?? usage.output_tokens_details);
  return [input?.audio_tokens, input?.image_tokens, output?.audio_tokens, output?.image_tokens,
    asRecord(usage.cache_creation)?.ephemeral_1h_input_tokens, input?.orchestration_input_tokens, output?.orchestration_output_tokens]
    .some(n => typeof n === 'number' && n > 0) || usage.server_tool_use != null ||
    (Array.isArray(usage.iterations) && usage.iterations.length > 0);
}

function estimate(rates: TokenRates | undefined, inputValue: unknown, outputValue: unknown, readValue: unknown, writeValue: unknown) {
  const input = tokens(inputValue), output = tokens(outputValue);
  const read = tokens(readValue ?? 0), write = tokens(writeValue ?? 0);
  if (!rates || input === undefined || output === undefined || read === undefined || write === undefined ||
      read + write > input || input + output === 0) return;
  if ((read > 0 && rates.cacheRead === undefined) || (write > 0 && rates.cacheWrite === undefined)) return;
  return amount((input - read - write) * rates.input + output * rates.output + read * (rates.cacheRead ?? 0) + write * (rates.cacheWrite ?? 0));
}

function standardTier(tier: unknown) {
  return tier == null || tier === 'auto' || tier === 'default' || tier === 'standard';
}

function hasOutput(part: TextStreamPart<ToolSet>) {
  if (part.type === 'text-delta' || part.type === 'reasoning-delta') return part.text.length > 0;
  return part.type === 'tool-input-delta' && part.delta.length > 0;
}

// The OpenAI Chat adapter does not expose OpenRouter's reasoning extensions as
// SDK deltas. Observe Chat frames once, including reasoning-only output frames.
function chatHasOutput(frame: Record<string, unknown> | undefined) {
  const delta = Array.isArray(frame?.choices) ? asRecord(asRecord(frame.choices[0])?.delta) : undefined;
  if (!delta) return false;
  const nonempty = (text: unknown) => typeof text === 'string' && text.length > 0;
  return [delta.content, delta.refusal, delta.reasoning, delta.reasoning_content, delta.thinking, asRecord(delta.function_call)?.arguments].some(nonempty)
    || (Array.isArray(delta.tool_calls) && delta.tool_calls.some(call => nonempty(asRecord(asRecord(call)?.function)?.arguments)));
}

export function createDirectMetrics(endpoint: NativeChatEndpoint, options: DirectMetricsOptions, now = () => performance.now()) {
  const chat = endpoint === '/v1/chat/completions';
  const router = options.provider === 'openrouter';
  let started: number | undefined, first: number | undefined, last: number | undefined;
  let reported: number | undefined, input: number | undefined, output: number | undefined;
  let rawUsage: Record<string, unknown> | undefined;
  let step: Extract<TextStreamPart<ToolSet>, { type: 'finish-step' }> | undefined;
  let extraCharges = false, failed = false;
  return {
    start() { started ??= now(); },
    observe(part: TextStreamPart<ToolSet>) {
      const frame = part.type === 'raw' ? asRecord(part.rawValue) : undefined;
      if (started !== undefined && (chat ? chatHasOutput(frame) : hasOutput(part))) {
        last = now();
        first ??= last;
      }
      if (frame) {
        const envelope = asRecord(frame.response) ?? asRecord(frame.message);
        const usage = asRecord(frame.usage ?? envelope?.usage);
        extraCharges ||= unpriced(usage) || !standardTier(frame.service_tier ?? envelope?.service_tier ?? usage?.service_tier);
        if (chat && usage) {
          // A cost-only tail must not overwrite the actual token counts with the
          // OpenAI adapter's synthesized zeros for absent Chat counters.
          input = tokens(usage.prompt_tokens) ?? input;
          output = tokens(usage.completion_tokens) ?? output;
          if (tokens(usage.prompt_tokens) !== undefined && tokens(usage.completion_tokens) !== undefined) rawUsage = usage;
          if (router) reported = amount(usage.cost) ?? reported;
        }
      }
      if ((part.type === 'tool-call' && part.providerExecuted) || part.type === 'file' || part.type === 'reasoning-file') extraCharges = true;
      if (part.type === 'error' || part.type === 'abort' ||
          (part.type === 'finish' && (part.finishReason === 'error' || part.finishReason === 'interrupted'))) failed = true;
      if (part.type === 'finish-step') step = part;
    },
    finish(usage: LanguageModelUsage) {
      const inputTokens = chat ? input : tokens(usage.inputTokens);
      const outputTokens = chat ? output : tokens(usage.outputTokens);
      const totalTokens = chat ? inputTokens === undefined || outputTokens === undefined ? undefined : inputTokens + outputTokens : tokens(usage.totalTokens);
      const summary = { promptTokens: inputTokens, completionTokens: outputTokens, totalTokens };
      if (failed) return { summary, metrics: undefined };

      const perModel = step?.usage ?? usage;
      const tier = step?.providerMetadata?.[options.provider]?.serviceTier ?? perModel.raw?.service_tier;
      let cost = router ? reported ?? amount(perModel.raw?.cost) : undefined;
      if (!router && !extraCharges && standardTier(tier) && !unpriced(perModel.raw)) {
        const rates = options.rates(step?.response.modelId);
        if (chat) {
          const detail = asRecord(rawUsage?.prompt_tokens_details);
          cost = estimate(rates, rawUsage?.prompt_tokens, rawUsage?.completion_tokens, detail?.cached_tokens, detail?.cache_write_tokens);
        } else {
          cost = estimate(rates, perModel.inputTokens, perModel.outputTokens, perModel.inputTokenDetails.cacheReadTokens, perModel.inputTokenDetails.cacheWriteTokens);
        }
      }
      const ttft = started !== undefined && first !== undefined ? (first - started) / 1000 : undefined;
      const tps = first !== undefined && last !== undefined && last > first && outputTokens !== undefined
        ? outputTokens / ((last - first) / 1000) : undefined;
      const metrics: ChatMessageMetadata['gateway'] = cost === undefined && ttft === undefined ? undefined : {
        source: 'direct', ...(ttft !== undefined && { ttft }), ...(tps !== undefined && { tps }),
        ...(cost !== undefined && { cost }),
      };
      return { summary, metrics };
    },
  };
}
