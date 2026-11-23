import type { Gateway, RemoteSkill } from '@streaik/gateway';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { skillError } from './SkillDialogs';

type Connection = { gateway: Gateway; online: boolean; revision: number };
type Catalog = {
  connection: Connection; skills: RemoteSkill[]; loaded?: boolean; cursor?: string;
  request?: { after?: string }; error?: string;
};

// Keep the catalog above the Skills view and the current conversation, but within the account scope.
export function useRemoteSkills(gateway: Gateway, online: boolean, revision: number) {
  const connection = useMemo(() => ({ gateway, online, revision }), [gateway, online, revision]);
  const [catalog, setCatalog] = useState<Catalog>(() => ({ connection, skills: [] }));
  const current: Catalog = catalog.connection === connection ? catalog : { connection, skills: [] };
  if (current !== catalog) setCatalog(current);
  const { request } = current;

  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    const { after } = request;
    function settle(update: (catalog: Catalog) => Catalog) {
      if (controller.signal.aborted) return;
      setCatalog(value => value.connection === connection && value.request === request ? update(value) : value);
    }
    void connection.gateway.listSkills({ limit: 50, after }, controller.signal).then(page => {
      settle(value => ({ ...value, request: undefined, loaded: true,
        skills: [...new Map([...value.skills, ...page.data].map(skill => [skill.id, skill])).values()],
        cursor: page.has_more && page.last_id && page.last_id !== after ? page.last_id : undefined }));
    }).catch(error => settle(value => ({ ...value, request: undefined, error: skillError(error) })));
    return () => controller.abort();
  }, [connection, request]);

  const load = useCallback((after?: string) => {
    if (!connection.online) return;
    setCatalog(value => value.connection !== connection || value.request ? value
      : { ...value, request: { after }, error: undefined });
  }, [connection]);

  function upsert(skill: RemoteSkill) {
    setCatalog(value => value.connection !== connection ? value
      : { ...value, skills: [skill, ...value.skills.filter(item => item.id !== skill.id)] });
  }

  return { online, skills: current.skills, cursor: current.cursor, busy: !!request, error: current.error,
    needsLoad: online && !request && !current.loaded && current.error === undefined, load, upsert };
}

export type RemoteSkills = ReturnType<typeof useRemoteSkills>;
