import { Suspense, createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { ButtonProps, ColorMode, IconName, JsonViewerProps, MultiSelectProps, Preferences, SelectProps, TextareaProps, ThemeAdapter, ThemeEnv, TooltipProps } from './contract';
import { ChartFigure } from './charts/ChartFigure';
import type { ChartProps } from './charts/ChartFigure';
import { FallbackJsonViewer } from './FallbackJsonViewer';
import { html } from './html';
import { SearchableSelect } from './SearchableSelect';
import './theme.css';

const registry = {
  shadcn: { label: 'shadcn', load: () => import('./shadcn.tsx').then((m) => m.shadcn) },
  html: { label: 'HTML', load: async () => html },
  fluent: { label: 'Fluent', load: () => import('./fluent.tsx').then((m) => m.fluent) },
};
export type ThemeId = keyof typeof registry;
export type { ColorMode, IconName };
export type { ChartSpec } from './charts/spec';
export type { ChartProps } from './charts/ChartFigure';
export type { MultiSelectProps, SelectGroup, SelectOption, SelectProps, SelectSearch } from './contract';
const themes = Object.keys(registry) as ThemeId[];
const fallback: ThemeEnv = { scheme: 'light', preferences: html.parse(undefined) };
const darkQuery = '(prefers-color-scheme: dark)';
const themeKey = 'streaik.theme';
const modeKey = 'streaik.color-mode';
const optionsKey = (theme: ThemeId) => `streaik.theme-settings.v1.${theme}`;

function read(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
  catch { /* Appearance still works without browser storage. */ }
}

function readOptions(theme: ThemeId): unknown {
  const value = read(optionsKey(theme));
  if (!value || value.length > 4096) return undefined;
  try { return JSON.parse(value); } catch { return undefined; }
}

function getTheme(): ThemeId {
  const value = read(themeKey);
  return themes.find((id) => id === value) ?? 'shadcn';
}

function getMode(): ColorMode {
  const value = read(modeKey);
  return value === 'dark' || value === 'light' ? value : 'system';
}

function subscribe(listener: () => void) {
  const query = window.matchMedia(darkQuery);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

type AppearanceState = {
  adapter: ThemeAdapter;
  env: ThemeEnv;
  theme: ThemeId;
  mode: ColorMode;
  phase: 'loading' | 'ready' | 'error';
  chooseTheme: (theme: ThemeId) => void;
  chooseMode: (mode: ColorMode) => void;
  changeOptions: (options?: Preferences) => void;
};

const Appearance = createContext<AppearanceState | null>(null);

export function useColorScheme() {
  return useContext(Appearance)?.env.scheme ?? fallback.scheme;
}

export function JsonViewer(props: JsonViewerProps) {
  const active = useContext(Appearance);
  const Viewer = active?.adapter.JsonViewer;
  const env = active?.env ?? fallback;
  const generic = <FallbackJsonViewer {...props} scheme={env.scheme} />;
  return Viewer ? <Suspense fallback={generic}><Viewer {...props} {...env} /></Suspense> : generic;
}

export function Chart(props: ChartProps) {
  const active = useContext(Appearance);
  const Plot = active?.phase === 'loading' ? undefined : (active?.adapter ?? html).Chart;
  return <ChartFigure key={active?.phase === 'ready' ? active.theme : active?.phase ?? 'html'} {...props} renderer={Plot} env={active?.env ?? fallback} />;
}

export function ThemeRoot({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState(getTheme);
  const [mode, setMode] = useState(getMode);
  const [modules, setModules] = useState<Partial<Record<ThemeId, ThemeAdapter | 'error'>>>({ html });
  const [options, setOptions] = useState<Partial<Record<ThemeId, unknown>>>(() => Object.fromEntries(themes.map((id) => [id, readOptions(id)])));
  const systemDark = useSyncExternalStore(subscribe, () => window.matchMedia(darkQuery).matches, () => false);
  const scheme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
  const active = modules[theme];
  useEffect(() => {
    if (active) return;
    let pending = true;
    void registry[theme].load().then(
      (adapter) => { if (pending) setModules((previous) => ({ ...previous, [theme]: adapter })); },
      () => { if (pending) setModules((previous) => ({ ...previous, [theme]: 'error' })); },
    );
    return () => { pending = false; };
  }, [theme, active]);
  const adapter = active && active !== 'error' ? active : html;
  const preferences = adapter.parse(options[theme]);
  const env = { scheme, preferences };
  const chooseTheme = (id: ThemeId) => { setTheme(id); write(themeKey, id); };
  const chooseMode = (next: ColorMode) => { setMode(next); write(modeKey, next); };
  const changeOptions = (next?: Preferences) => {
    if (!active || active === 'error') return;
    const parsed = active.parse(next);
    setOptions((previous) => ({ ...previous, [theme]: parsed }));
    write(optionsKey(theme), next ? JSON.stringify(parsed) : null);
  };
  return <Appearance.Provider value={{ adapter, env, theme, mode, phase: active === 'error' ? 'error' : active ? 'ready' : 'loading', chooseTheme, chooseMode, changeOptions }}>
    <div className="streaik-theme" data-theme={theme} data-scheme={scheme} style={adapter.style?.(env)}>
      {children}
    </div>
  </Appearance.Provider>;
}

export function Button({ className = '', type = 'button', title, ...props }: ButtonProps) {
  const active = useContext(Appearance);
  const Control = active?.adapter.Button ?? html.Button;
  const button = <Control {...props} {...(active?.env ?? fallback)} type={type} className={`ui-button ${className}`} />;
  return title ? <Tooltip content={title}>{button}</Tooltip> : button;
}

export function Tooltip(props: TooltipProps) {
  const active = useContext(Appearance);
  const Hint = active?.adapter.Tooltip ?? html.Tooltip;
  return <Hint {...props} {...(active?.env ?? fallback)} />;
}

// Icons decorate their parent control or badge, which owns the accessible label.
export function Icon({ name, className, size = 18 }: { name: IconName; className?: string; size?: number }) {
  const adapter = useContext(Appearance)?.adapter ?? html;
  const Glyph = adapter.icons[name];
  return <Glyph className={className} width={size} height={size} aria-hidden="true" focusable="false" />;
}

export function Select(props: SelectProps | MultiSelectProps) {
  const active = useContext(Appearance);
  const adapter = active?.adapter ?? html;
  const className = `ui-select ${props.className ?? ''}`;
  if (props.multiple || props.search) {
    return <SearchableSelect {...props} search={typeof props.search === 'object' ? props.search : {}}
      icons={adapter.icons} Tooltip={Tooltip} className={className} />;
  }
  const Control = adapter.Select;
  return <Control {...props} {...(active?.env ?? fallback)} className={className} />;
}

export function Textarea({ className = '', ...props }: TextareaProps) {
  const active = useContext(Appearance);
  const Control = active?.adapter.Textarea ?? html.Textarea;
  return <Control {...props} {...(active?.env ?? fallback)} className={`ui-textarea ${className}`} />;
}

export function ColorModeSettings({ translate = (key: string) => key }: { translate?: (key: string) => string } = {}) {
  const active = useContext(Appearance);
  if (!active) return null;
  return <div className="appearance-row"><label htmlFor="color-choice">{translate('Color mode')}</label>
    <select id="color-choice" value={active.mode} onChange={(event) => {
      const next = event.currentTarget.value;
      if (next === 'light' || next === 'dark' || next === 'system') active.chooseMode(next);
    }}><option value="system">{translate('System')}</option><option value="light">{translate('Light')}</option><option value="dark">{translate('Dark')}</option></select>
  </div>;
}

export function ThemeSettings({ translate = (key: string) => key, themeText }: {
  translate?: (key: string) => string;
  themeText?: (theme: string, action: 'settings' | 'reset') => string;
} = {}) {
  const active = useContext(Appearance);
  if (!active) return null;
  const { theme, env, phase, adapter, chooseTheme, changeOptions } = active;
  const Settings = adapter.Settings;
  // Keep the picker native and mounted so switching adapters preserves focus.
  return <>
    <div className="appearance-row"><label htmlFor="theme-choice">{translate('Theme')}</label>
      <select id="theme-choice" value={theme} onChange={(event) => {
        const next = themes.find((id) => id === event.target.value);
        if (next) chooseTheme(next);
      }}>{themes.map((id) => <option key={id} value={id}>{registry[id].label}</option>)}</select>
    </div>
    {phase === 'ready' ? <fieldset className="appearance-fields">
      <legend>{themeText?.(registry[theme].label, 'settings') ?? `${registry[theme].label} settings`}</legend>
      <Settings key={theme} {...env} onChange={changeOptions} translate={translate} />
      <div><Button onClick={() => changeOptions()}>{themeText?.(registry[theme].label, 'reset') ?? `Reset ${registry[theme].label} settings`}</Button></div>
    </fieldset> : <p role={phase === 'error' ? 'alert' : 'status'}>{translate(phase === 'error' ? 'Could not load this theme. Choose another theme or reload the page.' : 'Loading theme settings…')}</p>}
  </>;
}
