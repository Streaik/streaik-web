import { useChat } from '@ai-sdk/react';
import { GatewayError, gatewayChatEndpoints, isSpeechCatalogModel, isVoiceCatalogModel, nativeChatEndpoints, voiceProtocolForModel, pickChatCatalogModels } from '@streaik/gateway';
import type { AgentBackend, ChatRoute, DirectChat, GatewayChatEndpoint, HostedAgentSelection, HostedMcpTool } from '@streaik/gateway';
import type { CatalogModel, ChatMessage, ChatReasoning, ChatToolChoice, DecisionChoiceResult, Gateway } from '@streaik/gateway';
import { Button, ThemeRoot, useColorScheme } from '@streaik/themes';
import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { AssistantImages, AssistantVideo } from './AssistantAttachments';
import { ChatComposer, AttachmentChip } from './ChatComposer';
import type { ComposerBadge } from './ChatComposer';
import { ComposerUsage } from './ComposerUsage';
import { httpLink } from './chatAttachments';
import { MessageActions } from './MessageActions';
import { MessageClock, MessageTime } from './MessageTime';
import { outputAttachmentsByReply } from './outputAttachments';
import type { OutputAttachment } from './outputAttachments';
import { conversationCost, latestContextUsage, withReplyMetadata } from './messageMetadata';
import { AssistantSpeaker } from './AssistantSpeaker';
import { ChatIcon } from './ChatIcon';
import { ChatNavigation } from './ChatNavigation';
import type { ChatAccount, ChatView } from './ChatNavigation';
import { chatLocation, conversationPath, pagePaths } from './chatLocation';
import { ModelsView, ProvidersView } from './CatalogViews';
import { ModelPicker } from './ModelPicker';
import { AgentChatPicker, ChatModeButtons } from './AgentChatPicker';
import { browserAgentModel, browserGatewayAgentModels } from './agentChat';
import { useAgentChat } from './useAgentChat';
import { defaultAgentModelIds, resolveModelSelection } from './modelSelection';
import { selectDictationTarget } from './composerDictation';
import type { ComposerDictation } from './composerDictation';
import { chatVoiceSpeech, chatVoiceTranscription, transcriptionVoiceOptions } from './chatVoiceModels';
import { createChatVoiceOutput } from './chatVoiceSpeech';
import { runMicrophone } from './liveTranscription';
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
import { browserMcpAllows, chatHostedMcp, hostedMcpRoute, withMcpHeaders } from './chatModelContext';
import { chatProviderForModel, chatProviderRequest } from './providerChat/settings';
import type { ProviderChatSettings } from './providerChat/settings';
import { filterToolOutputContent } from './toolOutputContent';
import { buildRequestContext, requestContextText, withRequestContext } from './chatContext';
import type { RequestContext } from './chatContext';
import { activeChatTools, clientResourceSearchName, filterLocalToolReplay, localPlugins, localResourceSearchPluginId, localToolSearchPluginId, runLocalTool, toolPartName } from './localPlugins';
import type { ChatTool } from './localPlugins';
import { agentMcpAllows, agentMcpServers, agentSkillsTool } from './agentTools';
import { apiChatTools, chatRequestTools, chatToolCapabilities, configureChatTools } from './chatToolRequest';
import type { ChatRequestTool } from './chatToolRequest';
import { isClientToolSearch, searchClientTools, searchLocalToolCatalog } from './clientToolSearch';
import { searchClientResources } from './clientResourceSearch';
import { searchModels } from './searchSelection';
import type { SearchAgent } from './searchSelection';
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
import { browserChatSkills, hostedChatSkills } from './agentChatSkills';
import { agentModels as configuredAgentModels } from './agentDefinition';
import { agentChatProviderSettings, agentProviderOptions, agentProviderRequest } from './agentProviderSettings';
import { conversationOpeningText, deleteConversation, listConversations, newConversation, newestFirst, saveConversation } from './conversations';
import type { Conversation } from './conversations';
import type { createConversationSearch, SearchConversationText, SearchHistory } from './conversationSearch';
import { callMcpTool, McpDescriptorAuthUnsupported, mcpFailure, readMcpResource } from './mcp';
import type { McpOptions } from './mcp';
import { McpElicitationProvider, useMcpElicitation } from './McpElicitation';
import { echoInputModel, isEchoInputCall, providerElicitationForm } from './providerElicitation';
import { deferredReadResourceTool, mcpResourceCatalog, readResourceTool, resolveResourceRead } from './mcpChatContext';
import { McpServerEditor, McpServersView, ModelContextDialog } from './McpServersView';
import type { McpEditorTarget } from './McpServersView';
import { useMcpSelection, useMcpServers } from './useMcpServers';
import type { McpServers } from './useMcpServers';
export type { McpAppAuth, McpOptions, McpRemoteHeader } from './mcp';
export { isMcpRuntime } from './mcp';
import { agentModelDecisionInstructions, chatDecisionInput, chatModelDecision, modelDecisionRouter, selectModelRoleId, useDecisionRoute } from './modelDecisions';
import type { DecisionAgentContext, ModelDecision } from './modelDecisions';
import { decisionActivity, withDecisionActivity, withoutDecisionActivity } from './decisionActivity';
import { conversationNameRoleId, resourceSearchRoleId, runTextAppAgent, toolSearchRoleId, welcomeRoleId } from './textAppAgents';
import type { SearchRole, TextAppRequest } from './textAppAgents';
import { WelcomeHeading } from './WelcomeHeading';
import { useAppTranslation } from './i18n';
import './chat.css';
import { useImageRoute } from './imageRoute';
import type { ImageRouteSetting } from './imageRoute';
import { useTranscriptionRoute } from './transcriptionPreferences';
import type { TranscriptionRouteSetting } from './transcriptionPreferences';
import { resolveSpeechRoute, useSpeechRoute } from './speechPreferences';
import type { SpeechRoute, SpeechRouteSetting } from './speechPreferences';
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

type MessagePreferences = Pick<ChatPreferences, 'showMessageTokens' | 'showProviderLogo' | 'showMetrics' | 'showDecisions'>;

function AssistantHeader({ message, showProviderLogo }: { message: ChatMessage; showProviderLogo: boolean }) {
  const { t } = useAppTranslation();
  return <div className="chat-message-header">
    <AssistantSpeaker model={message.metadata?.model} showProviderLogo={showProviderLogo} />
    <span className="chat-badge chat-ai-badge"><ChatIcon name="agents" />{t('Generated by AI')}</span>
    <MessageTime timestamp={message.metadata?.timestamp} />
  </div>;
}

const Message = memo(function Message({ message, showMessageTokens, showProviderLogo, showMetrics, showDecisions, pendingReply, speechState,
  onReadAloud, attachments, menuContainer, foldTrailingActivity }: {
  message: ChatMessage; pendingReply: boolean; foldTrailingActivity: boolean; speechState?: MessageSpeechState; onReadAloud?: ToggleMessageSpeech;
  attachments?: readonly OutputAttachment[]; menuContainer: HTMLDivElement | null;
} & MessagePreferences) {
  const { t } = useAppTranslation();
  const user = message.role === 'user';
  const groups = groupMessageParts(message.parts, user, showDecisions, foldTrailingActivity);
  if (!groups.length && !attachments?.length) return null;
  return <><article className="chat-message" data-role={message.role} aria-label={t(user ? 'You' : 'Assistant')}>
    {user ? <MessageTime timestamp={message.metadata?.timestamp} /> : <AssistantHeader message={message} showProviderLogo={showProviderLogo} />}
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
      {attachments && <AssistantImages files={attachments} />}
    </div>
    <MessageActions message={message} showMessageTokens={showMessageTokens} showMetrics={showMetrics}
      pendingReply={pendingReply} speechState={speechState} onReadAloud={onReadAloud} attachments={attachments} menuContainer={menuContainer}
      userText={user ? groups.flatMap(group => group.type === 'text' ? [group.text] : []).join('\n\n') : undefined} />
  </article>
    {attachments?.filter(file => file.preview === 'video').map(file => <article key={file.id} className="chat-message" data-role="assistant"
      aria-label={t('Generated video')}>
      <AssistantHeader message={message} showProviderLogo={showProviderLogo} />
      <div className="chat-message-body"><AssistantVideo file={file} /></div>
    </article>)}
  </>;
});

function Transcript({ messages, showMessageTokens, showProviderLogo, showMetrics, showDecisions, gateway, speechModel, speechRoute, scope, pendingReply,
  menuContainer, latestReplySettled }: {
  messages: ChatMessage[]; gateway: Gateway; speechModel?: CatalogModel; speechRoute: SpeechRoute; scope?: string; pendingReply?: string;
  menuContainer: HTMLDivElement | null; latestReplySettled: boolean;
} & MessagePreferences) {
  const { t } = useAppTranslation();
  const speech = useMessageSpeech(gateway, speechModel, speechRoute, scope);
  const attachments = useMemo(() => outputAttachmentsByReply(messages), [messages]);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    const node = scroll.current;
    if (node && follow.current) node.scrollTop = node.scrollHeight;
  }, [messages, showMessageTokens, showProviderLogo, showMetrics, showDecisions, latestReplySettled]);
  return <section ref={scroll} onScroll={() => {
    const node = scroll.current;
    if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  }} className="chat-transcript" aria-label={t('Conversation')} tabIndex={0}>
    <MessageClock><div className="chat-column">{messages.map((message, index) => <Message key={message.id} message={message}
      attachments={attachments.get(message.id)} menuContainer={menuContainer}
      pendingReply={message.id === pendingReply} speechState={speech.state?.id === message.id ? speech.state : undefined}
      foldTrailingActivity={message.role === 'assistant' && (index === messages.length - 1 ? latestReplySettled : messages[index + 1].role !== 'assistant')}
      onReadAloud={message.role === 'assistant' ? speech.toggle : undefined}
      showMessageTokens={showMessageTokens} showProviderLogo={showProviderLogo} showMetrics={showMetrics} showDecisions={showDecisions} />)}</div></MessageClock>
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
type ChatVoiceRun = { controller: AbortController; output?: ReturnType<typeof createChatVoiceOutput>; queue: string[];
  hearing: boolean; reply?: { userId: string; settled: boolean; silent: boolean; interrupted?: boolean } };
type TurnDecision = { choice: ModelDecision; agent?: { context: DecisionAgentContext;
  settings: ReadonlyMap<string, ProviderChatSettings | undefined> } };
type Turn = { model: string; route: ChatRoute; tools: ChatTool[]; context?: RequestContext; hosted?: HostedTurn;
  requestTools: ChatRequestTool[];
  voiceMessage?: string; liveClient?: { id: string; lastId?: string; finished: boolean };
  catalog: readonly CatalogModel[]; skills: readonly LocalSkill[]; skillArchives?: TurnSkillArchives;
  loadHostedSkills?: ReturnType<typeof hostedChatSkills>;
  hostedMcp: HostedMcpTool[];
  nativeApprovalSubmitting?: boolean;
  providerSettings?: ProviderChatSettings; reasoning?: ChatReasoning; toolSearchAgent?: SearchAgent; resourceSearchAgent?: SearchAgent;
  resourceServers: ReadonlyMap<string, string>;
  toolPolicy: ChatToolPolicy; toolChoice?: ChatToolChoice; toolProgress: ToolProgress; resolved: Set<string> };
const isApiChat = (route: ChatRoute | undefined) => !route || (route.mode === 'gateway' && route.endpoint === '/api/chat');
const isApiChatTurn = (turn: Turn) => turn.hosted ? turn.hosted.endpoint === '/api/chat' : isApiChat(turn.route);
const isResponsesTurn = (turn: Turn) => turn.hosted ? turn.hosted.endpoint === '/v1/responses'
  : turn.route.endpoint === '/v1/responses';
const isConvertedMcpReview = (part: Invocation) => part.providerExecuted === true && toolPartName(part) === 'streaik_mcp_result_review';
const isProviderMcpApproval = (part: Invocation) => part.providerExecuted === true && toolPartName(part) === 'streaik_mcp_execution_approval';
const isHostedMcpApproval = (part: Invocation) => part.providerExecuted === true && toolPartName(part) === 'streaik_hosted_mcp_approval';
const isHostedMcpResult = (part: Invocation) => part.providerExecuted === true && toolPartName(part) === 'streaik_hosted_mcp_result';
const isNativeMcpApproval = (part: Invocation) => part.providerExecuted === true && !!part.approval
  && (isProviderMcpApproval(part) || toolPartName(part)?.startsWith('mcp.'));
const isOneShotMcpApproval = (part: Invocation) => !!part.approval && (isNativeMcpApproval(part) || isHostedMcpApproval(part));
const mcpOutcomeUnknown = 'The MCP tool may have run, but no result was received. Check the MCP server before trying again.';

function mcpReviewOutput(part: Invocation): { output: unknown } | undefined {
  const descriptor = part.approval?.descriptor;
  if (descriptor && typeof descriptor === 'object' && 'output' in descriptor) return { output: descriptor.output };
  if (part.toolMetadata && 'mcpReviewOutput' in part.toolMetadata) return { output: part.toolMetadata.mcpReviewOutput };
}

async function recordNativeMcpSubmission(conversationId: string, ids: string[]) {
  const key = `streaik-mcp-submitted:${conversationId}`;
  const record = () => {
    let stored: string[];
    try {
      stored = JSON.parse(localStorage.getItem(key) ?? '[]');
      if (ids.some(id => stored.includes(id))) throw new GatewayError('This MCP approval was already submitted.');
      localStorage.setItem(key, JSON.stringify([...stored, ...ids]));
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError('The MCP approval could not be saved. The tool was not run by this request.');
    }
  };
  if (navigator.locks) await navigator.locks.request(key, record);
  else record();
}

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
  const chatVoiceRun = useRef<ChatVoiceRun | undefined>(undefined);
  const [voicePhase, setVoicePhase] = useState<'connecting' | 'active' | 'closing'>();
  const [voiceNotice, setVoiceNotice] = useState('');
  const [voicePreview, setVoicePreview] = useState('');
  const [, updateVoiceQueue] = useState(0);
  useEffect(() => () => {
    const run = voiceRun.current;
    voiceRun.current = undefined;
    run?.controller.abort();
    const chat = chatVoiceRun.current;
    chatVoiceRun.current = undefined;
    chat?.controller.abort();
    chat?.output?.close();
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
  const transcriptionAgent = assignedAgent(agents, 'transcription');
  const speechAgent = assignedAgent(agents, 'speech');
  const transcriptionModelIds = dictateView ? defaultAgentModelIds(transcriptionAgent) : [];
  const speechModelIds = defaultAgentModelIds(speechAgent);
  const [speechSelection, setSpeechSelection] = useState<string[]>();
  useEffect(() => { if (view !== 'speech') setSpeechSelection(undefined); }, [view]);
  const fetchGatewayModels = route.mode === 'direct' && (view === 'agents' ||
    hasGateway && (mediaView || transcriptionModelIds.length > 0 || view === 'chat' && !locationIssue &&
      (speechModelIds.length > 0 || !!chatAgent?.transcription || !agentMode && !!transcriptionAgent)));
  const gatewayModels = useModels(gateway, connection.ready && fetchGatewayModels, connection.modelRevision ?? 0, scope);
  // Execution decisions are input for one request; completed receipts are the replayable history.
  const sentNativeApprovals = useRef(new Set<string>());
  const latestMcpServers = useRef(mcpServers);
  useLayoutEffect(() => { latestMcpServers.current = mcpServers; }, [mcpServers]);
  const transport = useMemo<ReturnType<Gateway['chatTransport']>>(() => {
    const apiChat = gateway.chatTransport();
    return {
      async sendMessages(request) {
        const last = request.messages.at(-1);
        const previous = request.trigger === 'submit-message' && last?.role === 'assistant' ? last : undefined;
        const usedIds = new Set(request.messages.map(message => message.id));
        request = { ...request, messages: withoutDecisionActivity(request.messages) };
        const { route, decision, context, resourceServerIds, providerSettings: initialSettings, clientToolSearch, hosted, loadHostedSkills, ...body } = (request.body ?? {}) as {
          model?: string; route?: ChatRoute; decision?: TurnDecision; context?: RequestContext; tools?: ChatRequestTool[];
          providerSettings?: ProviderChatSettings; hosted?: HostedTurn; reasoning?: ChatReasoning; toolChoice?: ChatToolChoice;
          clientToolSearch?: boolean; loadHostedSkills?: Turn['loadHostedSkills']; hostedMcp?: HostedMcpTool[];
          resourceServerIds?: string[];
        };
        const endpoint = hosted?.endpoint ?? route?.endpoint;
        const apiRoute = hosted ? endpoint === '/api/chat' : isApiChat(route);
        if (endpoint === '/v1/responses' || apiRoute) {
          const active: string[] = [];
          request = { ...request, messages: request.messages.map(message => ({ ...message, parts: message.parts.filter(part => {
            if (!('toolCallId' in part) || !isOneShotMcpApproval(part)) return true;
            if (isHostedMcpApproval(part) && (!apiRoute || (part.toolMetadata?.streaikAgent ?? undefined) !== hosted?.selection.id)) return false;
            if (message.id !== previous?.id || part.state !== 'approval-responded' || sentNativeApprovals.current.has(part.approval.id)) return false;
            sentNativeApprovals.current.add(part.approval.id);
            active.push(part.approval.id);
            return true;
          }) })) };
          if (active.length) await recordNativeMcpSubmission(request.chatId, active);
          else if (previous?.parts.some(part => 'toolCallId' in part && isOneShotMcpApproval(part) && part.state === 'approval-responded') &&
            !request.messages.at(-1)?.parts.some(part => 'toolCallId' in part && !part.providerExecuted && toolComplete(part))) {
            throw new GatewayError('This MCP approval was already submitted.');
          }
        } else request = { ...request, messages: request.messages.map(message => {
          if (!message.metadata?.responsesMcp) return message;
          const { responsesMcp: _native, ...metadata } = message.metadata;
          return { ...message, metadata };
        }) };
        if (hosted) {
          if (!connection.agentBackend) throw new GatewayError('The agent backend is not configured.');
          const api = hosted.endpoint === '/api/chat';
          const tools = api ? (body.tools ?? []).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) : [];
          const names = new Set(tools.map(tool => tool.name));
          // Replay only reviews from this hosted agent, not gateway tools or browser MCP credentials.
          const messages = request.messages.flatMap(message => {
            const parts = message.parts.flatMap((part): ChatMessage['parts'] => {
              if (part.type === 'text' || (message.role === 'user' && part.type === 'file')) return [part];
              if (!api && 'toolCallId' in part && isNativeMcpApproval(part)) return [part];
              if (!api || message.role !== 'assistant' || !('toolCallId' in part) || !toolComplete(part)
                || !('toolMetadata' in part) || typeof part.toolMetadata !== 'object' || part.toolMetadata === null
                || !('streaikAgent' in part.toolMetadata) || part.toolMetadata.streaikAgent !== hosted.selection.id) return [];
              if (isHostedMcpApproval(part)) return part.state === 'approval-responded' ? [part] : [];
              if (isHostedMcpResult(part)) return part.state === 'output-available' ? [part] : [];
              if (!part.approval) return [];
              const { toolMetadata: _private, ...replay } = part;
              if (isConvertedMcpReview(part)) {
                const { descriptor: _preview, ...approval } = part.approval;
                return [{ ...replay, approval, ...(!part.approval.approved && { output: undefined }) } as Invocation];
              }
              return !part.providerExecuted && names.has(toolPartName(part) ?? '') ? [replay] : [];
            });
            return parts.length ? [{ ...message, parts }] : [];
          });
          const stream = await connection.agentBackend.chatTransport(hosted.endpoint, hosted.selection)
            .sendMessages({ ...request, body: { tools }, messages });
          return withReplyMetadata(api ? stream.pipeThrough(new TransformStream({ transform(chunk, controller) {
            controller.enqueue(chunk.type === 'tool-input-available' ? { ...chunk,
              toolMetadata: { ...chunk.toolMetadata, streaikAgent: hosted.selection.id } } : chunk);
          } })) : stream, body.model, previous, usedIds);
        }
        let model = body.model;
        let providerSettings = initialSettings;
        let activity: ReturnType<typeof decisionActivity> | undefined;
        const reply = async (send: ReturnType<typeof apiChat.sendMessages>) => {
          try {
            const source = await send;
            // The SDK turns error parts into untyped errors. Surface the gateway's
            // validated text without displaying unrelated parser or transport errors.
            const stream = withReplyMetadata(route?.mode === 'gateway' ? source.pipeThrough(new TransformStream({
              transform(chunk, controller) {
                if (chunk.type === 'error') throw new GatewayError(chunk.errorText);
                controller.enqueue(chunk);
              },
            })) : source, model, previous, usedIds);
            return activity ? withDecisionActivity({ stream }, activity, model) : stream;
          } catch (error) {
            if (!activity || request.abortSignal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
            return withDecisionActivity({ error }, activity, model);
          }
        };
        const enabledSkillIds = new Set(context?.skills?.skills.map(({ skill_id }) => skill_id));
        const resourceServers = new Set(resourceServerIds);
        const hostedReviewScope = JSON.stringify([body.model, body.hostedMcp ?? []]);
        const legacyReviewScope = body.hostedMcp?.length ? hostedReviewScope : undefined;
        const history = request.messages.map(message => ({
          ...message, parts: message.parts.filter(part => {
            if (!('toolCallId' in part) || part.toolMetadata?.streaikGatewayHostedMcp === undefined) return true;
            return isApiChat(route) && part.toolMetadata.streaikGatewayHostedMcp === (isConvertedMcpReview(part) ? legacyReviewScope : hostedReviewScope);
          }),
        })).filter(message => message.parts.some(part => part.type !== 'step-start'));
        const replay = filterLocalToolReplay(history, body.tools ?? [], isApiChat(route), enabledSkillIds, resourceServers,
          route?.endpoint === '/v1/responses');
        request = { ...request, body, messages: filterToolOutputContent(replay, preferences.toolOutput) };
        if (route?.mode === 'gateway' && decision) {
          const { endpoint, ...choice } = decision.choice;
          const input = chatDecisionInput(request.messages, decision.agent?.context);
          setDeciding(true);
          try {
            let result: DecisionChoiceResult | undefined;
            try {
              result = await gateway.decideChoiceResult(endpoint, { ...choice, input }, request.abortSignal);
            } catch (error) {
              request.abortSignal?.throwIfAborted();
              if (error instanceof Error && error.name === 'AbortError') throw error;
              // Like the hosted runtime, browser agents can still answer with
              // their first candidate when routing is unavailable or invalid.
              if (!decision.agent) return withDecisionActivity({ error }, decisionActivity(decision.choice, undefined));
            }
            request.abortSignal?.throwIfAborted();
            const { choice: winner, ...scores } = result ?? {};
            if (winner) {
              model = winner;
              if (decision.agent) providerSettings = decision.agent.settings.get(winner);
              setTurn((current) => current && { ...current, model: winner, providerSettings });
              request = { ...request, body: { ...body, model: winner } };
            }
            activity = decisionActivity(decision.choice, decision.agent?.context,
              winner ? { selectedModel: winner, ...scores } : { selectedModel: model, fallback: true });
            setPendingModel(model);
          } finally { setDeciding(false); }
        }
        // A provider form is a continuation, not a historical tool result that can go to another model.
        request = { ...request, messages: request.messages.flatMap((message, index, history) => {
          if (isApiChat(route) && model === echoInputModel && index === history.length - 1 && message.role === 'assistant') return [message];
          const parts = message.parts.filter(part => !('toolCallId' in part && isEchoInputCall(part)));
          return parts.length === message.parts.length ? [message] : parts.some(part => part.type !== 'step-start') ? [{ ...message, parts }] : [];
        }) };
        const provider = isApiChat(route) || route?.endpoint === '/v1/responses' || model?.startsWith('anthropic/')
          ? chatProviderRequest(providerSettings, model, clientToolSearch === true) : undefined;
        const headers = new Headers(request.headers);
        for (const [key, value] of Object.entries(provider?.headers ?? {})) headers.set(key, value);
        const hostedSkills = route?.mode === 'gateway' && loadHostedSkills ? await loadHostedSkills() : undefined;
        request.abortSignal?.throwIfAborted();
        const hostedOptions = hostedSkills?.length ? { hostedSkills } : {};
        const store = latestMcpServers.current;
        const mcpOptions = route?.mode === 'gateway' && body.hostedMcp?.length ? { hostedMcp: await withMcpHeaders(body.hostedMcp, async (endpoint, label) => {
          const record = store.records.find(server => server.endpoint === endpoint);
          if (!record) throw new GatewayError(`MCP server “${label}” is no longer installed. Select it again and start a new turn.`);
          try {
            const resolved = await store.descriptorHeaders(record, request.abortSignal);
            if (resolved !== undefined) return new Headers(resolved);
          } catch (error) {
            request.abortSignal?.throwIfAborted();
            if (error instanceof McpDescriptorAuthUnsupported)
              throw new GatewayError(`MCP server “${record.title}” requires a browser authentication challenge. Use Client execution or configure server credentials.`);
          }
          throw new GatewayError(`Credentials for MCP server “${record.title}” are unavailable. Reconnect the server and start a new turn.`);
        }) } : {};
        request.abortSignal?.throwIfAborted();
        if (isApiChat(route)) {
          const { tools, namespaces } = apiChatTools(body.tools ?? [], route, model);
          const providerMetadata = provider?.providerMetadata;
          const openai = providerMetadata?.openai;
          const existing = Array.isArray(openai?.tools) ? openai.tools : [];
          const metadata = namespaces.length ? { ...providerMetadata, openai: { ...openai, tools: [...existing, ...namespaces] } } : providerMetadata;
          const hasTools = tools.length || body.hostedMcp?.length || hostedSkills?.length || Object.values(metadata ?? {}).some(options => Array.isArray(options?.tools) && options.tools.length > 0);
          const toolChoice = body.toolChoice === 'required' && !hasTools ? undefined : body.toolChoice;
          const sent = apiChat.sendMessages({ ...request, headers, body: { ...request.body,
            tools, toolChoice, ...hostedOptions, ...mcpOptions, ...(metadata && { providerMetadata: metadata }) },
            messages: withRequestContext(request.messages, context) });
          // Do not carry hosted receipts onto a different model or hosted-tool configuration.
          return reply(sent.then(stream => stream.pipeThrough(new TransformStream({ transform(chunk, controller) {
            const scoped = chunk.type === 'tool-input-available' && (chunk.toolName === 'streaik_hosted_mcp_approval' ||
              chunk.toolName === 'streaik_hosted_mcp_result' || (body.hostedMcp?.length && chunk.toolName === 'streaik_mcp_result_review'));
            controller.enqueue(scoped
              ? { ...chunk, toolMetadata: { ...chunk.toolMetadata, streaikGatewayHostedMcp: JSON.stringify([model, body.hostedMcp ?? []]) } } : chunk);
          } }))));
        }
        const nativeOptions = provider?.providerMetadata.anthropic || (route?.endpoint === '/v1/responses' && provider?.providerMetadata.openai)
          ? { providerMetadata: provider.providerMetadata } : {};
        if (route?.mode === 'gateway' && gatewayChatEndpoints.includes(route.endpoint)) {
          return reply(gateway.chatTransport(route.endpoint).sendMessages({ ...request, headers,
            body: { ...request.body, ...nativeOptions, ...hostedOptions, ...mcpOptions, ...(context && { instructions: requestContextText(context) }) } }));
        }
        if (route?.mode === 'direct' && direct && nativeChatEndpoints.includes(route.endpoint)) {
          // Direct native transports use this field for client-provided system context.
          return reply(direct.chatTransport(route.endpoint).sendMessages({ ...request, headers,
            body: { ...request.body, ...nativeOptions, ...(context && { mcpInstructions: requestContextText(context) }) } }));
        }
        throw new GatewayError('The selected chat route is unavailable.');
      },
      async reconnectToStream() { return null; },
    };
  }, [gateway, direct, connection.agentBackend, preferences.toolOutput]);
  const { messages, sendMessage, regenerate, setMessages, addToolApprovalResponse, addToolOutput, stop, status, error } = useChat({
    id: conversation.id, messages: conversation.messages, transport, throttle: preferences.delay || undefined,
  });
  const latestMessages = useRef(messages);
  useLayoutEffect(() => { latestMessages.current = messages; }, [messages]);
  useEffect(() => () => { void stop(); }, [stop]);
  const [modelContextOpen, setModelContextOpen] = useState(false);
  const [mcpEditor, setMcpEditor] = useState<McpEditorTarget>();
  const [toolNotice, setToolNotice] = useState('');
  const [toolBusy, setToolBusy] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const elicit = useMcpElicitation();
  const elicitProvider = useMcpElicitation(true);
  const hasHistory = !!readHistory;
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const gatewayRoute = !hostedRoute && runRoute.mode === 'gateway';
  const { result, reload } = models;
  const catalog = result?.catalog ?? [];
  const textCatalog = pickChatCatalogModels(catalog);
  const compatible = route.mode === 'direct' ? catalog.filter(item => direct?.supports(item.provider, route.endpoint))
    : [...textCatalog, ...catalog.filter(isVoiceCatalogModel)];
  const router = !agentMode && gatewayRoute ? modelDecisionRouter(agents, catalog, decisions.selected) : undefined;
  const { selected } = resolveModelSelection<CatalogModel>(compatible, selectedIds, !!router, defaultAgentModelIds(defaultChatAgent));
  const voiceProtocol = !agentMode && route.mode === 'gateway' && selected[0] && isVoiceCatalogModel(selected[0])
    ? voiceProtocolForModel(selected[0].id) : undefined;
  const hostedSkillsSupported = gatewayRoute && !agentMode && !voiceProtocol;
  const useHostedSkills = view === 'chat' && hostedSkillsSupported && preferences.skillExecution === 'hosted';
  const mcpRoute = hostedSkillsSupported ? hostedMcpRoute(runRoute) : undefined;
  const providerMcp = view === 'chat' && !!mcpRoute && preferences.modelContext?.execution === 'provider';
  const mcpSelection = useMcpSelection(mcpServers, undefined, providerMcp);
  const declaredMcp = view === 'chat' && !hostedRoute ? agentMcpServers(chatAgent?.tools).filter(({ server }) => server.execution !== 'server') : [];
  const agentMcp = useMcpSelection(mcpServers, mcpServers.records.filter(record => declaredMcp.some(entry => entry.endpoint === record.endpoint)), providerMcp);
  const connectedMcp = hostedRoute || providerMcp ? [] : [...agentMcp.connected, ...mcpSelection.connected.filter(({ record }) =>
    !agentMcp.connected.some(entry => entry.record === record))];
  const contextMcp = providerMcp ? [...agentMcp.entries, ...mcpSelection.entries.filter(({ record }) =>
    !agentMcp.entries.some(entry => entry.record === record))] : connectedMcp;
  const missingMcp = declaredMcp.filter(({ endpoint }) => !contextMcp.some(({ record }) => record.endpoint === endpoint));
  const connectingMcp = !hostedRoute && !providerMcp && (mcpSelection.loading || agentMcp.loading);
  const localToolSearch = preferences.plugins.includes(localToolSearchPluginId);
  const hostedMcp = view === 'chat' && mcpRoute ? chatHostedMcp(preferences.modelContext, contextMcp, localToolSearch) : [];
  const useHostedMcp = hostedMcp.length > 0;
  const hostedToolSearch = hostedMcp.some(({ type }) => type === 'tool_search');
  const appAgentContext = useMemo(() => buildRequestContext(appName, language, darkMode), [appName, language, darkMode]);
  const appAgentTransport = useMemo(() => route.mode === 'direct' ? direct?.chatTransport(route.endpoint)
    : gateway.chatTransport(route.endpoint), [gateway, direct, route]);
  const { online: skillsOnline, skills: providerSkills, busy: skillsBusy, needsLoad: needsSkills, cursor: skillCursor,
    error: skillCatalogError, load: loadSkills } = remoteSkills;
  const skillMode = hostedRoute ? 'agents' : runRoute.mode;
  const skillsTool = view === 'chat' ? agentSkillsTool(chatAgent?.tools) : undefined;
  const attachedSkills = skillsTool?.execution === 'server' ? undefined : skillsTool?.skills;
  const chatSkills = useMemo(() => browserChatSkills({ mode: skillMode, skills: attachedSkills, local: localSkills.skills,
    catalog: providerSkills, selectedIds: preferences.remoteSkillIds, gateway: skillsOnline ? gateway : undefined, hostedPreferences: useHostedSkills }),
    [skillMode, attachedSkills, localSkills.skills, providerSkills, preferences.remoteSkillIds, skillsOnline, gateway, useHostedSkills]);
  // Restore saved selections even if the user never opens the Skills tab in this session.
  const restoringSkills = view === 'chat' && chatSkills.missingCatalog
    && skillCatalogError === undefined && (skillsBusy || needsSkills || !!skillCursor);
  useEffect(() => {
    if (restoringSkills && !skillsBusy) loadSkills(skillCursor);
  }, [restoringSkills, skillsBusy, loadSkills, skillCursor]);
  const hasSkills = chatSkills.archives.length > 0 || chatSkills.local.some(({ enabled }) => enabled);
  const resourceServers = useHostedMcp ? [] : connectedMcp.filter(({ discovery }) => discovery.hasResources);
  const deferredResources = resourceServers.length > 0 && preferences.plugins.includes(localResourceSearchPluginId);
  const mcpCatalog = deferredResources ? undefined : mcpResourceCatalog(resourceServers);
  const resourceSearchInstructions = deferredResources ?
    `Use ${clientResourceSearchName} to find resources and templates, and read_resource to fetch selected content. Connected MCP servers (metadata only): ${JSON.stringify(resourceServers.map(({ record }) => ({ serverId: record.id, title: record.title })))}` : undefined;
  const mcpTools = (useHostedMcp ? [] : connectedMcp).flatMap(({ record, discovery }) => {
    const declaration = declaredMcp.find(entry => entry.endpoint === record.endpoint);
    return discovery.tools.filter(tool => (!declaration || agentMcpAllows(declaration.server, tool.remoteName)) && browserMcpAllows(tool, preferences.modelContext));
  }).filter((tool, index, all) => all.findIndex(other => other.name === tool.name) === index);
  const enabledTools = hostedRoute ? hostedRoute.endpoint === '/api/chat'
    ? activeChatTools({ mode: 'gateway', endpoint: '/api/chat' }, preferences.plugins, hasHistory, []).filter(tool => tool.source === 'local') : []
    : activeChatTools(runRoute, preferences.plugins, hasHistory, mcpTools, hasSkills,
      deferredResources ? deferredReadResourceTool : mcpCatalog ? readResourceTool : undefined);
  const configuredTools = configureChatTools(enabledTools, preferences.toolRequestConfig, preferences.useToolNamespaces, chatAgent, hostedToolSearch);
  const baseContext = useMemo(() => gatewayRoute || hasSkills ? buildRequestContext(appName, language, darkMode, chatSkills.local, chatSkills.archives) : undefined,
    [gatewayRoute, hasSkills, appName, language, darkMode, chatSkills]);
  const chatInstructions = hostedRoute ? undefined : chatAgent?.instructions;
  const context = mcpCatalog || resourceSearchInstructions || chatInstructions ? { ...baseContext, ...(mcpCatalog && { mcp: mcpCatalog }),
    ...(resourceSearchInstructions && { resourceSearchInstructions }),
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
    if (!('toolCallId' in part) || !turn || turn.toolProgress.seen.has(part.toolCallId)) return [];
    if (isResponsesTurn(turn) && isNativeMcpApproval(part)) return [{ part, tool: undefined }];
    if (turn.hosted && !isApiChatTurn(turn)) return [];
    if (isApiChatTurn(turn) && (isConvertedMcpReview(part) || isProviderMcpApproval(part) || isHostedMcpApproval(part))) return [{ part, tool: undefined }];
    if (part.providerExecuted || (!turn.voiceMessage && turn.toolChoice === 'none')) return [];
    const name = toolPartName(part);
    if (isApiChat(turn.route) && turn.model === echoInputModel && isEchoInputCall(part)) return [{ part, tool: undefined }];
    const tool = turn.tools.find(tool => tool.definition.name === name);
    return tool || isSearch(part) || (isApiChatTurn(turn) && part.state === 'approval-requested') ? [{ part, tool }] : [];
  });
  const waitingForBrowserOutput = (part: Invocation) => !part.providerExecuted && part.state === 'approval-responded' && part.approval.approved;
  const pending = toolParts.find(({ part }) => (!toolComplete(part) || waitingForBrowserOutput(part)) && !turn?.resolved.has(part.toolCallId));
  useEffect(() => () => { operation.current?.abort(); }, []);

  function requestBody(turn: Turn) {
    return { model: turn.model, route: turn.route, context: turn.context, providerSettings: turn.providerSettings, hosted: turn.hosted,
      resourceServerIds: [...turn.resourceServers.keys()],
      loadHostedSkills: turn.loadHostedSkills, ...(turn.hostedMcp.length > 0 && { hostedMcp: turn.hostedMcp }),
      tools: turn.requestTools, toolChoice: turn.toolChoice, clientToolSearch: !!turn.toolSearchAgent, ...(turn.reasoning && { reasoning: turn.reasoning }) };
  }

  // Browser approval is not a result. Continue only after the approved browser calls have finished.
  useEffect(() => {
    if (status === 'error' && turn?.nativeApprovalSubmitting) {
      setToolNotice(mcpOutcomeUnknown);
      setTurn(undefined);
      return;
    }
    if (status !== 'ready' || toolBusy || operation.current || !turn) return;
    if (!toolParts.length) {
      if (turn.liveClient && last?.role === 'assistant' && last.id !== turn.liveClient.lastId) finishLiveClient(turn, last);
      return;
    }
    if (pending && isApiChatTurn(turn)) {
      const { part, tool } = pending;
      if (isConvertedMcpReview(part) || isProviderMcpApproval(part) || isHostedMcpApproval(part)) return;
      if (turn.model === echoInputModel && isEchoInputCall(part) && part.state === 'approval-requested') {
        void answerProviderForm(part);
        return;
      }
      if (waitingForBrowserOutput(part)) {
        if (isSearch(part)) void completeSearch(turn, part);
        else if (tool) void completeTool(part, tool);
      } else if (part.state !== 'approval-requested' || (!tool && !isSearch(part))) {
        setToolNotice('The gateway did not return an approval for this client tool.');
        setTurn(undefined);
      }
      return;
    }
    if (pending?.part.state === 'input-available' && isSearch(pending.part)) {
      void completeSearch(turn, pending.part);
      return;
    }
    if (pending?.part.state === 'input-available' && pending.tool) {
      void completeTool(pending.part, pending.tool);
      return;
    }
    if (toolParts.every(({ part }) => toolComplete(part) && !waitingForBrowserOutput(part))) {
      turn.toolChoice = continueToolPolicy(turn.toolPolicy, parts, turn.toolProgress);
      if (turn.voiceMessage) {
        voiceRun.current?.session?.continueTools(turn.toolChoice, turn.toolChoice === 'none' && (voiceProtocol === 'live' || voiceProtocol === 'xai'));
        setTurn(undefined);
      } else {
        turn.nativeApprovalSubmitting = toolParts.some(({ part }) => (isNativeMcpApproval(part) || isHostedMcpApproval(part)) && part.approval?.approved === true);
        void sendMessage(undefined, { body: requestBody(turn) });
      }
    }
  });

  async function completeSearch(target: Turn, part: Invocation) {
    if (!target.toolSearchAgent || target.resolved.has(part.toolCallId) || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setToolBusy(true);
    try {
      const output = await searchClientTools(target.toolSearchAgent, part.input, target.requestTools, target.route, target.model, controller.signal);
      controller.signal.throwIfAborted();
      target.resolved.add(part.toolCallId);
      await addToolOutput({ tool: 'tool_search', toolCallId: part.toolCallId, output });
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

  async function completeTool(part: Invocation, tool: ChatTool) {
    if (!turn || turn.resolved.has(part.toolCallId) || operation.current || status !== 'ready') return;
    const controller = new AbortController();
    // The render snapshot can lag behind addToolOutput when message updates are throttled.
    turn.resolved.add(part.toolCallId);
    operation.current = controller; setToolBusy(true);
    try {
      let output: unknown;
      if (tool.source === 'local') {
        output = await runLocalTool(tool, part.input, { catalog: turn.catalog, history: tool.plugin.requiresHistory ? readHistory?.() ?? [] : [],
            searchConversationText: tool.plugin.requiresHistory ? searchConversationText : undefined,
            searchTools: goal => searchLocalToolCatalog(turn.toolSearchAgent, goal, turn.requestTools,
              turn.model.startsWith('anthropic/') && (isApiChat(turn.route) || turn.route.endpoint === '/v1/messages'), controller.signal),
            searchResources: (serverId, query) => {
              const server = connectedMcp.find(({ record, discovery }) => record.id === serverId && discovery.hasResources &&
                turn.resourceServers.get(record.id) === record.endpoint && mcpServers.connection(record));
              if (!server) throw new Error('Choose a connected MCP resource server.');
              return searchClientResources(turn.resourceSearchAgent, server, query, controller.signal);
            } });
      } else if (tool.source === 'skill') {
        output = await resolveSkillTool(tool.definition.name, part.input, turn.skills, turn.skillArchives, controller.signal);
      } else if (tool.source === 'mcp-resource') {
        const target = resolveResourceRead(connectedMcp, part.input);
        const enabled = target && turn.resourceServers.get(target.record.id) === target.record.endpoint;
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
      await applyToolOutput(turn, part.toolCallId, tool, output);
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
    if (!turn || !pending || !last || toolBusy || operation.current || status !== 'ready') return;
    const { part } = pending;
    if (!turn.hosted && turn.route.mode === 'direct' && !isNativeMcpApproval(part)) return;
    if (part.state !== 'approval-requested' || turn.resolved.has(part.toolCallId)) return;
    if (approved && isConvertedMcpReview(part)) {
      const reviewed = mcpReviewOutput(part);
      if (!reviewed) return;
      turn.resolved.add(part.toolCallId);
      const answered: Invocation = { ...part, state: 'output-available', output: reviewed.output, approval: { ...part.approval, approved: true } };
      setMessages(current => current.map(message => message.id === last.id ? { ...message,
        parts: message.parts.map(item => 'toolCallId' in item && item.toolCallId === part.toolCallId ? answered : item) } : message));
    } else {
      const controller = new AbortController();
      operation.current = controller;
      setToolBusy(true);
      void Promise.resolve(addToolApprovalResponse({ id: part.approval.id, approved })).catch(() => {
        if (!controller.signal.aborted) { setToolNotice('Could not record the tool approval.'); setTurn(undefined); }
      }).finally(() => {
        if (operation.current === controller) { operation.current = null; setToolBusy(false); }
      });
    }
  }

  function createTurn(model: string): Turn {
    const seen = new Set(latestMessages.current.flatMap(message => message.parts.flatMap(part => 'toolCallId' in part ? [part.toolCallId] : [])));
    const toolPolicy = toolPolicyForTurn(preferences.toolPolicy, new Set(enabledTools.map(tool => tool.definition.name)));
    function searchAgentFor(role: SearchRole): SearchAgent | undefined {
      const agent = assignedAgent(agents, role);
      if (!agent || hostedRoute) return;
      const { decision, language } = searchModels(configuredAgentModels(agent), catalog, id => compatibleById.has(id));
      if (gateway.hasEndpoint && decision && decisions.selected !== 'off')
        return { decision: { model: decision.id, instructions: agent.instructions, endpoint: decisions.selected, gateway } };
      if (language && appAgentTransport)
        return { model: language.id, instructions: agent.instructions, transport: appAgentTransport, context: appAgentContext,
          provider: chatProviderRequest(undefined, language.id) };
    }
    const toolSearchAgent = searchAgentFor(toolSearchRoleId);
    const hostedSearchModel = (role: SearchRole) => {
      const { decision, language } = searchModels(configuredAgentModels(assignedAgent(agents, role)), catalog, id => compatibleById.has(id));
      return (decision ?? language)?.id;
    };
    return { model, route: runRoute, tools: enabledTools, context, catalog: runCatalog, skills: chatSkills.local,
      loadHostedSkills: useHostedSkills ? hostedChatSkills(localSkills.skills, chatSkills.preferenceSkills) : undefined,
      hostedMcp: hostedMcp.map(tool => tool.type === 'mcp' || tool.model ? tool :
        { ...tool, model: hostedSearchModel(tool.type === 'tool_search' ? toolSearchRoleId : resourceSearchRoleId) }),
      toolPolicy, toolChoice: hostedRoute ? undefined : toolPolicy.toolChoice, toolProgress: { seen, completed: 0 }, resolved: new Set(),
      requestTools: chatRequestTools(configuredTools), toolSearchAgent,
      resourceSearchAgent: deferredResources ? searchAgentFor(resourceSearchRoleId) : undefined,
      resourceServers: new Map(resourceServers.map(({ record }) => [record.id, record.endpoint])),
      hosted: hostedRoute && hostedSelection ? { endpoint: hostedRoute.endpoint, selection: hostedSelection } : undefined,
      providerSettings: !hostedRoute ? turnProviderSettings : undefined,
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
    if ((status === 'submitted' || status === 'streaming') && turn?.nativeApprovalSubmitting) setToolNotice(mcpOutcomeUnknown);
    operation.current?.abort();
    operation.current = null;
    setToolBusy(false);
    setTurn(undefined);
    void stop();
    closeChatVoice();
    const run = voiceRun.current;
    if (!run) return;
    if (run.session) { setVoicePhase('closing'); run.session.stop(); }
    else run.controller.abort();
  }

  function pendingReview(): ToolReview | undefined {
    if (!turn || !pending || status !== 'ready') return;
    const { tool, part } = pending;
    if (part.state !== 'approval-requested') return;
    const name = tool?.source === 'mcp' ? tool.tool.title || tool.tool.remoteName : invocationName(part);
    const details = { id: part.toolCallId, name, input: part.input, disabled: toolBusy || !connection.ready };
    if (isNativeMcpApproval(part) || isHostedMcpApproval(part)) return { ...details, kind: 'execution' };
    if (!turn.hosted && turn.route.mode === 'direct') return;
    if (isApiChatTurn(turn) && isConvertedMcpReview(part)) {
      const reviewed = mcpReviewOutput(part);
      if (reviewed) return { ...details, kind: 'result', ...reviewed };
    }
    if (isApiChatTurn(turn) && (tool || isSearch(part))) return { ...details, kind: 'execution' };
  }
  const review = pendingReview();
  const busy = status === 'submitted' || status === 'streaming';
  // Ready can also mean waiting for approval or about to submit a tool continuation.
  const latestReplySettled = status === 'ready' && !toolBusy && !toolParts.length && !voiceRun.current;
  const progress = busy ? deciding ? t('Choosing a model…') : t('Assistant is responding…')
    : toolBusy && turn ? t('Running tool…') : undefined;
  const agentModels = route.mode === 'direct' ? gatewayModels.result : result;
  const mediaModels = hasGateway ? agentModels : undefined;
  const microphone = typeof globalThis.navigator?.mediaDevices?.getUserMedia === 'function';
  const capture = { socket: typeof WebSocket !== 'undefined' && typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined',
    peer: typeof RTCPeerConnection !== 'undefined' };
  const dictationTarget = dictateView && transcriptionModelIds.length > 0 && mediaModels && !mediaModels.error && microphone &&
    selectDictationTarget(mediaModels.catalog, transcriptionModelIds, { ...capture, recorder: !!dictationFormat() });
  const voiceTranscriber = !voiceProtocol && view === 'chat' && !locationIssue && microphone && mediaModels && !mediaModels.error
    ? chatVoiceTranscription(mediaModels.catalog, capture, chatAgent, agentMode ? undefined : transcriptionAgent) : undefined;
  const dictation: ComposerDictation = dictateView ? dictationTarget ? { ...dictationTarget, gateway } : null : undefined;
  const mediaRouter = (view === 'images' || view === 'speech') && mediaModels ? modelDecisionRouter(agents, mediaModels.catalog, decisions.selected) : undefined;
  const mediaStatus = !hasGateway ? t('No gateway is configured.') : !connection.ready ? connection.emptyMessage
    : !mediaModels ? t('Loading models…') : mediaModels.error;
  const speechModels = mediaModels?.catalog.filter(isSpeechCatalogModel) ?? [];
  const selectedSpeech = view === 'speech' ? resolveModelSelection(speechModels, speechSelection, !!mediaRouter, speechModelIds).selected : [];
  const inferredSpeechRoute = resolveSpeechRoute(speech.selected, selectedSpeech[0]);
  // A mixed Decisions selection has no effective default until a model wins.
  const menuSpeechRoute = selectedSpeech.every(model => resolveSpeechRoute(speech.selected, model) === inferredSpeechRoute) ? inferredSpeechRoute : undefined;
  const speechModel = view === 'chat' && !locationIssue && speechModelIds.length && mediaModels && !mediaModels.error
    ? resolveModelSelection(speechModels, undefined, false, speechModelIds).selected[0]
    : undefined;
  const agentModelStatus = !connection.ready ? t('Connect to the gateway to browse models. You can still edit this agent.')
    : !agentModels ? t('Loading gateway models…') : agentModels.error;
  const compatibleById = new Map((route.mode === 'direct' ? compatible : textCatalog).map(model => [model.id, model]));
  const runResult = fallbackSource ? fallbackModels.result : result;
  const runCatalog = runResult?.catalog ?? [];
  const runCompatible = runRoute.mode === 'direct' ? runCatalog.filter(item => direct?.supports(item.provider, runRoute.endpoint))
    : pickChatCatalogModels(runCatalog);
  const preferred = selected.find(model => !isVoiceCatalogModel(model));
  const gatewayAgent = agentMode && agentRoute?.mode === 'gateway'
    ? browserGatewayAgentModels(chatAgent, runCatalog, runCompatible, preferred) : undefined;
  const browserModel = gatewayAgent ? gatewayAgent.answers[0]?.model
    : agentMode && !hostedRoute ? browserAgentModel(chatAgent, runCompatible, preferred) : undefined;
  const agentModelOptions = gatewayAgent ? gatewayAgent.answers[0]?.configuration
    : browserModel && configuredAgentModels(chatAgent).find(({ id }) => id === browserModel.id);
  const turnProviderSettings = agentMode ? agentChatProviderSettings(agentModelOptions) : preferences.providerSettings;
  const hostedDefinition = hostedRoute && chatAgent && (configuredAgentModels(chatAgent).length ? chatAgent
    : selected.find(model => !isVoiceCatalogModel(model)) ? { ...chatAgent, model: { id: selected.find(model => !isVoiceCatalogModel(model))!.id } } : undefined);
  const hostedSelection: HostedAgentSelection | undefined = hostedRoute && agentChat.option && (agentChat.remoteId || hostedDefinition)
    ? { id: agentChat.remoteId ?? agentChat.option.name,
      modelIds: configuredAgentModels(hostedDefinition || chatAgent).map(({ id }) => id),
      definition: agentChat.remoteId ? undefined : hostedDefinition || undefined }
    : undefined;
  const modelId = agentMode ? hostedSelection?.id ?? browserModel?.id : selected[0]?.id;
  const socketVoice = voiceProtocol === 'google' || voiceProtocol === 'xai';
  const canUseVoice = microphone && (socketVoice ? capture.socket : capture.peer);
  const voiceAgents = (agents?.entries ?? []).filter(({ definition }) => !!browserAgentModel(definition, textCatalog));
  const totalCost = useMemo(() => conversationCost(messages), [messages]);
  const contextUsage = preferences.showContextSize ? latestContextUsage(messages, agentMode ? browserModel ? [browserModel] : [] : selected) : undefined;
  const welcomeAgent = assignedAgent(agents, welcomeRoleId);
  const welcomeModels = configuredAgentModels(welcomeAgent).filter(({ type }) => type !== 'decision');
  const welcomeModel = welcomeModels.find(({ id }) => compatibleById.has(id));
  const welcomeInstructions = welcomeAgent?.instructions;
  const apiChatAgent = isApiChat(route);
  const welcomeRequest = useMemo(() => !agentMode && welcomeModel && welcomeInstructions && appAgentTransport
    ? { model: welcomeModel.id, instructions: welcomeInstructions, transport: appAgentTransport, context: appAgentContext,
      provider: apiChatAgent || welcomeModel.id.startsWith('anthropic/') ? agentProviderRequest(welcomeModel) : undefined }
    : undefined, [agentMode, welcomeModel, welcomeInstructions, appAgentTransport, appAgentContext, apiChatAgent]);

  function prepareName() {
    const agent = assignedAgent(agents, conversationNameRoleId);
    const model = configuredAgentModels(agent).find(({ id, type }) => type !== 'decision' && compatibleById.has(id));
    if (agent && model && appAgentTransport) {
      nameRequest.current = { model: model.id, instructions: agent.instructions, transport: appAgentTransport, context: appAgentContext,
        provider: apiChatAgent || model.id.startsWith('anthropic/') ? agentProviderRequest(model) : undefined };
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
  const agentRouter = gatewayAgent && gatewayAgent.answers.length > 1 ? gatewayAgent.router : undefined;
  const hasDecisions = view === 'chat' && agentMode ? !!agentRouter : agents?.config.roles?.some(({ id }) => id === selectModelRoleId);
  const agentChoice = gatewayAgent && agentRouter && decisions.selected !== 'off'
    ? chatModelDecision({ endpoint: decisions.selected, model: agentRouter.id, instructions: agentModelDecisionInstructions },
      gatewayAgent.answers.map(({ model }) => model)) : undefined;
  const modelChoice = voiceProtocol ? undefined : chatModelDecision(router, selected);
  const decision: TurnDecision | undefined = agentChoice && gatewayAgent && chatAgent ? { choice: agentChoice, agent: { context: chatAgent,
    settings: new Map(gatewayAgent.answers.map(({ model, configuration }) => [model.id, agentChatProviderSettings(configuration)])) } }
    : modelChoice && { choice: modelChoice };
  const routesLocked = busy || !!voicePhase || toolBusy || (status === 'ready' && toolParts.length > 0);
  const toolCapabilities = chatToolCapabilities(runRoute, modelId);
  const chatReady = connection.ready && !!modelId && !restoringSkills && !connectingMcp &&
    (!agentMode || (!!agentRoute && !agentChat.checking && !agentChat.loadingDefinition)) &&
    !missingMcp.some(({ server }) => server.required === true) && (!voiceProtocol || canUseVoice);
  const canSend = chatReady && !routesLocked;

  function submitChat(parts: ChatMessage['parts'], id?: string) {
    if (!modelId || voiceProtocol) return;
    if (!latestMessages.current.length && !agentMode) prepareName();
    return sendMessage({ id, role: 'user', parts, metadata: { timestamp: new Date().toISOString() } }, { body: beginTurn(modelId) });
  }

  function closeChatVoice() {
    const run = chatVoiceRun.current;
    if (!run) return;
    chatVoiceRun.current = undefined;
    run.controller.abort();
    run.output?.close();
    setVoicePhase(undefined);
    setVoicePreview('');
  }

  function startChatVoice() {
    if (!voiceTranscriber || !canSend || chatVoiceRun.current || voiceRun.current) return;
    const speech = chatVoiceSpeech(speechModels, chatAgent, agentMode ? undefined : speechAgent);
    const run: ChatVoiceRun = { controller: new AbortController(), queue: [], hearing: false,
      output: speech && createChatVoiceOutput(gateway, speech, scope) };
    chatVoiceRun.current = run;
    const { signal } = run.controller;
    setVoiceNotice('');
    setVoicePhase('connecting');
    // Stop aborts capture rather than flushing it: an uncompleted draft isn't a user message.
    void runMicrophone(gateway, voiceTranscriber.id, transcriptionVoiceOptions(voiceTranscriber), {
      signal, stop: signal, ready: () => { if (!signal.aborted) setVoicePhase('active'); }, update: () => {},
    }, {
      preview: text => {
        run.hearing = !!text;
        if (text) {
          run.output?.interrupt();
          if (run.reply) run.reply.silent = true;
        }
        setVoicePreview(text);
      },
      turn: text => {
        run.output?.interrupt();
        if (run.reply) run.reply.silent = true;
        if (run.queue.length >= 8) { setVoiceNotice('Wait for the assistant before speaking again.'); return; }
        run.queue.push(text);
        updateVoiceQueue(count => count + 1);
      },
    }).catch(error => {
      if (signal.aborted) return;
      setVoiceNotice(errorMessage(error, 'The voice session ended.'));
      closeChatVoice();
    });
  }

  // This uses the same pending tools/approval state as typed chat, including
  // continuations. Keep queued speech out of history until actually submitted.
  useEffect(() => {
    const run = chatVoiceRun.current;
    if (!run || voicePhase !== 'active' || view !== 'chat' || locationIssue || !connection.ready) return;
    const reply = run.reply;
    if (busy) {
      // Interrupt only when tools are explicitly disabled. A hosted/approved
      // operation might not be visible yet and must follow the normal flow.
      if (run.queue.length && reply && !reply.interrupted && turn?.toolChoice === 'none' && !turn.hosted && !turn.nativeApprovalSubmitting) {
        reply.interrupted = true;
        void stop();
      }
      return;
    }
    if (!chatReady || toolBusy || toolParts.length || operation.current) return;
    if (reply) {
      if (!reply.settled) return;
      run.reply = undefined;
      const user = messages.findIndex(message => message.id === reply.userId);
      if (status === 'ready' && user >= 0 && !reply.silent && !run.hearing && !run.queue.length && last?.role === 'assistant' && messages.indexOf(last) > user) {
        const text = last.parts.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n\n').trim();
        if (text) void run.output?.speak(text).catch(error => {
          if (chatVoiceRun.current === run && !(error instanceof DOMException && error.name === 'AbortError')) {
            setVoiceNotice(errorMessage(error, 'Could not play this message.'));
          }
        });
      }
    }
    const text = run.queue.shift();
    if (!text) return;
    const next = { userId: crypto.randomUUID(), settled: false, silent: false };
    run.reply = next;
    void submitChat([{ type: 'text', text }], next.userId)?.catch(() => { /* Chat displays transport errors. */ }).finally(() => {
      next.settled = true;
      if (chatVoiceRun.current === run) updateVoiceQueue(count => count + 1);
    });
  });

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
      setToolBusy(false); setTurn(undefined);
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
      setVoicePhase(undefined); setTurn(undefined); setToolBusy(false);
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
    if (chatVoiceRun.current) stopTurn();
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
    speech: hasGateway ? { ...speech, selected: menuSpeechRoute } : undefined,
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
          showProviderLogo={preferences.showProviderLogo} showMetrics={preferences.showMetrics} showDecisions={preferences.showDecisions}
          gateway={gateway} speechModel={chatVoiceRun.current ? undefined : speechModel} speechRoute={resolveSpeechRoute(speech.selected, speechModel)} scope={scope} menuContainer={menuContainer}
          latestReplySettled={latestReplySettled}
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
           {voiceNotice && <p className="chat-notice chat-error" role="alert">{t(voiceNotice)}</p>}
          {voiceProtocol && !canUseVoice && <p className="chat-notice" role="status">{t(socketVoice
            ? 'Voice requires microphone access, WebSocket, and Web Audio.' : 'Voice requires microphone access and WebRTC.')}</p>}
          {!connectingMcp && missingMcp.length > 0 && <p className="chat-notice" role="status">
            {t('Install, authorize, or reconnect the agent’s MCP servers in Model Context: {{servers}}', { servers: missingMcp.map(({ key }) => key).join(', ') })}
          </p>}
           <div className="chat-progress" role="status">{(progress || restoringSkills || connectingMcp) && <><span className="chat-spinner" aria-hidden="true" />
             {progress || (restoringSkills ? t('Loading provider skills…') : t('Connecting to MCP servers…'))}</>}</div>
          <ComposerUsage context={contextUsage} cost={totalCost} />
          <ChatComposer busy={busy || (status === 'ready' && toolParts.length > 0)} canSend={canSend} onStop={stopTurn}
            voice={voiceProtocol ? { phase: voicePhase, start: () => { void startVoice(); }, stop: stopTurn,
              manualTurn: () => voiceRun.current?.session?.manualTurn() } : modelId && (voiceTranscriber || chatVoiceRun.current)
              ? { emptyOnly: true, phase: voicePhase, preview: voicePreview, start: startChatVoice, stop: stopTurn } : undefined}
            convert={preferences.convertAttachmentsToText} badges={badges} dictation={dictateChat ? dictation : undefined}
            mcp={view === 'chat' && !hostedRoute && mcpServers.available ? { count: new Set([...mcpSelection.entries, ...agentMcp.entries].map(entry => entry.record.id)).size,
              disabled: routesLocked, open: () => setModelContextOpen(true), servers: connectedMcp, connect: mcpServers.connection } : undefined}
            onChatSettings={() => chatSettings.current?.showModal()} onViewContext={() => setContextOpen(true)}
            reasoning={!voiceProtocol && !hostedRoute && isApiChat(runRoute) ? { value: preferences.reasoning,
              onChange: reasoning => onPreferences({ ...preferences, reasoning }) } : undefined}
            onSend={(parts) => {
              if (canSend && !chatVoiceRun.current) { setVoiceNotice(''); void submitChat(parts); }
            }} />
        </div>
      </main>
      <ChatSettingsDialog dialog={chatSettings} value={preferences} onChange={onPreferences} gateway={gatewayRoute} hostedSkillsSupported={hostedSkillsSupported}
        hostedToolSearch={hostedToolSearch} localToolSearch={localToolSearch}
        modelContext={{ servers: contextMcp, registry: connection.mcp, route: mcpRoute, installed: mcpServers.records.length > 0,
          descriptions: new Map(declaredMcp.flatMap(({ endpoint, server }) => endpoint && typeof server.server_description === 'string'
            ? [[endpoint, server.server_description]] : [])) }}
        voice={voiceProtocol ? { protocol: voiceProtocol, models: textCatalog, agents: voiceAgents.map(({ key, definition }) => ({ id: key, name: definition.name })) } : undefined}
        browserToolsSupported={!hostedRoute} hasHistory={hasHistory} locked={routesLocked} localSkills={localSkills} remoteSkills={remoteSkills}
        providerModels={agentMode ? [] : selected.filter(model => !isVoiceCatalogModel(model) &&
          (isApiChat(route) || route.endpoint === '/v1/responses' && model.provider === 'openai' ||
            route.endpoint === '/v1/messages' && model.provider === 'anthropic'))} namespaceSupported={toolCapabilities.namespaces} toolOptionsSupported={toolCapabilities.options}
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
        <SpeechView key={scope} gateway={gateway} scope={scope} routeOverride={speech.selected} toolbar={mediaToolbar}
          models={speechModels} selected={selectedSpeech} onSelect={setSpeechSelection}
          loading={hasGateway && connection.ready && !mediaModels} router={mediaRouter} status={mediaStatus} dictation={dictation} />
      </Suspense> : view === 'transcriptions' ? <Suspense fallback={<main className="catalog-main"><p role="status">{t('Loading transcriptions…')}</p></main>}>
        <TranscriptionsView gateway={gateway} scope={scope} route={transcriptions.selected} toolbar={mediaToolbar} catalog={mediaModels?.catalog}
          menuContainer={menuContainer} loading={hasGateway && connection.ready && !mediaModels} status={mediaStatus} splitting={preferences.transcriptionSplit} />
      </Suspense> : view !== 'chat' && <main className="catalog-main">
        {view === 'mcp' ? <McpServersView store={mcpServers} options={connection.mcp} locked={routesLocked} onEdit={setMcpEditor} toolbar={catalogToolbar} />
          : view === 'models' ? <ModelsView models={result?.error ? undefined : result?.catalog}
          status={!connection.ready ? connection.emptyMessage : !result ? t('Loading models…') : result.error}
           refresh={connection.ready && result ? reload : undefined} /> : view === 'agents'
          ? <AgentsView catalog={agentModels?.catalog ?? []} catalogStatus={agentModelStatus} mcpOptions={connection.mcp} {...{ mcpServers, localSkills, remoteSkills, gateway }}
            toolbar={catalogToolbar} menuContainer={menuContainer} /> : view === 'skills'
          ? <SkillsView store={localSkills} gateway={gateway} remote={remoteSkills} toolbar={catalogToolbar} menuContainer={menuContainer} />
          : <ProvidersView appName={appName} />}
      </main>}
  </div>;
}
