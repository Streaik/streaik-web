import { useChat } from '@ai-sdk/react';
import { GatewayError, gatewayChatEndpoints, nativeChatEndpoints, pickChatCatalogModels } from '@streaik/gateway';
import type { ChatRoute, DirectChat } from '@streaik/gateway';
import type { CatalogModel, ChatMessage, Gateway } from '@streaik/gateway';
import { Button, ThemeRoot, useColorScheme } from '@streaik/themes';
import { lazy, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ChatComposer, AttachmentChip } from './ChatComposer';
import { httpLink } from './chatAttachments';
import { MessageActions } from './MessageActions';
import { MessageClock, MessageTime } from './MessageTime';
import { withReplyMetadata } from './messageMetadata';
import { AssistantSpeaker } from './AssistantSpeaker';
import { ChatIcon } from './ChatIcon';
import { ChatNavigation } from './ChatNavigation';
import type { ChatAccount, ChatView } from './ChatNavigation';
import { chatLocation, conversationPath, pagePaths } from './chatLocation';
import { ModelsView, ProvidersView } from './CatalogViews';
import { ModelPicker, resolveModelSelection } from './ModelPicker';
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
import { buildRequestContext, requestContextText, withRequestContext } from './chatContext';
import type { RequestContext } from './chatContext';
import { activeChatTools, filterLocalToolReplay, runLocalTool, toolPartName } from './localPlugins';
import type { ChatTool, ToolDefinition } from './localPlugins';
import { resolveSkillTool } from './skillTools';
import type { TurnRemoteSkills } from './skillTools';
import type { LocalSkill } from './skillBundles';
import { SkillsView } from './SkillsView';
import { useLocalSkills } from './useLocalSkills';
import type { LocalSkills } from './useLocalSkills';
import { useRemoteSkills } from './useRemoteSkills';
import type { RemoteSkills } from './useRemoteSkills';
import { assignedAgent } from './agentCatalog';
import type { AgentsConfig } from './agentCatalog';
import { agentModels as configuredAgentModels } from './agentDefinition';
import { conversationOpeningText, deleteConversation, listConversations, newConversation, newestFirst, saveConversation } from './conversations';
import type { Conversation } from './conversations';
import { callMcpTool, mcpFailure } from './mcp';
import type { McpOptions } from './mcp';
import { McpServerEditor, McpServersView, ModelContextDialog } from './McpServersView';
import type { McpEditorTarget } from './McpServersView';
import { useMcpSelection, useMcpServers } from './useMcpServers';
import type { McpServers } from './useMcpServers';
export type { McpAppAuth, McpOptions, McpRemoteHeader } from './mcp';
import { chatDecisionInput, chatModelDecision, modelDecisionRouter, selectModelRoleId, useDecisionRoute } from './modelDecisions';
import type { ModelDecision } from './modelDecisions';
import { conversationNameRoleId, runTextAppAgent, welcomeRoleId } from './textAppAgents';
import type { TextAppRequest } from './textAppAgents';
import { WelcomeHeading } from './WelcomeHeading';
import { useAppTranslation } from './i18n';
import './chat.css';
import { useImageRoute } from './imageRoute';
import type { ImageRouteSetting } from './imageRoute';
import { useTranscriptionRoute } from './transcriptionPreferences';
import type { TranscriptionRouteSetting } from './transcriptionPreferences';
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

const Message = memo(function Message({ message }: { message: ChatMessage }) {
  const { t } = useAppTranslation();
  const user = message.role === 'user';
  const groups = groupMessageParts(message.parts, user);
  if (!groups.length) return null;
  return <article className="chat-message" data-role={message.role} aria-label={t(user ? 'You' : 'Assistant')}>
    {user ? <MessageTime timestamp={message.metadata?.timestamp} /> : <div className="chat-message-header">
      <AssistantSpeaker model={message.metadata?.model} />
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
          : <Suspense key={group.start} fallback={<div className="chat-user-text">{group.text}</div>}><AssistantMarkdown text={group.text} /></Suspense>;
      })}
    </div>
    {!user && <MessageActions message={message} />}
  </article>;
});

function Transcript({ messages }: { messages: ChatMessage[] }) {
  const { t } = useAppTranslation();
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    const node = scroll.current;
    if (node && follow.current) node.scrollTop = node.scrollHeight;
  }, [messages]);
  return <section ref={scroll} onScroll={() => {
    const node = scroll.current;
    if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
  }} className="chat-transcript" aria-label={t('Conversation')} tabIndex={0}>
    <MessageClock><div className="chat-column">{messages.map((message) => <Message key={message.id} message={message} />)}</div></MessageClock>
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
      <HistoryChat key={JSON.stringify([scope, mcpSession])} appName={appName} gateway={gateway} connection={connection} scope={scope} models={models} mcpSession={mcpSession}
        route={route} onRoute={setRoute} decisions={decisions} images={images} transcriptions={transcriptions} onSettings={() => settings.current?.showModal()}
        preferences={preferences} onPreferences={updatePreferences} />
      <SettingsDialog dialog={settings} apiKeySettings={connection.apiKeySettings} accountSettings={connection.settings} images={gateway.historyScope !== 'direct' ? images : undefined}
        transcriptions={gateway.historyScope !== 'direct' ? transcriptions : undefined}
        convertAttachmentsToText={preferences.convertAttachmentsToText}
        onConvertAttachmentsToTextChange={convertAttachmentsToText => updatePreferences({ ...preferences, convertAttachmentsToText })} />
    </AgentsProvider>
  </ThemeRoot>;
}

function HistoryChat({ appName, gateway, connection, scope, models, route, onRoute, decisions, images, transcriptions, onSettings, preferences, onPreferences, mcpSession }: {
  appName: string; gateway: Gateway; connection: Connection; scope?: string; models: ReturnType<typeof useModels>; onSettings: () => void;
  mcpSession: boolean;
  route: ChatRoute; onRoute: (route: ChatRoute) => void;
  decisions: ReturnType<typeof useDecisionRoute>;
  images: ImageRouteSetting;
  transcriptions: TranscriptionRouteSetting;
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
  const writes = useRef(Promise.resolve());
  const pendingNames = useRef(new Map<string, AbortController>());

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
    storageIssue={storageIssue} locationIssue={locationIssue}
    nav={nav} view={view} onView={(next) => {
      if (next !== 'chat' && next !== view) void navigate(pagePaths[next]);
      if (window.matchMedia('(max-width: 42rem)').matches) setNav(false);
    }} toggleNav={() => setNav((open) => !open)} onPersist={persist}
    onNew={() => startDraft()}
    onSwitch={(item) => {
      if (target.kind !== 'conversation' || target.id !== item.id) void navigate(conversationPath(item.id));
    }} onPin={togglePin} onDelete={remove}
    models={models} route={route} onRoute={onRoute} decisions={decisions} images={images} videos={videos} transcriptions={transcriptions} scope={scope} onSettings={onSettings}
    preferences={preferences} onPreferences={onPreferences}
    localSkills={localSkills} remoteSkills={remoteSkills} mcpServers={mcpServers} readHistory={scope ? () => latestHistory.current : undefined} />;
}

type ToolResult = { output: unknown; images?: string[] };
type Turn = { model: string; route: ChatRoute; tools: ChatTool[]; context?: RequestContext;
  catalog: readonly CatalogModel[]; skills: readonly LocalSkill[]; remoteSkills?: TurnRemoteSkills;
  seen: Set<string>; resolved: Set<string>; automatic: { calls: number } };
const isApiChat = (route: ChatRoute | undefined) => !route || (route.mode === 'gateway' && route.endpoint === '/api/chat');
const toolComplete = (part: Invocation) => part.state === 'output-available' || part.state === 'output-error' || part.state === 'approval-responded';

function ChatSession({ appName, gateway, connection, conversation, history, storageIssue, locationIssue, nav, view, onView, toggleNav, onPersist, onNew, onSwitch, onPin, onDelete, models, route, onRoute, decisions, images, videos, transcriptions, scope, onSettings, preferences, onPreferences, localSkills, remoteSkills, mcpServers, readHistory }: {
  appName: string; gateway: Gateway; connection: Connection; conversation: Conversation; history: Conversation[]; storageIssue: string;
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
  const [selectedIds, setSelectedIds] = useState<string[] | undefined>(() =>
    conversation.metadata?.model ? [conversation.metadata.model] : undefined);
  const [pendingModel, setPendingModel] = useState<string>();
  const [deciding, setDeciding] = useState(false);
  const [turn, setTurn] = useState<Turn>();
  const chatSettings = useRef<HTMLDialogElement>(null);
  const contextDialog = useRef<HTMLDialogElement>(null);
  const [menuContainer, setMenuContainer] = useState<HTMLDivElement | null>(null);
  const [agentToolbar, setAgentToolbar] = useState<HTMLDivElement | null>(null);
  const [mediaToolbar, setMediaToolbar] = useState<HTMLDivElement | null>(null);
  const saved = useRef(conversation.messages);
  const nameRequest = useRef<TextAppRequest>(undefined);
  const direct = connection.direct;
  // Agents and media use the gateway catalog even when chat is routed directly.
  const mediaView = view === 'images' || view === 'videos' || view === 'transcriptions';
  const fetchGatewayModels = route.mode === 'direct' && (view === 'agents' || mediaView && gateway.historyScope !== 'direct');
  const gatewayModels = useModels(gateway, connection.ready && fetchGatewayModels, connection.modelRevision ?? 0, scope);
  const transport = useMemo<ReturnType<Gateway['chatTransport']>>(() => {
    const apiChat = gateway.chatTransport();
    return {
      async sendMessages(request) {
        const last = request.messages.at(-1);
        const previous = request.trigger === 'submit-message' && last?.role === 'assistant' ? last : undefined;
        const { route, decision, context, ...body } = (request.body ?? {}) as {
          model?: string; route?: ChatRoute; decision?: ModelDecision; context?: RequestContext; tools?: ToolDefinition[];
        };
        let model = body.model;
        const useGateway = route?.mode !== 'direct';
        const enabledSkillIds = new Set(context?.skills?.availableSkills.skills.map(({ id }) => id));
        request = { ...request, body, messages: filterLocalToolReplay(request.messages, useGateway ? body.tools ?? [] : [], isApiChat(route), enabledSkillIds) };
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
        if (isApiChat(route)) {
          const stream = await apiChat.sendMessages({ ...request, body: { ...request.body, ...(body.tools?.length && { clientToolResultApproval: true }) },
            messages: withRequestContext(request.messages, context) });
          return withReplyMetadata(stream, model, previous);
        }
        if (route?.mode === 'gateway' && gatewayChatEndpoints.includes(route.endpoint)) {
          const stream = await gateway.chatTransport(route.endpoint).sendMessages({ ...request,
            body: { ...request.body, ...(context && { instructions: requestContextText(context) }) } });
          return withReplyMetadata(stream, model, previous);
        }
        if (route?.mode === 'direct' && direct && nativeChatEndpoints.includes(route.endpoint)) {
          return withReplyMetadata(await direct.chatTransport(route.endpoint).sendMessages(request), model, previous);
        }
        throw new GatewayError('The selected chat route is unavailable.');
      },
      async reconnectToStream() { return null; },
    };
  }, [gateway, direct]);
  const { messages, sendMessage, regenerate, setMessages, addToolOutput, stop, status, error } = useChat({
    id: conversation.id, messages: conversation.messages, transport, throttle: preferences.delay || undefined,
  });
  useEffect(() => () => { void stop(); }, [stop]);
  const [modelContextOpen, setModelContextOpen] = useState(false);
  const [mcpEditor, setMcpEditor] = useState<McpEditorTarget>();
  const mcpSelection = useMcpSelection(mcpServers);
  const [toolNotice, setToolNotice] = useState('');
  const [toolBusy, setToolBusy] = useState(false);
  const [staged, setStaged] = useState<{ turn: Turn; callId: string; result: ToolResult }>();
  const [toolImages, setToolImages] = useState<string[]>([]);
  const operation = useRef<AbortController | null>(null);
  const hasHistory = !!readHistory;
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const gatewayRoute = route.mode === 'gateway';
  const appAgentContext = useMemo(() => buildRequestContext(appName, language, darkMode), [appName, language, darkMode]);
  const appAgentTransport = useMemo(() => route.mode === 'direct' ? direct?.chatTransport(route.endpoint)
    : gateway.chatTransport(route.endpoint), [gateway, direct, route]);
  const { online: skillsOnline, skills: providerSkills, busy: skillsBusy, needsLoad: needsSkills, cursor: skillCursor,
    error: skillCatalogError, load: loadSkills } = remoteSkills;
  const enabledRemoteSkills = useMemo(() => gatewayRoute && skillsOnline ? providerSkills.filter(skill => preferences.remoteSkillIds.includes(skill.id)) : [],
    [gatewayRoute, skillsOnline, providerSkills, preferences.remoteSkillIds]);
  // Restore saved selections even if the user never opens the Skills tab in this session.
  const restoringSkills = gatewayRoute && skillsOnline && enabledRemoteSkills.length < preferences.remoteSkillIds.length
    && skillCatalogError === undefined && (skillsBusy || needsSkills || !!skillCursor);
  useEffect(() => {
    if (restoringSkills && !skillsBusy) loadSkills(skillCursor);
  }, [restoringSkills, skillsBusy, loadSkills, skillCursor]);
  const hasSkills = enabledRemoteSkills.length > 0 || localSkills.skills.some(({ enabled }) => enabled);
  const enabledTools = activeChatTools(route, preferences.plugins, hasHistory, mcpSelection.tools, hasSkills);
  const context = useMemo(() => gatewayRoute ? buildRequestContext(appName, language, darkMode, localSkills.skills, enabledRemoteSkills) : undefined,
    [gatewayRoute, appName, language, darkMode, localSkills.skills, enabledRemoteSkills]);
  const last = messages.at(-1);
  const parts = last?.role === 'assistant' ? last.parts : [];
  const toolParts = parts.flatMap(part => {
    if (!('toolCallId' in part) || !turn || part.providerExecuted || turn.seen.has(part.toolCallId)) return [];
    const name = toolPartName(part);
    const tool = turn.tools.find(tool => tool.definition.name === name);
    return tool || (isApiChat(turn.route) && part.state === 'approval-requested') ? [{ part, tool }] : [];
  });
  const pending = toolParts.find(({ part }) => !toolComplete(part) && !turn?.resolved.has(part.toolCallId));
  const stagedResult = staged && staged.turn === turn && staged.callId === pending?.part.toolCallId ? staged.result : undefined;
  useEffect(() => () => { operation.current?.abort(); }, []);

  function requestBody(turn: Turn) {
    return { model: turn.model, route: turn.route, context: turn.context,
      tools: turn.tools.map(({ definition: { name, description, inputSchema } }) => ({ name, description, inputSchema })) };
  }

  // Stage browser results outside the SDK transcript. Nothing can replay an unreviewed output.
  // Continue once per completed batch, with the original route, model and tool set.
  useEffect(() => {
    if (status !== 'ready' || toolBusy || operation.current || !turn || !toolParts.length) return;
    if (pending && isApiChat(turn.route)) {
      const { part, tool } = pending;
      if (part.state !== 'approval-requested' || !tool) {
        setToolNotice('The gateway did not return an approval for this client tool.');
        setTurn(undefined);
      } else if (!stagedResult) {
        if (turn.automatic.calls >= 8) {
          setToolNotice('Local tool limit reached for this turn.');
          setTurn(undefined);
        } else {
          turn.automatic.calls++;
          void completeTool(part, tool, 'stage');
        }
      }
      return;
    }
    if (pending?.part.state === 'input-available' && (pending.tool?.source === 'skill' || pending.tool?.source === 'mcp' ||
        (pending.tool?.source === 'local' && !pending.tool.plugin.approval))) {
      if (stagedResult) return;
      if (turn.automatic.calls >= 8) {
        setToolNotice('Local tool limit reached for this turn.');
        setTurn(undefined);
      } else {
        turn.automatic.calls++;
        void completeTool(pending.part, pending.tool, pending.tool.source === 'mcp' ? 'stage' : 'run');
      }
      return;
    }
    if (toolParts.every(({ part }) => toolComplete(part))) {
      toolParts.forEach(({ part }) => turn.seen.add(part.toolCallId));
      void sendMessage(undefined, { body: requestBody(turn) });
    }
  });

  async function completeTool(part: Invocation, tool: ChatTool, action: 'stage' | 'run' | 'decline') {
    if (!turn || turn.resolved.has(part.toolCallId) || operation.current || status !== 'ready') return;
    const controller = new AbortController();
    // The render snapshot can lag behind addToolOutput when message updates are throttled.
    if (action !== 'stage') turn.resolved.add(part.toolCallId);
    operation.current = controller; setToolBusy(true);
    try {
      let output: unknown, images: string[] | undefined;
      if (tool.source === 'local') {
        output = action === 'decline' ? { isError: true, content: [{ type: 'text', text: 'The user declined to share local chat history.' }] }
          : runLocalTool(tool, part.input, { catalog: turn.catalog, history: tool.plugin.requiresHistory ? readHistory?.() ?? [] : [] });
      } else if (tool.source === 'skill') {
        output = await resolveSkillTool(tool.definition.name, part.input, turn.skills, turn.remoteSkills, controller.signal);
      } else {
        if (!mcpServers.available) output = 'MCP is unavailable.';
        else try {
          const result = await callMcpTool(tool.tool, part.input, controller.signal);
          output = result.text;
          images = result.images;
        } catch (error) { output = mcpFailure(error); }
      }
      if (controller.signal.aborted) return;
      if (action === 'stage') setStaged({ turn, callId: part.toolCallId, result: { output, images } });
      else {
        if (images?.length) setToolImages(images);
        await addToolOutput({ tool: tool.definition.name, toolCallId: part.toolCallId, output });
      }
    } catch {
      if (!controller.signal.aborted) { setToolNotice('Could not apply the tool result.'); setTurn(undefined); }
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (!controller.signal.aborted) setToolBusy(false);
      }
    }
  }

  function answerTool(approved: boolean) {
    if (!turn || !pending || !last || toolBusy || operation.current || status !== 'ready') return;
    const { part, tool } = pending;
    if (turn.resolved.has(part.toolCallId)) return;
    if (!isApiChat(turn.route)) {
      if (tool?.source === 'mcp') {
        if (!stagedResult || part.state !== 'input-available') return;
        turn.resolved.add(part.toolCallId);
        setStaged(undefined);
        if (approved && stagedResult.images?.length) setToolImages(stagedResult.images);
        void addToolOutput({ tool: tool.definition.name, toolCallId: part.toolCallId,
          output: approved ? stagedResult.output : 'The user declined to share this tool result.' });
      } else if (tool) void completeTool(part, tool, approved ? 'run' : 'decline');
      return;
    }
    const result = stagedResult;
    if (part.state !== 'approval-requested' || !result) return;
    turn.resolved.add(part.toolCallId);
    setStaged(undefined);
    if (approved && result.images?.length) setToolImages(result.images);
    // Apply the decision and approved output atomically, preserving a signature when provided.
    const approval = { ...part.approval, approved };
    const answered: Invocation = approved
      ? { ...part, state: 'output-available', approval: { ...approval, approved: true }, output: result.output }
      : { ...part, state: 'approval-responded', approval, output: undefined };
    setMessages(current => current.map(message => message.id === last.id ? { ...message,
      parts: message.parts.map(item => 'toolCallId' in item && item.toolCallId === part.toolCallId ? answered : item) } : message));
  }

  function beginTurn(model: string) {
    setToolNotice('');
    setPendingModel(decision ? undefined : model);
    const seen = new Set(messages.flatMap(message => message.parts.flatMap(part => 'toolCallId' in part ? [part.toolCallId] : [])));
    const next: Turn = { model, route, tools: enabledTools, context, catalog, skills: localSkills.skills, seen, resolved: new Set(), automatic: { calls: 0 },
      remoteSkills: enabledRemoteSkills.length ? { skills: enabledRemoteSkills, download: gateway.downloadSkill, bundles: new Map() } : undefined };
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
  }

  function pendingReview(): ToolReview | undefined {
    if (!turn || !pending || status !== 'ready') return;
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
  const hasGateway = gateway.historyScope !== 'direct';
  const mediaModels = hasGateway ? agentModels : undefined;
  const imageRouter = view === 'images' && mediaModels ? modelDecisionRouter(agents, mediaModels.catalog, decisions.selected) : undefined;
  const mediaStatus = !hasGateway ? t('No gateway is configured.') : !connection.ready ? connection.emptyMessage
    : !mediaModels ? t('Loading models…') : mediaModels.error;
  const agentModelStatus = !connection.ready ? t('Connect to the gateway to browse models. You can still edit this agent.')
    : !agentModels ? t('Loading gateway models…') : agentModels.error;
  const compatible = route.mode === 'direct' ? catalog.filter(item => direct?.supports(item.provider, route.endpoint)) : pickChatCatalogModels(catalog);
  const router = gatewayRoute ? modelDecisionRouter(agents, catalog, decisions.selected) : undefined;
  const { byId: compatibleById, selected } = resolveModelSelection(compatible, selectedIds, !!router);
  const model = selected[0];
  const welcomeAgent = assignedAgent(agents, welcomeRoleId);
  const welcomeModels = configuredAgentModels(welcomeAgent).filter(({ type }) => type !== 'decision');
  const welcomeModel = welcomeModels.find(({ id }) => compatibleById.has(id))?.id;
  const welcomeInstructions = welcomeAgent?.instructions;
  const welcomeRequest = useMemo(() => welcomeModel && welcomeInstructions && appAgentTransport
    ? { model: welcomeModel, instructions: welcomeInstructions, transport: appAgentTransport, context: appAgentContext }
    : undefined, [welcomeModel, welcomeInstructions, appAgentTransport, appAgentContext]);

  function prepareName() {
    const agent = assignedAgent(agents, conversationNameRoleId);
    const model = configuredAgentModels(agent).find(({ id, type }) => type !== 'decision' && compatibleById.has(id));
    if (agent && model && appAgentTransport) {
      nameRequest.current = { model: model.id, instructions: agent.instructions, transport: appAgentTransport, context: appAgentContext };
    }
  }
  useEffect(() => {
    // Persist the submitted user turn and the terminal (including manually stopped) transcript.
    // Do not write on every text delta, or save an empty new chat.
    if (status === 'streaming' || !messages.length || messages === saved.current) return;
    saved.current = messages;
    onPersist({ ...conversation, messages,
      metadata: { ...conversation.metadata, model: pendingModel ?? model?.id, updatedAt: new Date().toISOString() } }, nameRequest.current);
  }, [messages, status, conversation, pendingModel, model?.id, onPersist]);
  const hasDecisions = agents?.config.roles?.some(({ id }) => id === selectModelRoleId);
  const decision = chatModelDecision(router, selected);
  const routesLocked = busy || toolBusy || (status === 'ready' && toolParts.length > 0);
  const canSend = !!model && !routesLocked && !restoringSkills && !mcpSelection.loading;
  const routeMenu = pageRouteMenu(view, {
    chat: connection.account ? { selected: route, direct: direct?.endpoints(!connection.ready), disabled: routesLocked, onSelect: onRoute } : undefined,
    decisions: connection.account && hasDecisions ? decisions : undefined,
    images: hasGateway ? images : undefined,
    transcriptions: hasGateway ? transcriptions : undefined,
  });
  const modelStatus = !connection.ready ? connection.emptyMessage : !result ? t('Loading models…') :
    result.error ?? (!compatible.length ? route.mode === 'direct' ? t('No models for this Direct route. Check your provider keys or choose another route.')
      : t('No compatible models are available. Check the gateway and its provider credentials.') : null);

  return <div ref={setMenuContainer} className="chat-shell" data-nav={nav ? 'expanded' : 'collapsed'} data-view={view}>
      <ChatNavigation appName={appName} expanded={nav} history={history} active={view === 'chat' && !locationIssue ? conversation.id : ''} busy={busy || toolBusy}
        account={connection.account} container={menuContainer} view={view} onView={onView}
        pinnedViews={preferences.pinnedViews} onToggleViewPin={(key) => onPreferences({ ...preferences,
          pinnedViews: preferences.pinnedViews.includes(key) ? preferences.pinnedViews.filter(view => view !== key) : [...preferences.pinnedViews, key] })}
        toggle={toggleNav} onNew={onNew} onOpen={onSwitch}
        onPin={onPin} onDelete={onDelete} onSettings={onSettings} routes={routeMenu} />
      <header className="chat-toolbar" hidden={view !== 'chat' && view !== 'agents' && view !== 'skills' && !mediaView && !connection.signIn}>
        {view === 'chat' && !locationIssue && <ModelPicker models={compatible} selected={selected} multiple={!!router}
          loading={connection.ready && !result} disabled={routesLocked} onChange={setSelectedIds} />}
        {mediaView && <div className="chat-image-toolbar" ref={setMediaToolbar} />}
        {connection.signIn && <div className="chat-account">{connection.signIn}</div>}
        {(view === 'agents' || view === 'skills') && <div ref={setAgentToolbar} />}
      </header>
      {locationIssue && <main className="catalog-main"><div className="catalog-content">
        <p role="status">{t(locationIssue)}</p>
        {storageIssue && <p role="status">{t(storageIssue)}</p>}
        {!connection.ready && <p>{connection.emptyMessage}</p>}
      </div>
      </main>}
      <main className="chat-main" data-empty={!messages.length} hidden={view !== 'chat' || !!locationIssue}>
        {messages.length ? <Transcript messages={messages} /> : null}
        <div className="chat-column chat-dock">
           {!messages.length && !locationIssue && <WelcomeHeading request={welcomeRequest} discovering={connection.ready && !result && welcomeModels.length > 0} />}
           {storageIssue && !locationIssue && <div className="chat-notice" role="status">{t(storageIssue)}</div>}
           {modelStatus && !locationIssue && <div className="chat-notice" role="status">
            {modelStatus}{connection.ready && result && <Button onClick={reload}>{t('Refresh models')}</Button>}
          </div>}
          {error && <div className="chat-notice chat-error" role="alert">
            {t(errorMessage(error, 'The reply was interrupted. You can retry or send another message.'))}
            <Button disabled={!canSend} onClick={() => { if (model && canSend) void regenerate({ body: beginTurn(model.id) }); }}>{t('Retry')}</Button>
          </div>}
          {!!toolImages.length && <section className="chat-notice" aria-label={t('MCP output')}>
             {toolImages.map((image, index) => <img className="chat-mcp-image" key={index} alt={t('MCP image {{index, number}}', { index: index + 1 })} src={image} />)}
           </section>}
          {toolNotice && <p className="chat-notice" role="status">{t(toolNotice)}</p>}
           <div className="chat-progress" role="status">{(progress || restoringSkills || mcpSelection.loading) && <><span className="chat-spinner" aria-hidden="true" />
             {progress || (restoringSkills ? t('Loading provider skills…') : t('Loading MCP tools…'))}</>}</div>
          <ChatComposer busy={busy || (status === 'ready' && toolParts.length > 0)} canSend={canSend} onStop={stopTurn}
            convert={preferences.convertAttachmentsToText}
            mcp={mcpServers.available ? { count: mcpSelection.entries.length, disabled: routesLocked, open: () => setModelContextOpen(true) } : undefined}
            onChatSettings={() => chatSettings.current?.showModal()} onViewContext={() => contextDialog.current?.showModal()}
            onSend={(parts) => {
              if (!model || !canSend) return;
              if (!messages.length) prepareName();
              void sendMessage({ role: 'user', parts, metadata: { timestamp: new Date().toISOString() } }, { body: beginTurn(model.id) });
            }} />
        </div>
      </main>
      <ChatSettingsDialog dialog={chatSettings} value={preferences} onChange={onPreferences} gateway={gatewayRoute}
        hasHistory={hasHistory} locked={routesLocked} localSkills={localSkills} remoteSkills={remoteSkills} />
      <ViewContextDialog dialog={contextDialog} context={(busy || toolParts.length > 0) && turn ? turn.context : context}
        tools={(busy || toolParts.length > 0) && turn ? turn.tools : enabledTools} />
      {review && <ToolApprovalDialog key={`${review.id}:${review.kind}`} review={review} onAnswer={answerTool} onStop={stopTurn} />}
      {view === 'chat' && mcpServers.available && modelContextOpen && <ModelContextDialog store={mcpServers} options={connection.mcp}
        selection={mcpSelection} locked={routesLocked} onEdit={setMcpEditor} close={() => setModelContextOpen(false)} />}
      {mcpServers.available && mcpEditor && <McpServerEditor target={mcpEditor} options={connection.mcp} store={mcpServers} close={() => setMcpEditor(undefined)} />}
       <footer className="chat-disclaimer" hidden={view !== 'chat' || !!locationIssue}>{t('{{appName}} can make mistakes. Check important information.', { appName })}</footer>
      {view === 'images' ? <Suspense fallback={<main className="catalog-main"><p role="status">{t('Loading images…')}</p></main>}>
        <ImagesView gateway={gateway} scope={scope} route={images.selected} toolbar={mediaToolbar} catalog={mediaModels?.catalog}
          loading={hasGateway && connection.ready && !mediaModels} router={imageRouter} status={mediaStatus} />
      </Suspense> : view === 'videos' ? <Suspense fallback={<main className="catalog-main"><p role="status">{t('Loading videos…')}</p></main>}>
        <VideosView gateway={gateway} library={videos} toolbar={mediaToolbar} catalog={mediaModels?.catalog}
          loading={hasGateway && connection.ready && !mediaModels} ready={hasGateway && connection.ready} status={mediaStatus} />
      </Suspense> : view === 'transcriptions' ? <Suspense fallback={<main className="catalog-main"><p role="status">{t('Loading transcriptions…')}</p></main>}>
        <TranscriptionsView gateway={gateway} scope={scope} route={transcriptions.selected} toolbar={mediaToolbar} catalog={mediaModels?.catalog}
          menuContainer={menuContainer} loading={hasGateway && connection.ready && !mediaModels} status={mediaStatus} />
      </Suspense> : view !== 'chat' && <main className="catalog-main">
        {view === 'mcp' ? <McpServersView store={mcpServers} options={connection.mcp} locked={routesLocked} onEdit={setMcpEditor} />
          : view === 'models' ? <ModelsView models={result?.error ? undefined : result?.catalog}
          status={!connection.ready ? connection.emptyMessage : !result ? t('Loading models…') : result.error}
           refresh={connection.ready && result ? reload : undefined} /> : view === 'agents'
          ? <AgentsView catalog={agentModels?.catalog ?? []} catalogStatus={agentModelStatus}
            toolbar={agentToolbar} menuContainer={menuContainer} /> : view === 'skills'
          ? <SkillsView store={localSkills} gateway={gateway} remote={remoteSkills} toolbar={agentToolbar} menuContainer={menuContainer} />
          : <ProvidersView appName={appName} />}
      </main>}
  </div>;
}
