import { Tooltip } from '@streaik/themes';
import { useState } from 'react';
import { useAppTranslation } from './i18n';

// Bundled artwork only; metadata is never allowed to supply a remote image URL.
const logos = new Map([
  ['openai', new URL('./logos/openai.png', import.meta.url).href],
  ['anthropic', new URL('./logos/anthropic.png', import.meta.url).href],
  ['openrouter', new URL('./logos/openrouter.png', import.meta.url).href],
  ['deepseek', new URL('./logos/deepseek.png', import.meta.url).href],
  ['groq', new URL('./logos/groq.png', import.meta.url).href],
  ['together', new URL('./logos/together.png', import.meta.url).href],
  ['cerebras', new URL('./logos/cerebras.png', import.meta.url).href],
  ['google', new URL('./logos/google.png', import.meta.url).href],
  ['xai', new URL('./logos/xai.png', import.meta.url).href],
]);

export function providerLogo(provider: string) {
  return logos.get(provider.toLowerCase());
}

export function AssistantSpeaker({ model }: { model?: string }) {
  const { t } = useAppTranslation();
  const [failed, setFailed] = useState<string>();
  const [loaded, setLoaded] = useState<string>();
  const slash = model?.indexOf('/') ?? -1;
  const logo = model && slash > 0 && providerLogo(model.slice(0, slash));
  const showLogo = !!logo && failed !== logo;
  return <Tooltip content={model} visualOnly><span className="chat-speaker">
    {logo && showLogo && <img key={logo} src={logo} alt="" className="chat-provider-logo"
      onLoad={() => setLoaded(logo)} onError={() => setFailed(logo)} />}
    {model ? showLogo && loaded === logo ? model.slice(slash + 1) || model : model : t('Assistant')}
  </span></Tooltip>;
}
