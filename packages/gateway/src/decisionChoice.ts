export const gatewayDecisionEndpoints = ['/v1/decisions', '/api/decisions'] as const;
export type GatewayDecisionEndpoint = typeof gatewayDecisionEndpoints[number];

export type DecisionChoice = {
  model: string;
  input: string;
  instructions: string;
  choices: readonly { value: string; description: string }[];
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

export function readDecisionChoice(endpoint: GatewayDecisionEndpoint, payload: unknown, choices: DecisionChoice['choices']) {
  const answers = record(payload)?.answers;
  let answer: Record<string, unknown> | undefined;
  if (endpoint === '/v1/decisions') {
    const first = Array.isArray(answers) && answers.length === 1 ? record(answers[0]) : undefined;
    if (first?.name === question) answer = first;
  } else {
    const byName = record(answers);
    if (byName && Object.keys(byName).length === 1 && Object.hasOwn(byName, question)) answer = record(byName[question]);
  }
  if (answer?.type === 'choice' && typeof answer.choice === 'string' && choices.some(({ value }) => value === answer.choice)) {
    return answer.choice;
  }
}
