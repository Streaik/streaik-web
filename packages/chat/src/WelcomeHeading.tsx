import { useEffect, useState } from 'react';
import { useAppTranslation } from './i18n';
import { runTextAppAgent, welcomeRoleId } from './textAppAgents';
import type { TextAppRequest } from './textAppAgents';

export function WelcomeHeading({ request, discovering }: { request?: TextAppRequest; discovering: boolean }) {
  const { t } = useAppTranslation();
  const [result, setResult] = useState<{ request: TextAppRequest; text?: string }>();
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    void runTextAppAgent(welcomeRoleId, request, 'Welcome the user to the app.', controller.signal).then(text => {
      if (!controller.signal.aborted) setResult({ request, text });
    });
    return () => controller.abort();
  }, [request]);

  const loading = discovering || (!!request && result?.request !== request);
  if (loading) return <h1 aria-busy="true" aria-label={t('Loading welcome message…')}>
    <span className="chat-welcome-skeleton" aria-hidden="true" />
  </h1>;
  return <h1>{request && result?.text ? result.text : t('Welcome')}</h1>;
}
