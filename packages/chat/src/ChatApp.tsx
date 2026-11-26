import { useChat } from '@ai-sdk/react';
import { GatewayError, gatewayChatEndpoints, isVoiceCatalogModel, nativeChatEndpoints, voiceProtocolForModel, pickChatCatalogModels } from '@streaik/gateway';
import type { AgentBackend, ChatRoute, DirectChat, GatewayChatEndpoint, HostedAgentSelection } from '@streaik/gateway';
import type { CatalogModel, ChatMessage, ChatReasoning, ChatToolChoice, Gateway, GatewaySpeechEndpoint } from '@streaik/gateway';
import { Button, ThemeRoot, useColorScheme } from '@streaik/themes';
import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ChatComposer, AttachmentChip } from './ChatComposer';
import type { ComposerBadge } from './ChatComposer';
import { ComposerUsage } from './ComposerUsage';
import { httpLink } from './chatAttachments';
import { MessageActions } from './MessageActions';
import { MessageClock, MessageTime } from './MessageTime';
import { conversationGatewayCost, latestContextUsage, withReplyMetadata } from './messageMetadata';
import { AssistantSpeaker } from './AssistantSpeaker';
import { ChatIcon } from './ChatIcon';
import { ChatNavigation } from './ChatNavigation';
import type { ChatAccount, ChatView } from './ChatNavigation';
import { chatLocation, conversationPath, pagePaths } from './chatLocation';
import { ModelsView, ProvidersView } from './CatalogViews';
import { ModelPicker } from './ModelPicker';
import { AgentChatPicker, ChatModeButtons } from './AgentChatPicker';
import { browserAgentModel } from './agentChat';
import { useAgentChat } from './useAgentChat';
import { defaultAgentModelIds, resolveModelSelection } from './modelSelection';
import { selectDictationTarget } from './composerDictation';
import type { ComposerDictation } from './composerDictation';
import { dictationFormat } from './microphone';
import { liveSession, realtimeSession } from './realtimeSettings';
import { startVoiceConversation, voiceHistory } from './voiceConversation';
import type { VoiceCallbacks, VoiceSession } from './voiceConversation';
import { startSocketVoiceConversation } from './socketVoiceConversation';
import { socketVoiceSetup } from './socketVoiceSettings';
import { pageRouteMenu } from './routeMenu';
import { AgentsProvider, useAgents } from './AgentsProvider';
import { AgentsView } from './AgentsView';
import { SettingsDialog } from './SettingsDialog';
import { ChatSettingsDialog, ToolApprovalDialog, ViewContextDialog } from './ChatToolsDialogs';
import type { ToolReview } from './ChatToolsDialogs';
import { ChatActivity, groupMessageParts, invocationName } from './ChatActivity';
import type { Invocation } from './ChatActivity';
import { loadChatPreferences, saveChatPreferences } from './chatPreferences';
import type { ChatPreferences } from './chatPreferences';
import { chatProviderForModel, chatProviderRequest } from './providerChat/settings';
import type { ProviderChatSettings } from './providerChat/settings';
import { filterToolOutputContent } from './toolOutputContent';
import { buildRequestContext, requestContextText, withRequestContext } from './chatContext';
import type { RequestContext } from './chatContext';
import { activeChatTools, filterLocalToolReplay, localPlugins, runLocalTool, toolPartName } from './localPlugins';
import type { ChatTool } from './localPlugins';
import { agentMcpAllows, agentMcpServers } from './agentTools';
import { apiChatTools, chatRequestTools, chatToolCapabilities, configureChatTools } from './chatToolRequest';
import type { ChatRequestTool } from './chatToolRequest';
import { isClientToolSearch, searchClientTools, searchLocalToolCatalog } from './clientToolSearch';
import { continueToolPolicy, toolComplete, toolPolicyForTurn } from './chatToolPolicy';
import type { ChatToolPolicy, ToolProgress } from './chatToolPolicy';
import { resolveSkillTool } from './skillTools';
import type { TurnSkillArchives } from './skillTools';
import type { LocalSkill } from './skillBundles';
import { defaultSkillVersion } from './skillBundles';
import { SkillsView } from './SkillsView';
import { useLocalSkills } from './useLocalSkills';
import type { LocalSkills } from './useLocalSkills';
import { useRemoteSkills } from './useRemoteSkills';
import type { RemoteSkills } from './useRemoteSkills';
import { assignedAgent } from './agentCatalog';
import type { AgentsConfig } from './agentCatalog';
import { browserChatSkills } from './agentChatSkills';
import { agentModels as configuredAgentModels } from './agentDefinition';
import { agentProviderOptions, agentProviderRequest } from './agentProviderSettings';
import { conversationOpeningText, deleteConversation, listConversations, newConversation, newestFirst, saveConversation } from './conversations';
import type { Conversation } from './conversations';
import type { createConversationSearch, SearchConversationText, SearchHistory } from './conversationSearch';
import { callMcpTool, mcpFailure, readMcpResource } from './mcp';
import type { McpOptions } from './mcp';
import { McpElicitationProvider, useMcpElicitation } from './McpElicitation';
import { echoInputModel, isEchoInputCall, providerElicitationForm } from './providerElicitation';
import { mcpResourceCatalog, readResourceTool, resolveResourceRead } from './mcpChatContext';
import { McpServerEditor, McpServersView, ModelContextDialog } from './McpServersView';
import type { McpEditorTarget } from './McpServersView';
import { useMcpSelection, useMcpServers } from './useMcpServers';
import type { McpServers } from './useMcpServers';
export type { McpAppAuth, McpOptions, McpRemoteHeader } from './mcp';
export { isMcpRuntime } from './mcp';
import { chatDecisionInput, chatModelDecision, modelDecisionRouter, selectModelRoleId, useDecisionRoute } from './modelDecisions';
import type { ModelDecision } from './modelDecisions';
import { conversationNameRoleId, runTextAppAgent, toolSearchRoleId, welcomeRoleId } from './textAppAgents';
import type { TextAppRequest } from './textAppAgents';
import { WelcomeHeading } from './WelcomeHeading';
import { useAppTranslation } from './i18n';
import './chat.css';
import { useImageRoute } from './imageRoute';
import type { ImageRouteSetting } from './imageRoute';
import { useTranscriptionRoute } from './transcriptionPreferences';
import type { TranscriptionRouteSetting } from './transcriptionPreferences';
import { useSpeechRoute } from './speechPreferences';
import type { SpeechRouteSetting } from './speechPreferences';
import { useMessageSpeech } from './useMessageSpeech';
import type { MessageSpeechState, ToggleMessageSpeech } from './useMessageSpeech';
import { useVideoJobs } from './useVideoJobs';
export { BrowserRouter as ChatRouter } from 'react-router';
export { localizationReady, useAppTranslation } from './i18n';
export { default as providerDirectory } from './provider-directory.json';
export type { AgentsConfig } from './agentCatalog';
export type { AgentDefinition } from './agentDefinition';

const AssistantMarkdown = lazy(() => import('./AssistantMarkdown'));
const ImagesView = lazy(() => import('./ImagesView'));
const VideosView = lazy(() => import('./VideosView'));
const TranscriptionsView = lazy(() => import('./TranscriptionsView'));
const SpeechView = lazy(() => import('./SpeechView'));

type Connection = {
  ready: boolean;
  /** Host-selected stable account/profile ID, never an auth token or key. Omit to disable persistence. */
  historyProfile?: string;
  modelRevision?: number;
  emptyMessage: string;
  account?: ChatAccount;
  signIn?: ReactNode;
  settings?: ReactNode;
  apiKeySettings?: ReactNode;
  mcp?: McpOptions;
  /** Disallow MCP configuration and discard in-memory headers when the user signs out or locks the profile. */
  mcpSession?: boolean;
  direct?: DirectChat;
  agentBackend?: AgentBackend;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof GatewayError ? error.message : fallback;
}

function useModels(source: Gateway | DirectChat | undefined, ready: boolean, revision: number, scope?: string) {
  const { t } = useAppTranslation();
  const [result, setResult] = useState<{ source: Gateway | DirectChat; stamp: string; catalog: CatalogModel[]; error?: { detail?: string } }>();
  const [refresh, setRefresh] = useState(0);
  const stamp = JSON.stringify([scope, revision, refresh]);
  useEffect(() => {
    if (!ready || !source) return;
    const controller = new AbortController();
    void source.listModelCatalog(controller.signal).then(
      (catalog) => { if (!controller.signal.aborted) setResult({ source, stamp, catalog }); },
      (error: unknown) => {
        if (!controller.signal.aborted) setResult({ source, stamp, catalog: [], error: { detail: errorMessage(error, '') || undefined } });
      },
    );
    return () => controller.abort();
  }, [source, ready, stamp]);
  const current = ready && result && result.source === source && result.stamp === stamp ? result : undefined;
  return { result: current && { catalog: current.catalog, error: current.error && t(current.error.detail ?? 'Could not load models.') },
    reload: () => setRefresh((n) => n + 1) };
}

type MessagePreferences = Pick<ChatPreferences, 'showMessageTokens' | 'showProviderLogo' | 'showMetrics'>;

const Message = memo(function Message({ message, showMessageTokens, showProviderLogo, showMetrics, pendingReply, speechState, onReadAloud }: {
  message: ChatMessage; pendingReply: boolean; speechState?: MessageSpeechState; onReadAloud?: ToggleMessageSpeech;
} & MessagePreferences) {
  const { t } = useAppTranslation();
  const user = message.role === 'user';
  const groups = groupMessageParts(message.parts, user);
  if (!groups.length) return null;
  return <article className="chat-message" data-role={message.role} aria-label={t(user ? 'You' : 'Assistant')}>
    {user ? <MessageTime timestamp={message.metadata?.timestamp} /> : <div className="chat-message-header">
      <AssistantSpeaker model={message.metadata?.model} showProviderLogo={showProviderLogo} />
      <span className="chat-badge chat-ai-badge"><ChatIcon name="agents" />{t('Generated by AI')}</span>
      <MessageTime timestamp={message.metadata?.timestamp} />
    </div>}
    <div className="chat-message-body">
      {groups.map((group) => {
        if (group.type === 'attachment') {
          const url = group.part.type === 'file' ? httpLink(group.part.url) : undefined;
          return <AttachmentChip key={group.start} name={group.name ?? t('Attachments')} url={url}
            note={group.part.type === 'text' ? t('As text') : undefined} />;
        }
        if (group.type === 'activity') return <ChatActivity key={group.start} parts={group.parts}
          renderMarkdown={text => <Suspense fallback={<div className="chat-user-text">{text}</div>}><AssistantMarkdown text={text} /></Suspense>} />;
        return user ? <div key={group.start} className="chat-user-text">{group.text}</div>
          : <Suspense key={group.start} fallback={<div className="chat-user-text">{group.text}</div>}><AssistantMarkdown text={group.text} charts /></Suspense>;
      })}
    </div>
    <MessageActions message={message} showMessageTokens={showMessageTokens} showMetrics={showMetrics}
      pendingReply={pendingReply} speechState={speechState} onReadAloud={onReadAloud}
      userText={user ? groups.flatMap(group => group.type === 'text' ? [group.text] : []).join('\n\n') : undefined} />
  </article>;
});

function Transcript({ messages, showMessageTokens, showProviderLogo, showMetrics, gateway, speechModel, speechRoute, scope, pendingReply }: {
  messages: ChatMessage[]; gateway: Gateway; speechModel?: string; speechRoute: GatewaySpeechEndpoint; scope?: string; pendingReply?: string;
} & MessagePreferences) {
  const { t } = useAppTranslation();
  const speech = useMessageSpeech(gateway, speechModel, speechRoute, scope);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    const node = scroll.current;
    if (node && follow.current) node.scrollTop = node.scrollHeight;
  }, [messages, showMessageTokens, showProviderLogo, showMetrics]);
  return <section ref={scroll} onScroll={() => {
    const node = scroll.current;
    if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  }} className="chat-transcript" aria-label={t('Conversation')} tabIndex={0}>
    <MessageClock><div className="chat-column">{messages.map((message) => <Message key={message.id} message={message}
      pendingReply={message.id === pendingReply} speechState={speech.state?.id === message.id ? speech.state : undefined}
      onReadAloud={message.role === 'assistant' ? speech.toggle : undefined}
      showMessageTokens={showMessageTokens} showProviderLogo={showProviderLogo} showMetrics={showMetrics} />)}</div></MessageClock>
  </section>;
}

export function ChatApp({ appName = 'Streaik', gateway, connection, agents }: { appName?: string; gateway: Gateway; connection: Connection; agents?: AgentsConfig }) {
  const scope = connection.historyProfile ? JSON.stringify([gateway.historyScope, connection.historyProfile]) : undefined;
  const mcpSession = connection.mcpSession ?? (!connection.signIn || connection.ready);
  const settings = useRef<HTMLDialogElement>(null);
  const [route, setRoute] = useState<ChatRoute>({ mode: 'gateway', endpoint: '/api/chat' });
  const [profile, setProfile] = useState(() => ({ scope, preferences: loadChatPreferences(scope) }));
  const decisions = useDecisionRoute(scope);
  const images = useImageRoute(scope);
  const transcriptions = useTranscriptionRoute(scope);
  const speech = useSpeechRoute(scope);
  const models = useModels(route.mode === 'direct' ? connection.direct : gateway, connection.ready, connection.modelRevision ?? 0, scope);
  // Reload preferences on profile changes without remounting the user settings dialog.
  let preferences = profile.preferences;
  if (profile.scope !== scope) {
    preferences = loadChatPreferences(scope);
    setProfile({ scope, preferences });
  }
  function updatePreferences(next: ChatPreferences) {
    setProfile({ scope, preferences: next });
    saveChatPreferences(scope, next);
  }
  return <ThemeRoot>
    <AgentsProvider config={agents} scope={scope}>
      <McpElicitationProvider key={JSON.stringify([scope, mcpSession])} enabled={preferences.mcp.formElicitation}>
        <HistoryChat appName={appName} gateway={gateway} connection={connection} scope={scope} models={models} mcpSession={mcpSession}
          route={route} onRoute={setRoute} decisions={decisions} images={images} transcriptions={transcriptions} speech={speech} onSettings={() => settings.current?.showModal()}
          preferences={preferences} onPreferences={updatePreferences} />
      </McpElicitationProvider>
      <SettingsDialog dialog={settings} apiKeySettings={connection.apiKeySettings} accountSettings={connection.settings}
        preferences={preferences} onPreferences={updatePreferences} />
    </AgentsProvider>
  </ThemeRoot>;
}

function HistoryChat({ appName, gateway, connection, scope, models, route, onRoute, decisions, images, transcriptions, speech, onSettings, preferences, onPreferences, mcpSession }: {
  appName: string; gateway: Gateway; connection: Connection; scope?: string; models: ReturnType<typeof useModels>; onSettings: () => void;
  mcpSession: boolean;
  route: ChatRoute; onRoute: (route: ChatRoute) => void;
  decisions: ReturnType<typeof useDecisionRoute>;
  images: ImageRouteSetting;
  transcriptions: TranscriptionRouteSetting;
  speech: SpeechRouteSetting;
  preferences: ChatPreferences; onPreferences: (preferences: ChatPreferences) => void;
}) {
  const { t } = useAppTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [initialLocation] = useState(location);
  const target = chatLocation(location.pathname);
  const [nav, setNav] = useState(false);
  const agentsEnabled = !!useAgents();
  const localSkills = useLocalSkills(scope);
  const mcpServers = useMcpServers(scope, connection.mcp, mcpSession);
  const remoteSkills = useRemoteSkills(gateway, connection.ready && gateway.historyScope !== 'direct', connection.modelRevision ?? 0);
  const view = target.kind === 'page' && (target.view !== 'agents' || agentsEnabled) ? target.view : 'chat';
  const videos = useVideoJobs(gateway, scope, view === 'videos');
  const [draft, setDraft] = useState(newConversation);
  const [retained, setRetained] = useState(draft);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(!!scope);
  const [recentId, setRecentId] = useState<string>();
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [storageIssue, setStorageIssue] = useState('');
  // Transcript effects and pin clicks can both enqueue writes before React renders again.
  const latestHistory = useRef<Conversation[]>([]);
  const searchIndex = useRef<Promise<ReturnType<typeof createConversationSearch>>>(undefined);
  const searchHistoryActive = useRef(false);
  const writes = useRef(Promise.resolve());
  const pendingNames = useRef(new Map<string, AbortController>());
  const getSearchIndex = useCallback(() => {
    // HistoryChat is keyed by scope; neither stored history nor the index is shared with another profile.
    return searchIndex.current ??= import('./conversationSearch').then(({ createConversationSearch }) => createConversationSearch())
      .catch(error => { searchIndex.current = undefined; throw error; });
  }, []);
  const searchHistory = useCallback<SearchHistory>(async term => {
    searchHistoryActive.current = true;
    return (await getSearchIndex()).search(latestHistory.current, term);
  }, [getSearchIndex]);
  const searchConversationText = useCallback<SearchConversationText>(async (query, limit) => {
    return (await getSearchIndex()).searchText(latestHistory.current, query, limit);
  }, [getSearchIndex]);

  const resumeId = target.kind === 'home' && location === initialLocation && location.state?.newChat !== true ? recentId : undefined;
  const requestedId = target.kind === 'conversation' ? target.id : resumeId;
  const requested = requestedId ? history.find(item => item.id === requestedId) : undefined;
  const selected = view === 'chat' ? requested ?? draft : retained;
  // Preserve the session snapshot across catalog pages and when a draft's URL is promoted.
  const active = selected.id === retained.id ? retained : selected;
  if (active !== retained) setRetained(active);
  if (requested && target.kind === 'conversation' && requested.id === draft.id) setDraft(newConversation());
  const homeId = target.kind === 'home' && !loading ? requested?.id ?? (savedIds.has(draft.id) ? draft.id : undefined) : undefined;
  useEffect(() => {
    if (homeId) void navigate({ pathname: conversationPath(homeId), search: location.search, hash: location.hash }, { replace: true });
  }, [homeId, location.search, location.hash, navigate]);

  useEffect(() => {
    const pending = pendingNames.current;
    return () => {
      for (const controller of pending.values()) controller.abort();
      pending.clear();
    };
  }, [gateway, connection.ready, connection.modelRevision]);

  function updateHistory(records: Conversation[]) {
    latestHistory.current = records;
    setHistory(records);
    // Search is derived data. A background index failure must not affect the chat or its persistence.
    if (searchHistoryActive.current) void searchIndex.current?.then(index => index.sync(latestHistory.current)).catch(() => {});
  }

  useEffect(() => {
    if (!scope) return;
    let live = true;
    void listConversations(scope).then((records) => {
      if (!live) return;
      records.sort(newestFirst);
      updateHistory(records);
      setRecentId(records[0]?.id);
    }).catch(() => { if (live) setStorageIssue('Could not open local chat history.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [scope]);

  function save(conversation: Conversation) {
    if (scope) writes.current = writes.current.then(async () => {
      await saveConversation(scope, conversation);
      if (latestHistory.current.some(item => item.id === conversation.id)) {
        setSavedIds(ids => ids.has(conversation.id) ? ids : new Set(ids).add(conversation.id));
      }
    }).catch(() => setStorageIssue('Could not save this conversation to this browser.'));
  }

  function persist(conversation: Conversation, nameRequest?: TextAppRequest) {
    const records = latestHistory.current;
    const previous = records.find((item) => item.id === conversation.id);
    const merged = { ...conversation, metadata: { ...conversation.metadata,
      name: previous?.metadata?.name ?? conversation.metadata?.name, pinned: previous?.metadata?.pinned } };
    updateHistory([merged, ...records.filter((item) => item.id !== merged.id)]);
    save(merged);

    if (previous || !nameRequest || merged.metadata.name) return;
    const text = conversationOpeningText(merged);
    if (!text) return;
    const { id } = merged;
    const controller = new AbortController();
    pendingNames.current.set(id, controller);
    void runTextAppAgent(conversationNameRoleId, nameRequest, text, controller.signal).then(name => {
      if (pendingNames.current.get(id) !== controller) return;
      pendingNames.current.delete(id);
      if (!name || controller.signal.aborted) return;
      // Merge into the latest record, not the transcript that started the request.
      const records = latestHistory.current;
      const current = records.find(item => item.id === id);
      if (!current || current.metadata?.name) return;
      const renamed = { ...current, metadata: { ...current.metadata, name } };
      updateHistory(records.map(item => item.id === id ? renamed : item));
      save(renamed);
    });
  }

  function togglePin(id: string) {
    const records = latestHistory.current;
    const record = records.find((item) => item.id === id);
    if (!record) return;
    const updated = { ...record, metadata: { ...record.metadata, pinned: record.metadata?.pinned !== true } };
    updateHistory(records.map((item) => item.id === id ? updated : item));
    save(updated);
  }

  function remove(id: string) {
    pendingNames.current.get(id)?.abort();
    pendingNames.current.delete(id);
    updateHistory(latestHistory.current.filter((item) => item.id !== id));
    if (view === 'chat' && active.id === id) startDraft(true);
    else if (retained.id === id) setRetained(draft);
    if (recentId === id) setRecentId(undefined);
    setSavedIds(ids => {
      if (!ids.has(id)) return ids;
      const next = new Set(ids);
      next.delete(id);
      return next;
    });
    if (scope) writes.current = writes.current.then(() => deleteConversation(scope, id))
      .catch(() => setStorageIssue('Could not delete this conversation from this browser.'));
  }

  function startDraft(replace = false) {
    setDraft(newConversation());
    void navigate('/', { replace: replace || target.kind === 'home', state: { newChat: true } });
  }

  if (loading) return <p className="chat-start" role="status">{t('Loading chat history…')}</p>;
  const locationIssue = target.kind === 'conversation' && !requested ? 'This conversation is not available in this browser or profile.'
    : target.kind === 'unavailable' || target.kind === 'page' && view === 'chat' ? 'This page is not available.' : undefined;
  return <ChatSession key={active.id} appName={appName} gateway={gateway} connection={connection} conversation={active} history={history}
    searchHistory={searchHistory} searchConversationText={scope ? searchConversationText : undefined} storageIssue={storageIssue} locationIssue={locationIssue}
    nav={nav} view={view} onView={(next) => {
      if (next !== 'chat' && next !== view) void navigate(pagePaths[next]);
      if (window.matchMedia('(max-width: 42rem)').matches) setNav(false);
    }} toggleNav={() => setNav((open) => !open)} onPersist={persist}
    onNew={() => startDraft()}
    onSwitch={(item) => {
      if (target.kind !== 'conversation' || target.id !== item.id) void navigate(conversationPath(item.id));
      if (window.matchMedia('(max-width: 42rem)').matches) setNav(false);
    }} onPin={togglePin} onDelete={remove}
    models={models} route={route} onRoute={onRoute} decisions={decisions} images={images} videos={videos} transcriptions={transcriptions} speech={speech} scope={scope} onSettings={onSettings}
    preferences={preferences} onPreferences={onPreferences}
    localSkills={localSkills} remoteSkills={remoteSkills} mcpServers={mcpServers} readHistory={scope ? () => latestHistory.current : undefined} />;
}

type HostedTurn = { endpoint: GatewayChatEndpoint; selection: HostedAgentSelection };
type VoiceRun = { controller: AbortController; session?: VoiceSession };
type Turn = { model: string; route: ChatRoute; tools: ChatTool[]; context?: RequestContext; hosted?: HostedTurn;
  requestTools: ChatRequestTool[];
  voiceMessage?: string; liveClient?: { id: string; lastId?: string; finished: boolean };
  catalog: readonly CatalogModel[]; skills: readonly LocalSkill[]; skillArchives?: TurnSkillArchives;
  providerSettings?: ProviderChatSettings; reasoning?: ChatReasoning; toolSearchAgent?: TextAppRequest;
  toolPolicy: ChatToolPolicy; toolChoice?: ChatToolChoice; toolProgress: ToolProgress; resolved: Set<string> };
const isApiChat = (route: ChatRoute | undefined) => !route || (route.mode === 'gateway' && route.endpoint === '/api/chat');

function ChatSession({ appName, gateway, connection, conversation, history, searchHistory, searchConversationText, storageIssue, locationIssue, nav, view, onView, toggleNav, onPersist, onNew, onSwitch, onPin, onDelete, models, route, onRoute, decisions, images, videos, transcriptions, speech, scope, onSettings, preferences, onPreferences, localSkills, remoteSkills, mcpServers, readHistory }: {
  appName: string; gateway: Gateway; connection: Connection; conversation: Conversation; history: Conversation[]; storageIssue: string;
  searchHistory: SearchHistory;
  searchConversationText?: SearchConversationText;
  locationIssue?: string;
  nav: boolean; toggleNav: () => void; onPersist: (conversation: Conversation, nameRequest?: TextAppRequest) => void; onNew: () => void;
  view: ChatView; onView: (view: ChatView) => void;
  onSwitch: (conversation: Conversation) => void; onPin: (id: string) => void; onDelete: (id: string) => void;
  models: ReturnType<typeof useModels>; onSettings: () => void;
  route: ChatRoute; onRoute: (route: ChatRoute) => void;
  decisions: ReturnType<typeof useDecisionRoute>;
  images: ImageRouteSetting;
  videos: ReturnType<typeof useVideoJobs>;
  transcriptions: TranscriptionRouteSetting;
  speech: SpeechRouteSetting;
  scope?: string;
  preferences: ChatPreferences; onPreferences: (preferences: ChatPreferences) => void;
  localSkills: LocalSkills;
  remoteSkills: RemoteSkills;
  mcpServers: McpServers;
  readHistory?: () => readonly Conversation[];
}) {
  const { t, i18n } = useAppTranslation();
  const darkMode = useColorScheme() === 'dark';
  const agents = useAgents();
  const defaultChatAgent = assignedAgent(agents, 'chat');
  const [useAgentMode, setAgentMode] = useState(false);
  const agentModeEnabled = !!(agents || connection.agentBackend);
  const agentMode = useAgentMode && agentModeEnabled;
  const [selectedIds, setSelectedIds] = useState<string[] | undefined>(() =>
    conversation.metadata?.model ? [conversation.metadata.model] : undefined);
  const [pendingModel, setPendingModel] = useState<string>();
  const [deciding, setDeciding] = useState(false);
  const [turn, setTurn] = useState<Turn>();
  const voiceRun = useRef<VoiceRun | undefined>(undefined);
  const [voicePhase, setVoicePhase] = useState<'connecting' | 'active' | 'closing'>();
  const [voiceNotice, setVoiceNotice] = useState('');
  useEffect(() => () => {
    const run = voiceRun.current;
    voiceRun.current = undefined;
    run?.controller.abort();
  }, []);
  const chatSettings = useRef<HTMLDialogElement>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [menuContainer, setMenuContainer] = useState<HTMLDivElement | null>(null);
  const [catalogToolbar, setCatalogToolbar] = useState<HTMLDivElement | null>(null);
  const [mediaToolbar, setMediaToolbar] = useState<HTMLDivElement | null>(null);
  const saved = useRef(conversation.messages);
  const nameRequest = useRef<TextAppRequest>(undefined);
  const direct = connection.direct;
  const hasGateway = gateway.historyScope !== 'direct';
  const directEndpoints = direct?.endpoints(!connection.ready);
  const revision = connection.modelRevision ?? 0;
  const agentChat = useAgentChat({ active: agentMode && view === 'chat', backend: connection.agentBackend, ready: connection.ready,
    scope, revision, entries: agents?.entries ?? [],
    gateway: hasGateway, direct: directEndpoints ?? [] });
  const agentRoute = agentMode ? agentChat.route : undefined;
  const hostedRoute = agentRoute?.mode === 'agents' ? agentRoute : undefined;
  const runRoute = agentRoute && agentRoute.mode !== 'agents' ? agentRoute : route;
  const chatAgent = agentMode ? agentChat.definition : defaultChatAgent;
  const fallbackSource = runRoute.mode !== route.mode ? runRoute.mode === 'direct' ? direct : gateway : undefined;
  const fallbackModels = useModels(fallbackSource, connection.ready && agentMode && !hostedRoute, revision, scope);
  // Agents and media use the gateway catalog even when chat is routed directly.
  const mediaView = view === 'images' || view === 'videos' || view === 'transcriptions' || view === 'speech';
  const dictateChat = preferences.dictate && view === 'chat' && !locationIssue;
  const dictateView = dictateChat || preferences.dictate && (view === 'images' || view === 'videos' || view === 'speech');
  const transcriptionModelIds = dictateView ? defaultAgentModelIds(assignedAgent(agents, 'transcription')) : [];
  const speechModelIds = hasGateway && view === 'chat' && !locationIssue ? defaultAgentModelIds(assignedAgent(agents, 'speech')) : [];
  const fetchGatewayModels = route.mode === 'direct' && (view === 'agents' ||
    hasGateway && (mediaView || transcriptionModelIds.length > 0 || speechModelIds.length > 0));
  const gatewayModels = useModels(gateway, connection.ready && fetchGatewayModels, connection.modelRevision ?? 0, scope);
  const transport = useMemo<ReturnType<Gateway['chatTransport']>>(() => {
    const apiChat = gateway.chatTransport();
    return {
      async sendMessages(request) {
        const last = request.messages.at(-1);
        const previous = request.trigger === 'submit-message' && last?.role === 'assistant' ? last : undefined;
        const { route, decision, context, providerSettings, clientToolSearch, hosted, ...body } = (request.body ?? {}) as {
          model?: string; route?: ChatRoute; decision?: ModelDecision; context?: RequestContext; tools?: ChatRequestTool[];
          providerSettings?: ProviderChatSettings; hosted?: HostedTurn; reasoning?: ChatReasoning; toolChoice?: ChatToolChoice;
          clientToolSearch?: boolean;
        };
        if (hosted) {
          if (!connection.agentBackend) throw new GatewayError('The agent backend is not configured.');
          // Do not replay browser tool outputs (or send browser MCP credentials) to a hosted runtime.
          const messages = request.messages.flatMap(message => {
            const parts = message.parts.filter(part => part.type === 'text' || (message.role === 'user' && part.type === 'file'));
            return parts.length ? [{ ...message, parts }] : [];
          });
          const stream = await connection.agentBackend.chatTransport(hosted.endpoint, hosted.selection).sendMessages({ ...request, body: undefined, messages });
          return withReplyMetadata(stream, body.model, previous);
        }
        let model = body.model;
        const enabledSkillIds = new Set(context?.skills?.skills.map(({ skill_id }) => skill_id));
        const resourceServers = new Set(context?.mcp?.mcpResourceCatalog.servers.map(({ serverId }) => serverId));
        const replay = filterLocalToolReplay(request.messages, body.tools ?? [], isApiChat(route), enabledSkillIds, resourceServers);
        request = { ...request, body, messages: filterToolOutputContent(replay, preferences.toolOutput) };
        if (route?.mode === 'gateway' && decision) {
          const { endpoint, ...choice } = decision;
          const input = chatDecisionInput(request.messages);
          if (!input.length) setPendingModel(body.model);
          else {
            setDeciding(true);
            try {
              const winner = await gateway.decideChoice(endpoint, { ...choice, input }, request.abortSignal);
              request.abortSignal?.throwIfAborted();
              model = winner;
              setPendingModel(winner);
              setTurn((current) => current && { ...current, model: winner });
              request = { ...request, body: { ...body, model: winner } };
            } finally { setDeciding(false); }
          }
        }
        // A provider form is a continuation, not a historical tool result that can go to another model.
        request = { ...request, messages: request.messages.flatMap((message, index, history) => {
          if (isApiChat(route) && model === echoInputModel && index === history.length - 1 && message.role === 'assistant') return [message];
          const parts = message.parts.filter(part => !('toolCallId' in part && isEchoInputCall(part)));
          return parts.length === message.parts.length ? [message] : parts.some(part => part.type !== 'step-start') ? [{ ...message, parts }] : [];
        }) };
        const provider = chatProviderRequest(providerSettings, model, clientToolSearch === true);
        const headers = new Headers(request.headers);
        for (const [key, value] of Object.entries(provider?.headers ?? {})) headers.set(key, value);
        if (isApiChat(route)) {
          const { tools, namespaces } = apiChatTools(body.tools ?? [], route, model);
          const providerMetadata = provider?.providerMetadata;
          const openai = providerMetadata?.openai;
          const existing = Array.isArray(openai?.tools) ? openai.tools : [];
          const metadata = namespaces.length ? { ...providerMetadata, openai: { ...openai, tools: [...existing, ...namespaces] } } : providerMetadata;
          const hasTools = tools.length || Object.values(metadata ?? {}).some(options => Array.isArray(options?.tools) && options.tools.length > 0);
          const toolChoice = body.toolChoice === 'required' && !hasTools ? undefined : body.toolChoice;
          const stream = await apiChat.sendMessages({ ...request, headers, body: { ...request.body,
            tools, toolChoice, ...(metadata && { providerMetadata: metadata }) },
            messages: withRequestContext(request.messages, context) });
          return withReplyMetadata(stream, model, previous);
        }
        const nativeOptions = route?.endpoint === '/v1/responses' && provider?.providerMetadata.openai
          ? { providerMetadata: provider.providerMetadata } : {};
        if (route?.mode === 'gateway' && gatewayChatEndpoints.includes(route.endpoint)) {
          const stream = await gateway.chatTransport(route.endpoint).sendMessages({ ...request, headers,
            body: { ...request.body, ...nativeOptions, ...(context && { instructions: requestContextText(context) }) } });
          return withReplyMetadata(stream, model, previous);
        }
        if (route?.mode === 'direct' && direct && nativeChatEndpoints.includes(route.endpoint)) {
          // Direct native transports use this field for client-provided system context.
          const stream = await direct.chatTransport(route.endpoint).sendMessages({ ...request, headers,
            body: { ...request.body, ...nativeOptions, ...(context && { mcpInstructions: requestContextText(context) }) } });
          return withReplyMetadata(stream, model, previous);
        }
        throw new GatewayError('The selected chat route is unavailable.');
      },
      async reconnectToStream() { return null; },
    };
  }, [gateway, direct, connection.agentBackend, preferences.toolOutput]);
  const { messages, sendMessage, regenerate, setMessages, addToolOutput, stop, status, error } = useChat({
    id: conversation.id, messages: conversation.messages, transport, throttle: preferences.delay || undefined,
  });
  const latestMessages = useRef(messages);
  useLayoutEffect(() => { latestMessages.current = messages; }, [messages]);
  useEffect(() => () => { void stop(); }, [stop]);
  const [modelContextOpen, setModelContextOpen] = useState(false);
  const [mcpEditor, setMcpEditor] = useState<McpEditorTarget>();
  const mcpSelection = useMcpSelection(mcpServers);
  const declaredMcp = view === 'chat' && !hostedRoute ? agentMcpServers(chatAgent?.mcpServers).filter(({ server }) => server.disabled !== true) : [];
  const agentMcp = useMcpSelection(mcpServers, mcpServers.records.filter(record => declaredMcp.some(entry => entry.endpoint === record.endpoint)));
  const connectedMcp = hostedRoute ? [] : [...agentMcp.connected, ...mcpSelection.connected.filter(({ record }) =>
    !agentMcp.connected.some(entry => entry.record === record))];
  const missingMcp = declaredMcp.filter(({ endpoint }) => !connectedMcp.some(({ record }) => record.endpoint === endpoint));
  const connectingMcp = !hostedRoute && (mcpSelection.loading || agentMcp.loading);
  const [toolNotice, setToolNotice] = useState('');
  const [toolBusy, setToolBusy] = useState(false);
  const [staged, setStaged] = useState<{ turn: Turn; callId: string; result: { output: unknown } }>();
  const operation = useRef<AbortController | null>(null);
  const elicit = useMcpElicitation();
  const elicitProvider = useMcpElicitation(true);
  const hasHistory = !!readHistory;
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const gatewayRoute = !hostedRoute && runRoute.mode === 'gateway';
  const appAgentContext = useMemo(() => buildRequestContext(appName, language, darkMode), [appName, language, darkMode]);
  const appAgentTransport = useMemo(() => route.mode === 'direct' ? direct?.chatTransport(route.endpoint)
    : gateway.chatTransport(route.endpoint), [gateway, direct, route]);
  const { online: skillsOnline, skills: providerSkills, busy: skillsBusy, needsLoad: needsSkills, cursor: skillCursor,
    error: skillCatalogError, load: loadSkills } = remoteSkills;
  const skillMode = hostedRoute ? 'agents' : runRoute.mode;
  const attachedSkills = view === 'chat' ? chatAgent?.skills : undefined;
  const chatSkills = useMemo(() => browserChatSkills({ mode: skillMode, skills: attachedSkills, local: localSkills.skills,
    catalog: providerSkills, selectedIds: preferences.remoteSkillIds, gateway: skillsOnline ? gateway : undefined }),
    [skillMode, attachedSkills, localSkills.skills, providerSkills, preferences.remoteSkillIds, skillsOnline, gateway]);
  // Restore saved selections even if the user never opens the Skills tab in this session.
  const restoringSkills = view === 'chat' && chatSkills.missingCatalog
    && skillCatalogError === undefined && (skillsBusy || needsSkills || !!skillCursor);
  useEffect(() => {
    if (restoringSkills && !skillsBusy) loadSkills(skillCursor);
  }, [restoringSkills, skillsBusy, loadSkills, skillCursor]);
  const hasSkills = chatSkills.archives.length > 0 || chatSkills.local.some(({ enabled }) => enabled);
  const mcpCatalog = mcpResourceCatalog(connectedMcp);
  const mcpTools = connectedMcp.flatMap(({ record, discovery }) => {
    const declaration = declaredMcp.find(entry => entry.endpoint === record.endpoint);
    return declaration ? discovery.tools.filter(tool => agentMcpAllows(declaration.server, tool.remoteName)) : discovery.tools;
  }).filter((tool, index, all) => all.findIndex(other => other.name === tool.name) === index);
  const enabledTools = hostedRoute ? [] : activeChatTools(runRoute, preferences.plugins, hasHistory, mcpTools, hasSkills, mcpCatalog ? readResourceTool : undefined);
  const configuredTools = configureChatTools(enabledTools, preferences.toolRequestConfig, preferences.useToolNamespaces, chatAgent);
  const baseContext = useMemo(() => gatewayRoute || hasSkills ? buildRequestContext(appName, language, darkMode, chatSkills.local, chatSkills.archives) : undefined,
    [gatewayRoute, hasSkills, appName, language, darkMode, chatSkills]);
  const chatInstructions = hostedRoute ? undefined : chatAgent?.instructions;
  const context = mcpCatalog || chatInstructions ? { ...baseContext, ...(mcpCatalog && { mcp: mcpCatalog }),
    ...(chatInstructions && { chatInstructions }) } : baseContext;
  const badges: ComposerBadge[] = [
    ...(hostedRoute ? [] : mcpSelection.connected).filter(({ record }) => !agentMcp.connected.some(entry => entry.record === record))
      .map(({ record }) => ({ key: `mcp:${record.id}`, label: record.title, icon: 'providers' as const,
      remove: () => mcpSelection.set(record, false) })),
    ...localPlugins.filter(plugin => enabledTools.some(tool => tool.source === 'local' && tool.plugin === plugin)).map(plugin => ({
      key: `tool:${plugin.id}`, label: t(plugin.label), icon: 'tool' as const,
      remove: () => onPreferences({ ...preferences, plugins: preferences.plugins.filter(id => id !== plugin.id) }),
    })),
    ...(gatewayRoute ? localSkills.skills.filter(skill => skill.enabled).map(skill => ({ key: `skill:${skill.id}`,
      label: defaultSkillVersion(skill).metadata.name, icon: 'docs' as const,
      remove: () => localSkills.update(items => items.map(item => item.id === skill.id ? { ...item, enabled: false } : item)),
    })) : []),
    ...chatSkills.preferenceSkills.map(skill => ({ key: `remote-skill:${skill.id}`, label: skill.name, icon: 'docs' as const,
      remove: () => onPreferences({ ...preferences, remoteSkillIds: preferences.remoteSkillIds.filter(id => id !== skill.id) }),
    })),
  ];
  const last = turn?.voiceMessage ? messages.find(message => message.id === turn.voiceMessage) : messages.at(-1);
  const parts = last?.role === 'assistant' ? last.parts : [];
  const isSearch = (part: Invocation) => !!turn?.toolSearchAgent && !turn.voiceMessage && turn.model.startsWith('openai/') &&
    toolPartName(part) === 'tool_search' && isClientToolSearch(part.input, part.toolCallId, part.callProviderMetadata);
  const toolParts = parts.flatMap(part => {
    if (!('toolCallId' in part) || !turn || turn.hosted || (!turn.voiceMessage && turn.toolChoice === 'none') || part.providerExecuted || turn.toolProgress.seen.has(part.toolCallId)) return [];
    const name = toolPartName(part);
    if (isApiChat(turn.route) && turn.model === echoInputModel && isEchoInputCall(part)) return [{ part, tool: undefined }];
    const tool = turn.tools.find(tool => tool.definition.name === name);
    return tool || isSearch(part) || (isApiChat(turn.route) && part.state === 'approval-requested') ? [{ part, tool }] : [];
  });
  const pending = toolParts.find(({ part }) => !toolComplete(part) && !turn?.resolved.has(part.toolCallId));
  const stagedResult = staged && staged.turn === turn && staged.callId === pending?.part.toolCallId ? staged.result : undefined;
  useEffect(() => () => { operation.current?.abort(); }, []);

  function requestBody(turn: Turn) {
    return { model: turn.model, route: turn.route, context: turn.context, providerSettings: turn.providerSettings, hosted: turn.hosted,
      tools: turn.requestTools, toolChoice: turn.toolChoice, clientToolSearch: !!turn.toolSearchAgent, ...(turn.reasoning && { reasoning: turn.reasoning }) };
  }

  // When Gateway review is required, stage results outside the SDK transcript until approved.
  // Continue once per completed batch, with the original route, model and tool set.
  useEffect(() => {
    if (status !== 'ready' || toolBusy || operation.current || !turn) return;
    if (!toolParts.length) {
      if (turn.liveClient && last?.role === 'assistant' && last.id !== turn.liveClient.lastId) finishLiveClient(turn, last);
      return;
    }
    if (pending && isSearch(pending.part)) {
      const api = isApiChat(turn.route);
      if (pending.part.state === (api ? 'approval-requested' : 'input-available') && !stagedResult)
        void completeSearch(turn, pending.part, api);
      return;
    }
    if (pending && isApiChat(turn.route)) {
      const { part, tool } = pending;
      if (turn.model === echoInputModel && isEchoInputCall(part) && part.state === 'approval-requested') {
        void answerProviderForm(part);
        return;
      }
      if (part.state !== 'approval-requested' || !tool) {
        setToolNotice('The gateway did not return an approval for this client tool.');
        setTurn(undefined);
      } else if (!stagedResult) {
        void completeTool(part, tool, 'stage');
      }
      return;
    }
    if (pending?.part.state === 'input-available' && pending.tool) {
      const { part, tool } = pending;
      const gatewayTool = turn.route.mode === 'gateway';
      if (gatewayTool && tool.source === 'local' && tool.plugin.approval) return;
      if (stagedResult) return;
      const reviewResult = gatewayTool && (tool.source === 'mcp' || tool.source === 'mcp-resource');
      void completeTool(part, tool, reviewResult ? 'stage' : 'run');
      return;
    }
    if (toolParts.every(({ part }) => toolComplete(part))) {
      turn.toolChoice = continueToolPolicy(turn.toolPolicy, parts, turn.toolProgress);
      if (turn.voiceMessage) {
        voiceRun.current?.session?.continueTools(turn.toolChoice, turn.toolChoice === 'none' && (voiceProtocol === 'live' || voiceProtocol === 'xai'));
        setTurn(undefined);
      } else {
        void sendMessage(undefined, { body: requestBody(turn) });
      }
    }
  });

  async function completeSearch(target: Turn, part: Invocation, review: boolean) {
    if (!target.toolSearchAgent || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setToolBusy(true);
    try {
      const output = await searchClientTools(target.toolSearchAgent, part.input, target.requestTools, target.route, target.model, controller.signal);
      controller.signal.throwIfAborted();
      if (review) setStaged({ turn: target, callId: part.toolCallId, result: { output } });
      else {
        target.resolved.add(part.toolCallId);
        await addToolOutput({ tool: 'tool_search', toolCallId: part.toolCallId, output });
      }
    } catch {
      if (!controller.signal.aborted) { setToolNotice('Could not complete the tool search.'); setTurn(undefined); }
    } finally {
      if (operation.current === controller) { operation.current = null; setToolBusy(false); }
    }
  }

  async function answerProviderForm(part: Invocation) {
    if (!turn || !last || !elicitProvider || part.state !== 'approval-requested') return;
    const form = providerElicitationForm(part);
    if (!form) { setToolNotice('Invalid provider input form.'); setTurn(undefined); return; }
    const controller = new AbortController();
    operation.current = controller;
    setToolBusy(true);
    try {
      const output = await elicitProvider(form, { title: 'Echo', origin: 'echo' }, controller.signal);
      if (controller.signal.aborted) return;
      turn.resolved.add(part.toolCallId);
      // Decline and cancel are MCP result values, not permission to read/send form data.
      const answered: Invocation = { ...part, state: 'output-available', approval: { ...part.approval, approved: true }, output };
      setMessages(current => current.map(message => message.id === last.id ? { ...message,
        parts: message.parts.map(item => 'toolCallId' in item && item.toolCallId === part.toolCallId ? answered : item) } : message));
    } catch {
      if (!controller.signal.aborted) { setToolNotice('Could not apply the provider input result.'); setTurn(undefined); }
    } finally {
      if (operation.current === controller) { operation.current = null; setToolBusy(false); }
    }
  }

  async function completeTool(part: Invocation, tool: ChatTool, action: 'stage' | 'run' | 'decline') {
    if (!turn || turn.resolved.has(part.toolCallId) || operation.current || status !== 'ready') return;
    const controller = new AbortController();
    // The render snapshot can lag behind addToolOutput when message updates are throttled.
    if (action !== 'stage') turn.resolved.add(part.toolCallId);
    operation.current = controller; setToolBusy(true);
    try {
      let output: unknown;
      if (tool.source === 'local') {
        output = action === 'decline' ? { isError: true, content: [{ type: 'text', text: 'The user declined to share local chat history.' }] }
          : await runLocalTool(tool, part.input, { catalog: turn.catalog, history: tool.plugin.requiresHistory ? readHistory?.() ?? [] : [],
            searchConversationText: tool.plugin.requiresHistory ? searchConversationText : undefined,
            searchTools: goal => searchLocalToolCatalog(turn.toolSearchAgent, goal, turn.requestTools,
              turn.model.startsWith('anthropic/') && (isApiChat(turn.route) || turn.route.endpoint === '/v1/messages'), controller.signal) });
      } else if (tool.source === 'skill') {
        output = await resolveSkillTool(tool.definition.name, part.input, turn.skills, turn.skillArchives, controller.signal);
      } else if (tool.source === 'mcp-resource') {
        const target = resolveResourceRead(connectedMcp, part.input);
        const enabled = target && turn.context?.mcp?.mcpResourceCatalog.servers.some(server => server.serverId === target.record.id);
        const server = enabled ? mcpServers.connection(target.record) : undefined;
        if (!target || !server) output = 'Choose a connected MCP server and an absolute resource URI.';
        else try {
          const { contents } = await readMcpResource(server, target.uri, controller.signal, elicit);
          output = { contents };
        } catch (error) { output = mcpFailure(error); }
      } else {
        const record = mcpServers.records.find(record => record.id === tool.tool.server.id && record.endpoint === tool.tool.server.endpoint);
        const server = record && mcpServers.connection(record);
        if (!server) output = 'MCP is unavailable.';
        else try {
          ({ output } = await callMcpTool({ ...tool.tool, server }, part.input, controller.signal, preferences.mcp, elicit));
        } catch (error) { output = mcpFailure(error); }
      }
      if (controller.signal.aborted) return;
      if (action === 'stage') setStaged({ turn, callId: part.toolCallId, result: { output } });
      else await applyToolOutput(turn, part.toolCallId, tool, output);
    } catch {
      if (!controller.signal.aborted) { setToolNotice('Could not apply the tool result.'); setTurn(undefined); }
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (!controller.signal.aborted) setToolBusy(false);
      }
    }
  }

  async function applyToolOutput(target: Turn, id: string, tool: ChatTool, output: unknown) {
    if (!target.voiceMessage) return addToolOutput({ tool: tool.definition.name, toolCallId: id, output });
    const session = voiceRun.current?.session;
    if (!session) return;
    const result: Invocation = { type: 'dynamic-tool', toolName: tool.definition.name, toolCallId: id, state: 'output-available', input: undefined, output };
    const [filtered] = filterToolOutputContent([{ id: target.voiceMessage, role: 'assistant', parts: [result] }], preferences.toolOutput);
    const part = filtered.parts[0];
    session.toolResult(id, 'output' in part ? part.output : output);
    setMessages(current => current.map(message => message.id !== target.voiceMessage ? message : { ...message,
      parts: message.parts.map(part => part.type === 'dynamic-tool' && part.state === 'input-available' && part.toolCallId === id
        ? { ...part, state: 'output-available' as const, output } : part) }));
  }

  function answerTool(approved: boolean) {
    if (!turn || turn.route.mode === 'direct' || !pending || !last || toolBusy || operation.current || status !== 'ready') return;
    const { part, tool } = pending;
    if (turn.resolved.has(part.toolCallId)) return;
    if (!isApiChat(turn.route)) {
      if (tool?.source === 'mcp' || tool?.source === 'mcp-resource') {
        if (!stagedResult || part.state !== 'input-available') return;
        turn.resolved.add(part.toolCallId);
        setStaged(undefined);
        void applyToolOutput(turn, part.toolCallId, tool, approved ? stagedResult.output : 'The user declined to share this tool result.');
      } else if (tool) void completeTool(part, tool, approved ? 'run' : 'decline');
      return;
    }
    const result = stagedResult;
    if (part.state !== 'approval-requested' || !result) return;
    turn.resolved.add(part.toolCallId);
    setStaged(undefined);
    // Apply the decision and approved output atomically, preserving a signature when provided.
    const approval = { ...part.approval, approved };
    const answered: Invocation = approved
      ? { ...part, state: 'output-available', approval: { ...approval, approved: true }, output: result.output }
      : { ...part, state: 'approval-responded', approval, output: undefined };
    setMessages(current => current.map(message => message.id === last.id ? { ...message,
      parts: message.parts.map(item => 'toolCallId' in item && item.toolCallId === part.toolCallId ? answered : item) } : message));
  }

  function createTurn(model: string): Turn {
    const seen = new Set(latestMessages.current.flatMap(message => message.parts.flatMap(part => 'toolCallId' in part ? [part.toolCallId] : [])));
    const toolPolicy = toolPolicyForTurn(preferences.toolPolicy, new Set(enabledTools.map(tool => tool.definition.name)));
    const searchAgent = assignedAgent(agents, toolSearchRoleId);
    const searchModel = configuredAgentModels(searchAgent).find(({ id, type }) => type !== 'decision' && compatibleById.has(id));
    const toolSearchAgent = !hostedRoute && searchModel && searchAgent && appAgentTransport
      ? { model: searchModel.id, instructions: searchAgent.instructions, transport: appAgentTransport, context: appAgentContext } : undefined;
    return { model, route: runRoute, tools: enabledTools, context, catalog: runCatalog, skills: chatSkills.local,
      toolPolicy, toolChoice: hostedRoute ? undefined : toolPolicy.toolChoice, toolProgress: { seen, completed: 0 }, resolved: new Set(),
      requestTools: chatRequestTools(configuredTools), toolSearchAgent,
      hosted: hostedRoute && hostedSelection ? { endpoint: hostedRoute.endpoint, selection: hostedSelection } : undefined,
      providerSettings: !hostedRoute && (isApiChat(runRoute) || runRoute.endpoint === '/v1/responses') ? turnProviderSettings : undefined,
      reasoning: !hostedRoute && isApiChat(runRoute) && preferences.reasoning !== 'none' ? preferences.reasoning : undefined,
      skillArchives: chatSkills.archives.length ? { skills: chatSkills.archives, bundles: new Map() } : undefined };
  }

  function beginTurn(model: string) {
    setToolNotice('');
    setPendingModel(decision ? undefined : model);
    const next = createTurn(model);
    setTurn(next);
    return { ...requestBody(next), ...(decision && { decision }) };
  }

  function stopTurn() {
    operation.current?.abort();
    operation.current = null;
    setToolBusy(false);
    setStaged(undefined);
    setTurn(undefined);
    void stop();
    const run = voiceRun.current;
    if (!run) return;
    if (run.session) { setVoicePhase('closing'); run.session.stop(); }
    else run.controller.abort();
  }

  function pendingReview(): ToolReview | undefined {
    if (!turn || turn.route.mode === 'direct' || !pending || status !== 'ready') return;
    const { tool, part } = pending;
    const name = tool?.source === 'mcp' ? tool.tool.title || tool.tool.remoteName : invocationName(part);
    const details = { id: part.toolCallId, name, input: part.input, disabled: toolBusy || !connection.ready };
    if (stagedResult) return { ...details, kind: 'result', ...stagedResult };
    if (!isApiChat(turn.route) && part.state === 'input-available' && tool?.source === 'local' && tool.plugin.approval) {
      return { ...details, kind: 'execution' };
    }
  }
  const review = pendingReview();
  const { result, reload } = models;
  const busy = status === 'submitted' || status === 'streaming';
  const progress = busy ? deciding ? t('Choosing a model…') : t('Assistant is responding…')
    : toolBusy && turn ? t('Running tool…') : undefined;
  const catalog = result?.catalog ?? [];
  const agentModels = route.mode === 'direct' ? gatewayModels.result : result;
  const mediaModels = hasGateway ? agentModels : undefined;
  const dictationTarget = dictateView && transcriptionModelIds.length > 0 && mediaModels && !mediaModels.error &&
    typeof globalThis.navigator?.mediaDevices?.getUserMedia === 'function' && selectDictationTarget(mediaModels.catalog, transcriptionModelIds, {
      socket: typeof WebSocket !== 'undefined' && typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined',
      peer: typeof RTCPeerConnection !== 'undefined', recorder: !!dictationFormat(),
    });
  const dictation: ComposerDictation = dictateView ? dictationTarget ? { ...dictationTarget, gateway } : null : undefined;
  const mediaRouter = (view === 'images' || view === 'speech') && mediaModels ? modelDecisionRouter(agents, mediaModels.catalog, decisions.selected) : undefined;
  const mediaStatus = !hasGateway ? t('No gateway is configured.') : !connection.ready ? connection.emptyMessage
    : !mediaModels ? t('Loading models…') : mediaModels.error;
  const speechModel = speechModelIds.length && mediaModels && !mediaModels.error
    ? resolveModelSelection(mediaModels.catalog.filter(({ type }) => type === 'speech'), undefined, false, speechModelIds).selected[0]?.id
    : undefined;
  const agentModelStatus = !connection.ready ? t('Connect to the gateway to browse models. You can still edit this agent.')
    : !agentModels ? t('Loading gateway models…') : agentModels.error;
  const textCatalog = pickChatCatalogModels(catalog);
  const compatible = route.mode === 'direct' ? catalog.filter(item => direct?.supports(item.provider, route.endpoint))
    : [...textCatalog, ...catalog.filter(isVoiceCatalogModel)];
  const router = !agentMode && gatewayRoute ? modelDecisionRouter(agents, catalog, decisions.selected) : undefined;
  const { selected } = resolveModelSelection<CatalogModel>(compatible, selectedIds, !!router, defaultAgentModelIds(defaultChatAgent));
  const compatibleById = new Map((route.mode === 'direct' ? compatible : textCatalog).map(model => [model.id, model]));
  const runResult = fallbackSource ? fallbackModels.result : result;
  const runCatalog = runResult?.catalog ?? [];
  const runCompatible = runRoute.mode === 'direct' ? runCatalog.filter(item => direct?.supports(item.provider, runRoute.endpoint))
    : pickChatCatalogModels(runCatalog);
  const browserModel = agentMode && !hostedRoute ? browserAgentModel(chatAgent, runCompatible, selected.find(model => !isVoiceCatalogModel(model))) : undefined;
  const provider = browserModel && chatProviderForModel(browserModel.id);
  const agentModelOptions = browserModel && configuredAgentModels(chatAgent).find(({ id }) => id === browserModel.id);
  const options = agentModelOptions && agentProviderOptions(agentModelOptions);
  const turnProviderSettings = agentMode ? provider && options ? { [provider]: options } : undefined : preferences.providerSettings;
  const hostedDefinition = hostedRoute && chatAgent && (configuredAgentModels(chatAgent).length ? chatAgent
    : selected.find(model => !isVoiceCatalogModel(model)) ? { ...chatAgent, model: { id: selected.find(model => !isVoiceCatalogModel(model))!.id } } : undefined);
  const hostedSelection: HostedAgentSelection | undefined = hostedRoute && agentChat.option && (agentChat.remoteId || hostedDefinition)
    ? { id: agentChat.remoteId ?? agentChat.option.name,
      modelIds: configuredAgentModels(hostedDefinition || chatAgent).map(({ id }) => id),
      definition: agentChat.remoteId ? undefined : hostedDefinition || undefined }
    : undefined;
  const modelId = agentMode ? hostedSelection?.id ?? browserModel?.id : selected[0]?.id;
  const voiceProtocol = !agentMode && route.mode === 'gateway' && selected[0] && isVoiceCatalogModel(selected[0])
    ? voiceProtocolForModel(selected[0].id) : undefined;
  const socketVoice = voiceProtocol === 'google' || voiceProtocol === 'xai';
  const canUseVoice = typeof globalThis.navigator?.mediaDevices?.getUserMedia === 'function' && (socketVoice
    ? typeof WebSocket !== 'undefined' && typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined'
    : typeof RTCPeerConnection !== 'undefined');
  const voiceAgents = (agents?.entries ?? []).filter(({ definition }) => !!browserAgentModel(definition, textCatalog));
  const conversationCost = useMemo(() => conversationGatewayCost(messages), [messages]);
  const contextUsage = preferences.showContextSize ? latestContextUsage(messages, agentMode ? browserModel ? [browserModel] : [] : selected) : undefined;
  const welcomeAgent = assignedAgent(agents, welcomeRoleId);
  const welcomeModels = configuredAgentModels(welcomeAgent).filter(({ type }) => type !== 'decision');
  const welcomeModel = welcomeModels.find(({ id }) => compatibleById.has(id));
  const welcomeInstructions = welcomeAgent?.instructions;
  const apiChatAgent = isApiChat(route);
  const welcomeRequest = useMemo(() => !agentMode && welcomeModel && welcomeInstructions && appAgentTransport
    ? { model: welcomeModel.id, instructions: welcomeInstructions, transport: appAgentTransport, context: appAgentContext,
      provider: apiChatAgent ? agentProviderRequest(welcomeModel) : undefined }
    : undefined, [agentMode, welcomeModel, welcomeInstructions, appAgentTransport, appAgentContext, apiChatAgent]);

  function prepareName() {
    const agent = assignedAgent(agents, conversationNameRoleId);
    const model = configuredAgentModels(agent).find(({ id, type }) => type !== 'decision' && compatibleById.has(id));
    if (agent && model && appAgentTransport) {
      nameRequest.current = { model: model.id, instructions: agent.instructions, transport: appAgentTransport, context: appAgentContext,
        provider: apiChatAgent ? agentProviderRequest(model) : undefined };
    }
  }
  useEffect(() => {
    // Persist the submitted user turn and the terminal (including manually stopped) transcript.
    // Do not write on every text delta, or save an empty new chat.
    if (status === 'streaming' || !messages.some(message => message.parts.length) || messages === saved.current) return;
    saved.current = messages;
    onPersist({ ...conversation, messages: messages.filter(message => message.parts.length),
      metadata: { ...conversation.metadata, model: pendingModel ?? modelId, updatedAt: new Date().toISOString() } }, nameRequest.current);
  }, [messages, status, conversation, pendingModel, modelId, onPersist]);
  const hasDecisions = agents?.config.roles?.some(({ id }) => id === selectModelRoleId);
  const decision = voiceProtocol ? undefined : chatModelDecision(router, selected);
  const routesLocked = busy || !!voicePhase || toolBusy || (status === 'ready' && toolParts.length > 0);
  const toolCapabilities = chatToolCapabilities(runRoute, modelId);
  const canSend = connection.ready && !!modelId && !routesLocked && !restoringSkills && !connectingMcp &&
    (!agentMode || (!!agentRoute && !agentChat.checking && !agentChat.loadingDefinition)) &&
    !missingMcp.some(({ server }) => server.required === true) && (!voiceProtocol || canUseVoice);

  function publishVoice(message: ChatMessage, model: string) {
    const withMetadata = { ...message, metadata: { timestamp: new Date().toISOString(), ...(message.role === 'assistant' && { model }) } };
    setMessages(current => {
      const previous = current.find(row => row.id === message.id);
      return previous ? current.map(row => row.id === message.id ? { ...withMetadata, metadata: previous.metadata } : row) : [...current, withMetadata];
    });
  }

  function finishLiveClient(target: Turn, message: ChatMessage) {
    const client = target.liveClient;
    if (!client || client.finished) return;
    client.finished = true;
    const text = message.parts.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n').trim();
    voiceRun.current?.session?.comment(client.id, text || 'The delegated request produced no text reply.');
    setTurn(undefined);
  }

  async function startVoice() {
    if (!modelId || !voiceProtocol || !canSend || voiceRun.current) return;
    setVoiceNotice(''); setToolNotice('');
    const preferencesVoice = preferences.realtimeSettings;
    const liveClient = voiceProtocol === 'live' && preferencesVoice?.live?.mode === 'client';
    const agent = voiceAgents.find(entry => entry.key === preferencesVoice?.live?.clientAgent)?.definition;
    const target = agent ? browserAgentModel(agent, textCatalog) : textCatalog.find(model => model.id === preferencesVoice?.live?.clientModel);
    if (liveClient && !target) { setVoiceNotice('Choose a Client model or agent in OpenAI settings.'); return; }
    const nativeTurn = createTurn(modelId);
    const functions = nativeTurn.toolChoice === 'none' ? [] : nativeTurn.requestTools.map(tool => ({
      type: 'function', name: tool.name, description: tool.description, parameters: tool.inputSchema,
    })).filter(tool => /^[\w-]{1,64}$/.test(tool.name));
    const history = voiceHistory(messages);
    const instructions = context ? requestContextText(context).join('\n\n') : undefined;
    if (!messages.some(message => message.parts.length)) prepareName();
    setPendingModel(modelId);
    const run: VoiceRun = { controller: new AbortController() };
    voiceRun.current = run;
    setVoicePhase('connecting');
    const current = () => voiceRun.current === run;
    let pendingVoiceTools: string | undefined;
    const cancelTools = (messageId: string) => {
      if (!current() || messageId !== pendingVoiceTools) return;
      operation.current?.abort(); operation.current = null;
      setToolBusy(false); setStaged(undefined); setTurn(undefined);
      setMessages(current => current.map(message => message.id === messageId ? { ...message,
        parts: message.parts.map(part => part.type === 'dynamic-tool' && part.state === 'input-available'
          ? { ...part, state: 'output-error', errorText: 'The voice session ended or interrupted this tool call.' } : part) } : message));
      pendingVoiceTools = undefined;
    };
    const closed = () => {
      if (!current()) return;
      if (pendingVoiceTools) cancelTools(pendingVoiceTools);
      voiceRun.current = undefined;
      operation.current?.abort(); operation.current = null;
      setVoicePhase(undefined); setTurn(undefined); setToolBusy(false); setStaged(undefined);
      void stop();
      setMessages(messages => messages.filter(message => message.parts.length));
    };
    try {
      const events: VoiceCallbacks = {
          publish: message => { if (current()) publishVoice(message, modelId); },
          tools: (message, calls) => {
            if (!current()) return;
            pendingVoiceTools = message.id;
            setTurn({ ...nativeTurn, route: { mode: 'gateway', endpoint: '/v1/responses' }, voiceMessage: message.id,
              resolved: new Set(), toolProgress: { seen: new Set(), completed: 0 } });
            publishVoice({ ...message, parts: [...message.parts, ...calls.map(({ id, name, input }): Invocation => ({
              type: 'dynamic-tool', toolName: name, toolCallId: id, state: 'input-available', input,
            }))] }, modelId);
          },
          cancelTools,
          delegate: id => {
            if (!current() || !target) return;
            const next = createTurn(target.id);
            next.route = { mode: 'gateway', endpoint: '/api/chat' };
            if (agent?.instructions) next.context = { ...context, chatInstructions: agent.instructions };
            const provider = chatProviderForModel(target.id);
            const model = configuredAgentModels(agent).find(item => item.id === target.id);
            const options = model && agentProviderOptions(model);
            next.providerSettings = provider && options ? { [provider]: options } : preferences.providerSettings;
            next.liveClient = { id, lastId: latestMessages.current.at(-1)?.id, finished: false };
            setTurn(next);
            void sendMessage(undefined, { body: requestBody(next) });
          },
          closed,
          failure: error => {
            if (!current()) return;
            setVoiceNotice(error.name === 'NotAllowedError' ? 'Microphone permission or playback was blocked.'
              : error.name === 'NotFoundError' ? 'No microphone was found.' : error instanceof GatewayError || !(error instanceof DOMException)
                ? error.message : 'The voice session ended.');
            closed();
          },
      };
      let voice: VoiceSession;
      if (voiceProtocol === 'google' || voiceProtocol === 'xai') {
        const setup = socketVoiceSetup(voiceProtocol, modelId, preferencesVoice, history, instructions, functions, nativeTurn.toolChoice !== 'none');
        voice = await startSocketVoiceConversation(gateway, modelId, setup, run.controller.signal, events);
      } else {
        const session = voiceProtocol === 'live' ? liveSession(preferencesVoice?.live, history, instructions, functions, nativeTurn.toolChoice)
          : realtimeSession(preferencesVoice?.realtime, instructions, functions, nativeTurn.toolChoice);
        const vad = preferencesVoice?.realtime?.vad;
        voice = await startVoiceConversation({ gateway, model: modelId, protocol: voiceProtocol, session, history, liveClient,
          ttl: preferencesVoice?.realtime?.tokenTtl, signal: run.controller.signal,
          manual: voiceProtocol === 'realtime' ? vad === null ? 'commit' : vad?.create_response === false ? 'respond' : undefined : undefined,
          transcription: preferencesVoice?.realtime?.transcription !== null, exposeInput: true,
          toolNames: new Set(functions.map(tool => tool.name)), events });
      }
      if (current()) { run.session = voice; setVoicePhase('active'); }
    } catch (error) {
      if (current()) { setVoiceNotice(errorMessage(error, 'Could not start the voice session.')); closed(); }
    }
  }

  useEffect(() => {
    if (!voicePhase || view === 'chat' && !locationIssue && connection.ready) return;
    voiceRun.current?.controller.abort();
  }, [voicePhase, view, locationIssue, connection.ready]);

  useEffect(() => {
    if (status !== 'error' || !turn?.liveClient || turn.liveClient.finished) return;
    turn.liveClient.finished = true;
    voiceRun.current?.session?.comment(turn.liveClient.id, 'The delegated request failed.');
    setTurn(undefined);
  }, [status, turn]);
  const routeMenu = pageRouteMenu(view, {
    chat: connection.account ? { selected: route, direct: directEndpoints, disabled: routesLocked, onSelect: onRoute } : undefined,
    agents: agentMode ? { selected: agentRoute, hosted: agentChat.hosted, gateway: hasGateway, direct: directEndpoints,
      disabled: routesLocked, onSelect: agentChat.setRoute } : undefined,
    decisions: connection.account && hasDecisions ? decisions : undefined,
    images: hasGateway ? images : undefined,
    transcriptions: hasGateway ? transcriptions : undefined,
    speech: hasGateway ? speech : undefined,
  });
  const modelStatus = !connection.ready ? connection.emptyMessage : agentMode
    ? agentChat.checking ? t('Connecting to the agent backend…')
      : !agentRoute ? t('No chat route is available for agents.')
      : !agentChat.options.length ? t('Create an agent in Agents to start chatting.')
      : !agentChat.option ? null
      : agentChat.loadingDefinition ? t('Loading agent…')
      : !hostedRoute && !chatAgent ? t('This hosted agent has no browser-readable definition.')
      : !hostedRoute && !runResult ? t('Loading models…')
      : !hostedRoute && runResult?.error ? runResult.error
      : !modelId ? t('No compatible model is available for this agent on the selected route.') : null
    : !result ? t('Loading models…') :
    result.error ?? (!compatible.length ? route.mode === 'direct' ? t('No models for this Direct route. Check your provider keys or choose another route.')
      : t('No compatible models are available. Check the gateway and its provider credentials.') : null);

  return <div ref={setMenuContainer} className="chat-shell" data-nav={nav ? 'expanded' : 'collapsed'} data-view={view}>
      <ChatNavigation appName={appName} expanded={nav} history={history} active={view === 'chat' && !locationIssue ? conversation.id : ''} busy={busy || toolBusy}
        searchHistory={searchHistory} account={connection.account} container={menuContainer} view={view} onView={onView}
        pinnedViews={preferences.pinnedViews} onToggleViewPin={(key) => onPreferences({ ...preferences,
          pinnedViews: preferences.pinnedViews.includes(key) ? preferences.pinnedViews.filter(view => view !== key) : [...preferences.pinnedViews, key] })}
        toggle={toggleNav} onNew={onNew} onOpen={onSwitch}
        onPin={onPin} onDelete={onDelete} onSettings={onSettings} routes={routeMenu} />
      <header className="chat-toolbar" hidden={view !== 'chat' && view !== 'agents' && view !== 'skills' && view !== 'mcp' && !mediaView && !connection.signIn}>
        {view === 'chat' && !locationIssue && <div className="chat-picker-bar">
          {agentModeEnabled && <ChatModeButtons agentMode={agentMode} disabled={routesLocked} onChange={setAgentMode} />}
          {agentMode ? <AgentChatPicker options={agentChat.options} selected={agentChat.option?.key} loading={agentChat.checking}
            disabled={routesLocked} onChange={agentChat.select} />
            : <ModelPicker models={compatible} selected={selected} multiple={!!router}
              loading={connection.ready && !result} disabled={routesLocked} onChange={ids => {
                setVoiceNotice('');
                const added = ids.find(id => !selected.some(model => model.id === id));
                if (added && compatible.some(model => model.id === added && isVoiceCatalogModel(model))) setSelectedIds([added]);
                else if (voiceProtocol && added) setSelectedIds([added]);
                else setSelectedIds(ids);
              }} />}
        </div>}
        {mediaView && <div className="chat-image-toolbar" ref={setMediaToolbar} />}
        {connection.signIn && <div className="chat-account">{connection.signIn}</div>}
        {(view === 'agents' || view === 'skills' || view === 'mcp') && <div ref={setCatalogToolbar} />}
      </header>
      {locationIssue && <main className="catalog-main"><div className="catalog-content">
        <p role="status">{t(locationIssue)}</p>
        {storageIssue && <p role="status">{t(storageIssue)}</p>}
        {!connection.ready && <p>{connection.emptyMessage}</p>}
      </div>
      </main>}
      <main className="chat-main" data-empty={!messages.length} hidden={view !== 'chat' || !!locationIssue}>
        {messages.length ? <Transcript messages={messages} showMessageTokens={preferences.showMessageTokens}
          showProviderLogo={preferences.showProviderLogo} showMetrics={preferences.showMetrics}
          gateway={gateway} speechModel={speechModel} speechRoute={speech.selected} scope={scope}
          pendingReply={(busy || toolBusy || pending || voicePhase && turn?.voiceMessage) && last?.role === 'assistant' ? last.id : undefined} /> : null}
        <div className="chat-column chat-dock">
           {!messages.length && !locationIssue && <WelcomeHeading request={welcomeRequest} discovering={!agentMode && connection.ready && !result && welcomeModels.length > 0} />}
           {storageIssue && !locationIssue && <div className="chat-notice" role="status">{t(storageIssue)}</div>}
           {modelStatus && !locationIssue && <div className="chat-notice" role="status">
            {modelStatus}{connection.ready && (agentMode ? !hostedRoute && runResult : result) &&
              <Button onClick={agentMode && fallbackSource ? fallbackModels.reload : reload}>{t('Refresh models')}</Button>}
          </div>}
          {agentMode && agentChat.hostedUnavailable && agentRoute && <p className="chat-notice" role="status">{t('Agent backend unavailable. Using a browser route.')}</p>}
          {error && !voiceProtocol && <div className="chat-notice chat-error" role="alert">
            {t(errorMessage(error, 'The reply was interrupted. You can retry or send another message.'))}
            <Button disabled={!canSend} onClick={() => { if (modelId && canSend) void regenerate({ body: beginTurn(modelId) }); }}>{t('Retry')}</Button>
          </div>}
          {toolNotice && <p className="chat-notice" role="status">{t(toolNotice)}</p>}
          {voiceProtocol && voiceNotice && <p className="chat-notice chat-error" role="alert">{t(voiceNotice)}</p>}
          {voiceProtocol && !canUseVoice && <p className="chat-notice" role="status">{t(socketVoice
            ? 'Voice requires microphone access, WebSocket, and Web Audio.' : 'Voice requires microphone access and WebRTC.')}</p>}
          {!connectingMcp && missingMcp.length > 0 && <p className="chat-notice" role="status">
            {t('Install, authorize, or reconnect the agent’s MCP servers in Model Context: {{servers}}', { servers: missingMcp.map(({ key }) => key).join(', ') })}
          </p>}
           <div className="chat-progress" role="status">{(progress || restoringSkills || connectingMcp) && <><span className="chat-spinner" aria-hidden="true" />
             {progress || (restoringSkills ? t('Loading provider skills…') : t('Connecting to MCP servers…'))}</>}</div>
          <ComposerUsage context={contextUsage} cost={conversationCost} />
          <ChatComposer busy={busy || (status === 'ready' && toolParts.length > 0)} canSend={canSend} onStop={stopTurn}
            voice={voiceProtocol ? { phase: voicePhase, start: () => { void startVoice(); }, stop: stopTurn,
              manualTurn: () => voiceRun.current?.session?.manualTurn() } : undefined}
            convert={preferences.convertAttachmentsToText} badges={badges} dictation={dictateChat ? dictation : undefined}
            mcp={view === 'chat' && !hostedRoute && mcpServers.available ? { count: new Set([...mcpSelection.entries, ...agentMcp.entries].map(entry => entry.record.id)).size,
              disabled: routesLocked, open: () => setModelContextOpen(true), servers: connectedMcp, connect: mcpServers.connection } : undefined}
            onChatSettings={() => chatSettings.current?.showModal()} onViewContext={() => setContextOpen(true)}
            reasoning={!voiceProtocol && !hostedRoute && isApiChat(runRoute) ? { value: preferences.reasoning,
              onChange: reasoning => onPreferences({ ...preferences, reasoning }) } : undefined}
            onSend={(parts) => {
              if (!modelId || !canSend || voiceProtocol) return;
              if (!messages.length && !agentMode) prepareName();
              void sendMessage({ role: 'user', parts, metadata: { timestamp: new Date().toISOString() } }, { body: beginTurn(modelId) });
            }} />
        </div>
      </main>
      <ChatSettingsDialog dialog={chatSettings} value={preferences} onChange={onPreferences} gateway={gatewayRoute}
        voice={voiceProtocol ? { protocol: voiceProtocol, models: textCatalog, agents: voiceAgents.map(({ key, definition }) => ({ id: key, name: definition.name })) } : undefined}
        browserToolsSupported={!hostedRoute} hasHistory={hasHistory} locked={routesLocked} localSkills={localSkills} remoteSkills={remoteSkills}
        providerModels={agentMode ? [] : selected.filter(model => !isVoiceCatalogModel(model) &&
          (isApiChat(route) || route.endpoint === '/v1/responses' && model.provider === 'openai'))} namespaceSupported={toolCapabilities.namespaces} toolOptionsSupported={toolCapabilities.options}
        toolRows={configuredTools.map(({ tool, source, options, namespace }) => ({ key: tool.definition.name, label: tool.definition.name, source,
          options, namespace: toolCapabilities.namespaces ? namespace?.name : undefined }))} />
      {contextOpen && <ViewContextDialog onClose={() => setContextOpen(false)} context={(busy || toolParts.length > 0) && turn ? turn.context : context}
        tools={(busy || toolParts.length > 0) && turn ? turn.tools : enabledTools} />}
      {review && <ToolApprovalDialog key={`${review.id}:${review.kind}`} review={review} onAnswer={answerTool} onStop={stopTurn} />}
      {view === 'chat' && mcpServers.available && modelContextOpen && <ModelContextDialog store={mcpServers} options={connection.mcp}
        selection={mcpSelection} locked={routesLocked} onEdit={setMcpEditor} close={() => setModelContextOpen(false)} />}
      {mcpServers.available && mcpEditor && <McpServerEditor target={mcpEditor} options={connection.mcp} store={mcpServers} close={() => setMcpEditor(undefined)} />}
       <footer className="chat-disclaimer" hidden={view !== 'chat' || !!locationIssue}>{t('{{appName}} can make mistakes. Check important information.', { appName })}</footer>
      {view === 'images' ? <Suspense fallback={<main className="catalog-main"><p role="status">{t('Loading images…')}</p></main>}>
        <ImagesView gateway={gateway} scope={scope} route={images.selected} toolbar={mediaToolbar} catalog={mediaModels?.catalog}
          loading={hasGateway && connection.ready && !mediaModels} router={mediaRouter} status={mediaStatus} dictation={dictation} />
      </Suspense> : view === 'videos' ? <Suspense fallback={<main className="catalog-main"><p role="status">{t('Loading videos…')}</p></main>}>
        <VideosView gateway={gateway} library={videos} toolbar={mediaToolbar} catalog={mediaModels?.catalog}
          loading={hasGateway && connection.ready && !mediaModels} ready={hasGateway && connection.ready} status={mediaStatus} dictation={dictation} />
      </Suspense> : view === 'speech' ? <Suspense fallback={<main className="catalog-main"><p role="status">{t('Loading speech…')}</p></main>}>
        <SpeechView key={scope} gateway={gateway} scope={scope} route={speech.selected} toolbar={mediaToolbar} catalog={mediaModels?.catalog}
          loading={hasGateway && connection.ready && !mediaModels} router={mediaRouter} status={mediaStatus} dictation={dictation} />
      </Suspense> : view === 'transcriptions' ? <Suspense fallback={<main className="catalog-main"><p role="status">{t('Loading transcriptions…')}</p></main>}>
        <TranscriptionsView gateway={gateway} scope={scope} route={transcriptions.selected} toolbar={mediaToolbar} catalog={mediaModels?.catalog}
          menuContainer={menuContainer} loading={hasGateway && connection.ready && !mediaModels} status={mediaStatus} splitting={preferences.transcriptionSplit} />
      </Suspense> : view !== 'chat' && <main className="catalog-main">
        {view === 'mcp' ? <McpServersView store={mcpServers} options={connection.mcp} locked={routesLocked} onEdit={setMcpEditor} toolbar={catalogToolbar} />
          : view === 'models' ? <ModelsView models={result?.error ? undefined : result?.catalog}
          status={!connection.ready ? connection.emptyMessage : !result ? t('Loading models…') : result.error}
           refresh={connection.ready && result ? reload : undefined} /> : view === 'agents'
          ? <AgentsView catalog={agentModels?.catalog ?? []} catalogStatus={agentModelStatus} {...{ mcpServers, localSkills, remoteSkills, gateway }}
            toolbar={catalogToolbar} menuContainer={menuContainer} /> : view === 'skills'
          ? <SkillsView store={localSkills} gateway={gateway} remote={remoteSkills} toolbar={catalogToolbar} menuContainer={menuContainer} />
          : <ProvidersView appName={appName} />}
      </main>}
  </div>;
}
