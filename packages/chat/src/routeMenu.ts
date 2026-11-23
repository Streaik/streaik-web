import { gatewayChatEndpoints, gatewayDecisionEndpoints, gatewayImageEndpoints, gatewayTranscriptionEndpoints } from '@streaik/gateway';
import type { ChatRoute, NativeChatEndpoint } from '@streaik/gateway';
import type { ChatView } from './ChatNavigation';
import type { ImageRouteSetting } from './imageRoute';
import type { TranscriptionRouteSetting } from './transcriptionPreferences';
import type { DecisionRoute } from './modelDecisions';

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

export function pageRouteMenu(view: ChatView, { chat, decisions, images, transcriptions }: {
  chat?: { selected: ChatRoute; direct?: readonly NativeChatEndpoint[]; disabled: boolean; onSelect: (route: ChatRoute) => void };
  decisions?: { selected: DecisionRoute; onSelect: (route: DecisionRoute) => void };
  images?: ImageRouteSetting;
  transcriptions?: TranscriptionRouteSetting;
}): RouteMenu | undefined {
  const decisionGroup = decisions && choices('decisions', decisions.selected, ['off', ...gatewayDecisionEndpoints] as const,
    decisions.onSelect, { label: 'Decisions' }, endpoint => endpoint === 'off' ? 'Off' : endpoint);

  // Each page opts into the routes it owns; the navigation only renders the resulting groups.
  switch (view) {
    case 'chat': {
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
  }
}
