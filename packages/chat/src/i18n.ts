import { createInstance } from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next, useTranslation } from 'react-i18next';
import { chatMessages } from './locales/chat';
import { sampleMessages } from './locales/samples';
import { agentMessages } from './locales/agents';

export const languages = { en: 'English', nl: 'Nederlands', es: 'Español' } as const;

// Keys are English source strings. Plural keys use i18next's _one/_other suffixes.
const singularEnglish: Record<string, string> = {
  '{{count, number}} MCP tools enabled_one': '{{count, number}} MCP tool enabled',
  '{{count, number}} providers_one': '{{count, number}} provider',
};
const resources = Object.fromEntries(Object.keys(languages).map((language, index) => [language, {
  translation: Object.fromEntries(Object.entries({ ...chatMessages, ...sampleMessages, ...agentMessages }).map(([key, values]) => [key,
    index === 0 ? singularEnglish[key] ?? key.replace(/_(one|other)$/, '') : values[index - 1],
  ])),
}]));

const i18n = createInstance();
function syncDocumentLanguage() {
  if (typeof document !== 'undefined') document.documentElement.lang = i18n.resolvedLanguage ?? 'en';
}

i18n.on('languageChanged', syncDocumentLanguage);
export const localizationReady = i18n.use(LanguageDetector).use(initReactI18next).init({
  resources,
  fallbackLng: 'en',
  supportedLngs: Object.keys(languages),
  load: 'languageOnly',
  keySeparator: false,
  nsSeparator: false,
  detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'], lookupLocalStorage: 'streaik.language' },
  interpolation: { escapeValue: false }, // React escapes interpolated text and attributes.
  react: { useSuspense: false },
});

export function useAppTranslation() {
  return useTranslation(undefined, { i18n });
}

export function useSelectSearch() {
  const { t, i18n } = useAppTranslation();
  return (label: string) => ({
    label: t('Search {{label}}', { label: label.toLocaleLowerCase(i18n.resolvedLanguage) }),
    placeholder: t('Search…'), emptyMessage: t('No matches found.'),
  });
}
