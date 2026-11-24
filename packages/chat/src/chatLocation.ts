import { matchRoutes } from 'react-router';
import type { ChatView } from './ChatNavigation';

type PageView = Exclude<ChatView, 'chat'>;
export const pagePaths = {
  providers: '/providers',
  models: '/models',
  images: '/images',
  videos: '/videos',
  transcriptions: '/transcriptions',
  agents: '/agents',
  skills: '/skills',
} as const satisfies Record<PageView, string>;

const home = { kind: 'home' } as const;
const unavailable = { kind: 'unavailable' } as const;
const routes = [
  { path: '/', handle: home },
  { path: '/c/:id', handle: { kind: 'conversation' } as const },
  ...Object.entries(pagePaths).map(([view, path]) => ({ path, handle: { kind: 'page', view: view as PageView } as const })),
].map(route => ({ ...route, caseSensitive: true }));

export function chatLocation(pathname: string) {
  const match = matchRoutes(routes, { pathname })?.[0];
  if (match?.route.handle.kind === 'conversation') {
    return match.params.id ? { kind: 'conversation' as const, id: match.params.id } : unavailable;
  }
  return match?.route.handle ?? unavailable;
}

export function conversationPath(id: string) {
  return `/c/${encodeURIComponent(id)}`;
}
