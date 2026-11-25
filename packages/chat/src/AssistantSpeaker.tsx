import { Tooltip } from '@streaik/themes';
import { useState } from 'react';
import { providerFavicon } from './favicons';
import { useAppTranslation } from './i18n';

export function AssistantSpeaker({ model, showProviderLogo }: { model?: string; showProviderLogo: boolean }) {
  const { t } = useAppTranslation();
  const [failed, setFailed] = useState<string>();
  const [loaded, setLoaded] = useState<string>();
  const slash = model?.indexOf('/') ?? -1;
  const logo = showProviderLogo && model && slash > 0 && providerFavicon(model.slice(0, slash));
  const showLogo = !!logo && failed !== logo;
  return <Tooltip content={model} visualOnly><span className="chat-speaker">
    {logo && showLogo && <img key={logo} referrerPolicy="no-referrer" src={logo} alt="" className="chat-provider-logo"
      onLoad={() => setLoaded(logo)} onError={() => setFailed(logo)} />}
    {model ? showLogo && loaded === logo ? model.slice(slash + 1) || model : model : t('Assistant')}
  </span></Tooltip>;
}
