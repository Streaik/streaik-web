import { asRecord } from './directMetrics.ts';
import type { GatewayDecisionEndpoint } from './decisionChoice.ts';

export function decisionSearchBody(endpoint: GatewayDecisionEndpoint, model: string, input: string, predicates: readonly string[]) {
  const questions = predicates.map((instructions, index) => ({ name: `item_${index}`, instructions }));
  return endpoint === '/v1/decisions' ? { model, input, questions: questions.map(question => ({ type: 'predicate', ...question })) }
    : { model, state: input, questions: Object.fromEntries(questions.map(({ name, instructions }) => [name, { type: 'boolean', instructions }])) };
}

export function readDecisionSearch(endpoint: GatewayDecisionEndpoint, payload: unknown, count: number) {
  const answers = asRecord(payload)?.answers;
  const native = endpoint === '/v1/decisions';
  const entries = native ? (Array.isArray(answers) ? answers.map(value => [asRecord(value)?.name, value] as const) : [])
    : Object.entries(asRecord(answers) ?? {});
  const byName = new Map(entries);
  if (entries.length !== count || byName.size !== count) return;
  const scores: number[] = [];
  for (let index = 0; index < count; index++) {
    const answer = asRecord(byName.get(`item_${index}`));
    const score = answer?.probability;
    if (answer?.type !== (native ? 'predicate' : 'boolean') || typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) return;
    scores.push(score);
  }
  return scores;
}
