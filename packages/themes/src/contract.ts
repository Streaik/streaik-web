import type { ComponentPropsWithRef, ComponentPropsWithoutRef, ComponentType, CSSProperties, ReactElement } from 'react';

export type ColorMode = 'system' | 'light' | 'dark';
export type Preferences = Readonly<Record<string, string>>;
export type ThemeEnv = { scheme: Exclude<ColorMode, 'system'>; preferences: Preferences };
export type JsonViewerProps = { value: object; label?: string };
export type ButtonProps = ComponentPropsWithRef<'button'> & { variant?: 'primary' | 'subtle' };
export type TooltipProps = { content?: string; children: ReactElement<{ title?: string }>; visualOnly?: boolean; side?: 'top' | 'right' | 'bottom' | 'left' };
export type SelectGroup = { id: string; label: string };
export type SelectOption = { value: string; label: string; group?: SelectGroup };
export type SelectSearch = { label?: string; placeholder?: string; emptyMessage?: string; allowDeselect?: boolean };
export type SelectProps = {
  multiple?: false;
  label: string;
  id?: string;
  className?: string;
  value: string;
  options: readonly SelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  search?: boolean | SelectSearch;
};
export type MultiSelectProps = Omit<SelectProps, 'multiple' | 'value' | 'onValueChange'> & {
  multiple: true;
  value: readonly string[];
  onValueChange: (value: string[]) => void;
  selectionSummary?: string;
};
export type TextareaProps = Omit<ComponentPropsWithoutRef<'textarea'>, 'value' | 'defaultValue'> & { value?: string; defaultValue?: string };
export type ThemeSettingsProps = ThemeEnv & { onChange: (value: Preferences) => void; translate: (key: string) => string };
export type IconName = 'images' | 'videos' | 'models' | 'providers' | 'agents' | 'sidebar' | 'compose' | 'user' | 'settings' | 'logout' | 'more' | 'moreVertical' | 'pin' | 'unpin' | 'trash' |
  'copy' | 'download' | 'check' | 'tokens' | 'cost' | 'timer' | 'speed' | 'stop' | 'send' | 'search' | 'chevronDown' | 'key' | 'add' | 'edit' | 'palette' | 'refresh' | 'tag' |
  'back' | 'close' | 'website' | 'docs' | 'pricing' | 'terms' | 'privacy' | 'console' | 'info' | 'brain' | 'tool' | 'attachment' | 'link' | 'mic' |
  'grid' | 'language' | 'decision' | 'ranking' | 'realtime' | 'transcription' | 'embedding' | 'audio' | 'moderation' | 'shapes' | 'contextWindow' | 'outputLimit';
type IconGlyphProps = Pick<ComponentPropsWithoutRef<'svg'>, 'className' | 'width' | 'height' | 'aria-hidden' | 'focusable'>;
export type IconSet = Readonly<Record<IconName, ComponentType<IconGlyphProps>>>;
export type ThemeAdapter = {
  JsonViewer?: ComponentType<JsonViewerProps & ThemeEnv>;
  Button: ComponentType<ButtonProps & ThemeEnv>;
  Tooltip: ComponentType<TooltipProps & ThemeEnv>;
  Select: ComponentType<SelectProps & ThemeEnv>;
  Textarea: ComponentType<TextareaProps & ThemeEnv>;
  icons: IconSet;
  Settings: ComponentType<ThemeSettingsProps>;
  parse: (settings: unknown) => Preferences;
  style?: (env: ThemeEnv) => CSSProperties;
};

// Each adapter declares supported values; the first choice is its default.
// Stored values are never interpolated into CSS before passing this check.
export function choices(schema: Readonly<Record<string, readonly [string, ...string[]]>>) {
  return (input: unknown): Preferences => {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
    return Object.fromEntries(Object.entries(schema).map(([key, allowed]) => [key,
      Object.hasOwn(source, key) && typeof source[key] === 'string' && allowed.includes(source[key]) ? source[key] : allowed[0],
    ]));
  };
}
