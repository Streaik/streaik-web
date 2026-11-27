export const gatewayDecisionEndpoints = ['/v1/decisions', '/api/decisions'] as const;
export type GatewayDecisionEndpoint = typeof gatewayDecisionEndpoints[number];

export type DecisionChoice = {
  model: string;
  input: string;
  instructions: string;
  choices: readonly { value: string; description: string }[];
};

export type DecisionChoiceResult = {
  choice: string;
  confidence?: number;
  probabilities?: { value: string; probability: number }[];
};

const question = 'chat_model';

export function decisionChoiceBody(endpoint: GatewayDecisionEndpoint, { model, input, instructions, choices }: DecisionChoice) {
  return endpoint === '/v1/decisions'
    ? { model, input, questions: [{ type: 'choice', name: question, instructions, choices }] }
    : { model, state: input, questions: { [question]: {
      type: 'choice', instructions, criteria: Object.fromEntries(choices.map(({ value, description }) => [value, description])),
    } } };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function probability(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 1;
}

export function readDecisionChoice(endpoint: GatewayDecisionEndpoint, payload: unknown, choices: DecisionChoice['choices']): DecisionChoiceResult | undefined {
  const answers = record(payload)?.answers;
  let answer: Record<string, unknown> | undefined;
  if (endpoint === '/v1/decisions') {
    const first = Array.isArray(answers) && answers.length === 1 ? record(answers[0]) : undefined;
    if (first?.name === question) answer = first;
  } else {
    const byName = record(answers);
    if (byName && Object.keys(byName).length === 1 && Object.hasOwn(byName, question)) answer = record(byName[question]);
  }
  if (answer?.type !== 'choice' || typeof answer.choice !== 'string' || !choices.some(({ value }) => value === answer.choice)) return;

  const offered = new Set(choices.map(({ value }) => value));
  const scores = new Map<string, number>();
  const scoresPayload = answer.probabilities;
  const addScore = (value: unknown, score: unknown) => {
    if (typeof value === 'string' && offered.has(value) && probability(score) && !scores.has(value)) scores.set(value, score);
  };
  // OpenAI-compatible Decisions return an array; the Vercel route keys its probabilities by choice ID.
  if (endpoint === '/v1/decisions' && Array.isArray(scoresPayload)) {
    for (const item of scoresPayload) {
      const score = record(item);
      addScore(score?.value, score?.probability);
    }
  } else if (endpoint === '/api/decisions') {
    for (const [value, score] of Object.entries(record(scoresPayload) ?? {})) addScore(value, score);
  }
  return { choice: answer.choice, ...(probability(answer.confidence) && { confidence: answer.confidence }),
    ...(scores.size > 0 && { probabilities: Array.from(scores, ([value, probability]) => ({ value, probability })) }) };
}
