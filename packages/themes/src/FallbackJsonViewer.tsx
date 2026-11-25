import JsonView from '@uiw/react-json-view';
import { githubDarkTheme } from '@uiw/react-json-view/githubDark';
import { githubLightTheme } from '@uiw/react-json-view/githubLight';
import type { CSSProperties } from 'react';
import type { JsonViewerProps, ThemeEnv } from './contract';

export function FallbackJsonViewer({ value, label = 'JSON', scheme }: JsonViewerProps & Pick<ThemeEnv, 'scheme'>) {
  return <JsonView className="fallback-json-viewer" role="group" aria-label={label} value={value}
    collapsed={1} displayDataTypes={false} highlightUpdates={false}
    style={{ ...(scheme === 'dark' ? githubDarkTheme : githubLightTheme), '--w-rjv-background-color': 'var(--surface)',
      '--w-rjv-info-color': 'var(--muted)' } as CSSProperties}>
    <JsonView.Url render={(_props, { value: text }) => <span>{String(text)}</span>} />
  </JsonView>;
}
