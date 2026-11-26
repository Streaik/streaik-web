import { gatewayChatEndpoints, gatewayDecisionEndpoints, gatewayImageEndpoints, gatewaySpeechEndpoints, gatewayTranscriptionEndpoints } from '@streaik/gateway';
import type { ChatRoute, NativeChatEndpoint } from '@streaik/gateway';
import type { ChatView } from './ChatNavigation';
import type { ImageRouteSetting } from './imageRoute';
import type { TranscriptionRouteSetting } from './transcriptionPreferences';
import type { SpeechRouteSetting } from './speechPreferences';
import type { DecisionRoute } from './modelDecisions';
import type { AgentChatRoute } from './agentChat';

type RouteChoiceGroup = {
  id: string;
  selected: string;
  options: readonly { value: string; label: string; onSelect: () => void }[];
  submenu?: { label: string; disabled?: boolean };
};

export type RouteMenu = { groups: readonly RouteChoiceGroup[]; disabled?: boolean };

function choices<T extends string>(id: string, selected: string, endpoints: readonly T[], onSelect: (endpoint: T) => void,
  submenu?: RouteChoiceGroup['submenu'], label = (endpoint: T): string => endpoint): RouteChoiceGroup {
  return { id, selected, submenu, options: endpoints.map(value => ({ value, label: label(value), onSelect: () => onSelect(value) })) };
}

export function pageRouteMenu(view: ChatView, { chat, agents, decisions, images, transcriptions, speech }: {
  chat?: { selected: ChatRoute; direct?: readonly NativeChatEndpoint[]; disabled: boolean; onSelect: (route: ChatRoute) => void };
  agents?: { selected?: AgentChatRoute; hosted?: boolean; gateway: boolean; direct?: readonly NativeChatEndpoint[];
    disabled: boolean; onSelect: (route: AgentChatRoute) => void };
  decisions?: { selected: DecisionRoute; onSelect: (route: DecisionRoute) => void };
  images?: ImageRouteSetting;
  transcriptions?: TranscriptionRouteSetting;
  speech?: SpeechRouteSetting;
}): RouteMenu | undefined {
  const decisionGroup = decisions && choices('decisions', decisions.selected, ['off', ...gatewayDecisionEndpoints] as const,
    decisions.onSelect, { label: 'Decisions' }, endpoint => endpoint === 'off' ? 'Off' : endpoint);

  // Each page opts into the routes it owns; the navigation only renders the resulting groups.
  switch (view) {
    case 'chat': {
      if (agents) {
        const { selected, hosted, gateway, direct, disabled, onSelect } = agents;
        const groups = [choices('agents', selected?.mode === 'agents' ? selected.endpoint : '', gatewayChatEndpoints,
          endpoint => onSelect({ mode: 'agents', endpoint }), { label: 'Agents', disabled: !hosted }),
        choices('gateway', selected?.mode === 'gateway' ? selected.endpoint : '', gatewayChatEndpoints,
          endpoint => onSelect({ mode: 'gateway', endpoint }), { label: 'Gateway', disabled: !gateway })];
        if (direct) groups.push(choices('direct', selected?.mode === 'direct' ? selected.endpoint : '', direct,
          endpoint => onSelect({ mode: 'direct', endpoint }), { label: 'Direct', disabled: !direct.length }));
        return { groups, disabled };
      }
      if (!chat) return;
      const { selected, direct, disabled, onSelect } = chat;
      const groups = [choices('gateway', selected.mode === 'gateway' ? selected.endpoint : '', gatewayChatEndpoints,
        endpoint => onSelect({ mode: 'gateway', endpoint }), direct && { label: 'Gateway' })];
      if (direct) groups.push(choices('direct', selected.mode === 'direct' ? selected.endpoint : '', direct,
        endpoint => onSelect({ mode: 'direct', endpoint }), { label: 'Direct', disabled: !direct.length }));
      if (decisionGroup) groups.push(decisionGroup);
      return { groups, disabled };
    }
    case 'images': {
      if (!images) return;
      const groups = [choices('images', images.selected, gatewayImageEndpoints, images.onSelect)];
      if (decisionGroup) groups.push(decisionGroup);
      return { groups };
    }
    case 'transcriptions':
      if (transcriptions) return { groups: [choices('transcriptions', transcriptions.selected, gatewayTranscriptionEndpoints, transcriptions.onSelect)] };
      break;
    case 'speech': {
      if (!speech) return;
      const groups = [choices('speech', speech.selected, gatewaySpeechEndpoints, speech.onSelect)];
      if (decisionGroup) groups.push(decisionGroup);
      return { groups };
    }
  }
}
