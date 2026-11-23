import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useAppTranslation } from './i18n';
import { messageTime } from './messageMetadata';

const Clock = createContext<{ now: number; relative: Intl.RelativeTimeFormat } | null>(null);
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

export function MessageClock({ children }: { children: ReactNode }) {
  const { i18n } = useAppTranslation();
  const language = i18n.resolvedLanguage ?? 'en';
  const relative = useMemo(() => new Intl.RelativeTimeFormat(language), [language]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);
  const clock = useMemo(() => ({ now, relative }), [now, relative]);
  return <Clock.Provider value={clock}>{children}</Clock.Provider>;
}

export function MessageTime({ timestamp }: { timestamp?: string }) {
  const { t } = useAppTranslation();
  const clock = useContext(Clock);
  const time = messageTime(timestamp);
  if (!clock || time === undefined) return null;
  const age = Math.max(0, clock.now - time);
  const { relative } = clock;
  const label = age < minute ? t('Just now')
    : age < hour ? relative.format(-Math.floor(age / minute), 'minute')
    : age < day ? relative.format(-Math.floor(age / hour), 'hour')
    : age < 30 * day ? relative.format(-Math.floor(age / day), 'day')
    : age < 365 * day ? relative.format(-Math.floor(age / (30 * day)), 'month')
    : relative.format(-Math.floor(age / (365 * day)), 'year');
  return <time className="chat-message-time" dateTime={new Date(time).toISOString()}>{label}</time>;
}
