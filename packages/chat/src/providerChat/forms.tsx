import type { ComponentType } from 'react';
import type { ChatProviderId } from './settings';
import type { ProviderFormProps } from './fields';
import { CerebrasChatConfigForm } from './cerebras/CerebrasChatConfigForm';
import { TogetherChatConfigForm } from './together/TogetherChatConfigForm';
import { OpenAIChatConfigForm } from './openai/OpenAIChatConfigForm';

const forms: Record<ChatProviderId, ComponentType<ProviderFormProps>> = {
  cerebras: CerebrasChatConfigForm,
  together: TogetherChatConfigForm,
  openai: OpenAIChatConfigForm,
};

export function ProviderChatForm({ provider, ...props }: ProviderFormProps & { provider: ChatProviderId }) {
  const Form = forms[provider];
  return <Form {...props} />;
}
