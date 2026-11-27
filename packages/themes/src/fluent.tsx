import { Button } from '@fluentui/react-button';
import {
  Add24Regular, Apps24Regular, ArrowDownload24Regular, ArrowExport24Regular, ArrowLeft24Regular, ArrowSync24Regular, ArrowUp24Regular, Attach24Regular, BookOpen24Regular, Bot24Regular,
  BrainCircuit24Regular, BranchFork24Regular, Chat24Regular, Checkmark24Regular, ChevronDown24Regular, Code24Regular, Color24Regular, Compose24Regular, Copy24Regular,
  Cube24Regular, Delete24Regular, Dismiss24Regular, Document24Regular, DocumentText24Regular, Edit24Regular, Globe24Regular, GridDots24Regular, ImageMultiple24Regular,
  Info24Regular, Key24Regular, Link24Regular, Mic24Regular, Money24Regular, MoreHorizontal24Regular, MoreVertical24Regular, PanelLeft24Regular, Person24Regular,
  Pin24Regular, PinOff24Regular, PlugConnected24Regular, Pulse24Regular, Search24Regular, Settings24Regular, Shapes24Regular, Shield24Regular, ShieldCheckmark24Regular,
  SignOut24Regular, Speaker224Regular, Stop24Regular, Tag24Regular, TextSortAscending24Regular, TextWordCount24Regular, Timer24Regular, Toolbox24Regular, TopSpeed24Regular, Video24Regular, WindowConsoleRegular,
} from '@fluentui/react-icons';
import { FluentProvider } from '@fluentui/react-provider';
import { Select } from '@fluentui/react-select';
import { Textarea } from '@fluentui/react-textarea';
import { teamsDarkTheme, teamsLightTheme, webDarkTheme, webLightTheme } from '@fluentui/react-theme';
import { Tooltip } from '@fluentui/react-tooltip';
import { lazy, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { choices } from './contract';
import type { ThemeAdapter, ThemeEnv } from './contract';
import { FluentTabs } from './FluentTabs';
import { nativeSelectOptions } from './selectOptions';

const parse = choices({ preset: ['web', 'teams'] });
const presetOptions = [{ value: 'web', label: 'Fluent Web' }, { value: 'teams', label: 'Microsoft Teams' }];

function tokens({ scheme, preferences }: ThemeEnv) {
  return preferences.preset === 'teams' ? (scheme === 'dark' ? teamsDarkTheme : teamsLightTheme) : (scheme === 'dark' ? webDarkTheme : webLightTheme);
}

// Scope Fluent's provider to its controls. The chat tree above the controls
// stays mounted when the selected adapter changes.
function Frame({ env, children, block }: { env: ThemeEnv; children: ReactNode; block?: boolean }) {
  return <FluentProvider theme={tokens(env)} applyStylesToPortals={false}
    style={{ display: block ? 'block' : 'inline-flex', minWidth: 0, maxWidth: '100%', background: 'transparent' }}>{children}</FluentProvider>;
}

const FluentSelect: ThemeAdapter['Select'] = ({ scheme, preferences, label, id, value, options, onValueChange, placeholder, disabled, className }) =>
  <Frame env={{ scheme, preferences }}><Select id={id} aria-label={label} select={{ className }} value={value} disabled={disabled}
    onChange={(_event, data) => onValueChange(data.value)}>
    {value === '' && <option value="" disabled>{placeholder}</option>}
    {nativeSelectOptions(options)}
  </Select></Frame>;

const tooltipPositions = { top: 'above', right: 'after', bottom: 'below', left: 'before' } as const;

const FluentTooltip: ThemeAdapter['Tooltip'] = ({ scheme, preferences, children, content, visualOnly, side = 'top' }) => {
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  return <FluentProvider theme={tokens({ scheme, preferences })} ref={setFrame} style={{ display: 'contents' }}>
    <Tooltip content={{ children: content ?? '', style: { maxWidth: 'min(22rem, calc(100vw - 1rem))', overflowWrap: 'anywhere', zIndex: 40 } }}
      relationship={visualOnly || !content ? 'inaccessible' : 'description'}
      visible={!!content && open} onVisibleChange={(_event, { visible }) => setOpen(!!content && visible)}
      mountNode={frame?.closest('dialog') ? frame : undefined} positioning={{ position: tooltipPositions[side], strategy: 'fixed' }}>
      {children}
    </Tooltip>
  </FluentProvider>;
};

const FluentPlot = lazy(() => import('./charts/FluentChart'));
const FluentChart: ThemeAdapter['Chart'] = (props) => <Frame env={props} block><FluentPlot {...props} /></Frame>;

export const fluent: ThemeAdapter = {
  Chart: FluentChart,
  parse,
  Tooltip: FluentTooltip,
  TabList: ({ className, scheme, preferences, ...props }) => <FluentProvider className={className} data-themed-tabs="fluent"
    theme={tokens({ scheme, preferences })} style={{ minWidth: 0, background: 'transparent' }}>
    <FluentTabs {...props} />
  </FluentProvider>,
  icons: {
    back: ArrowLeft24Regular,
    close: Dismiss24Regular,
    website: Globe24Regular,
    docs: BookOpen24Regular,
    pricing: Money24Regular,
    terms: Document24Regular,
    privacy: Shield24Regular,
    console: WindowConsoleRegular,
    models: Cube24Regular,
    images: ImageMultiple24Regular,
    videos: Video24Regular,
    providers: PlugConnected24Regular,
    agents: Bot24Regular,
    sidebar: PanelLeft24Regular,
    compose: Compose24Regular,
    add: Add24Regular,
    attachment: Attach24Regular,
    mic: Mic24Regular,
    link: Link24Regular,
    edit: Edit24Regular,
    user: Person24Regular,
    settings: Settings24Regular,
    info: Info24Regular,
    brain: BrainCircuit24Regular,
    tool: Toolbox24Regular,
    palette: Color24Regular,
    key: Key24Regular,
    logout: SignOut24Regular,
    more: MoreHorizontal24Regular,
    moreVertical: MoreVertical24Regular,
    pin: Pin24Regular,
    unpin: PinOff24Regular,
    trash: Delete24Regular,
    copy: Copy24Regular,
    download: ArrowDownload24Regular,
    refresh: ArrowSync24Regular,
    tag: Tag24Regular,
    check: Checkmark24Regular,
    tokens: Code24Regular,
    cost: Money24Regular,
    timer: Timer24Regular,
    speed: TopSpeed24Regular,
    stop: Stop24Regular,
    send: ArrowUp24Regular,
    search: Search24Regular,
    chevronDown: ChevronDown24Regular,
    grid: Apps24Regular,
    language: Chat24Regular,
    decision: BranchFork24Regular,
    ranking: TextSortAscending24Regular,
    realtime: Pulse24Regular,
    transcription: DocumentText24Regular,
    embedding: GridDots24Regular,
    audio: Speaker224Regular,
    moderation: ShieldCheckmark24Regular,
    shapes: Shapes24Regular,
    contextWindow: TextWordCount24Regular,
    outputLimit: ArrowExport24Regular,
  },
  style: (env) => {
    const t = tokens(env);
    return {
      '--background': t.colorNeutralBackground1, '--foreground': t.colorNeutralForeground1,
      '--surface': t.colorNeutralBackground1, '--muted': t.colorNeutralForeground3,
      '--soft': t.colorNeutralBackground3, '--border': t.colorNeutralStroke2,
      '--action': t.colorBrandBackground, '--on-action': t.colorNeutralForegroundOnBrand,
      '--focus': t.colorBrandForeground1, '--danger': t.colorPaletteRedForeground1,
      '--radius': t.borderRadiusMedium, fontFamily: t.fontFamilyBase,
    } as CSSProperties;
  },
  Button: ({ scheme, preferences, variant, ...props }) => <Frame env={{ scheme, preferences }}>
    <Button {...props} appearance={variant === 'subtle' ? 'subtle' : variant ?? 'secondary'} />
  </Frame>,
  Select: FluentSelect,
  Textarea: ({ scheme, preferences, className, ...props }) => <Frame env={{ scheme, preferences }} block>
    <Textarea {...props} textarea={{ className }} resize="vertical" />
  </Frame>,
  Settings: ({ scheme, preferences, onChange, translate }) => <div className="appearance-row">
    <label htmlFor="fluent-preset">{translate('Fluent preset')}</label>
    <FluentSelect scheme={scheme} preferences={preferences} id="fluent-preset" label={translate('Fluent preset')}
      value={preferences.preset} options={presetOptions} onValueChange={(preset) => onChange({ preset })} />
  </div>,
};
