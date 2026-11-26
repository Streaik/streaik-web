import type { ElicitRequestFormParams } from '@modelcontextprotocol/client';
import type { Invocation } from './ChatActivity';
import { toolPartName } from './localPlugins';

export const echoInputModel = 'echo/echo-input-required';

export function isEchoInputCall(part: Invocation) {
  return toolPartName(part) === 'ai_input_required' && part.toolCallId.startsWith('call_echo_input_');
}

export function providerElicitationForm(part: Invocation): ElicitRequestFormParams | undefined {
  const input = part.input;
  if (!input || typeof input !== 'object' || !('mode' in input) || input.mode !== 'form' ||
      !('message' in input) || typeof input.message !== 'string' || !('requestedSchema' in input)) return;
  const schema = input.requestedSchema;
  if (!schema || typeof schema !== 'object' || !('type' in schema) || schema.type !== 'object' ||
      !('properties' in schema) || !schema.properties || typeof schema.properties !== 'object' ||
      !('message' in schema.properties)) return;
  const field = schema.properties.message;
  if (!field || typeof field !== 'object' || !('type' in field) || field.type !== 'string') return;
  return { mode: 'form', message: input.message, requestedSchema: {
    type: 'object', properties: { message: { type: 'string', title: 'title' in field && typeof field.title === 'string' ? field.title : 'Message' } },
    required: ['message'],
  } };
}
