import { useEffect, useRef, useState } from 'react';
import type { LocalSkill } from './skillBundles';

async function skillDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('streaik-skills', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('libraries'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Skill storage is blocked.'));
  });
}

async function loadSkills(scope: string): Promise<LocalSkill[]> {
  const db = await skillDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('libraries').objectStore('libraries').get(scope);
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function storeSkills(scope: string, skills: LocalSkill[]): Promise<void> {
  const db = await skillDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('libraries', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.objectStore('libraries').put(skills, scope);
    });
  } finally { db.close(); }
}

// Mounted under the account/connection key in ChatApp, like chat history.
export function useLocalSkills(scope?: string) {
  const [skills, setSkills] = useState<LocalSkill[]>([]);
  const [ready, setReady] = useState(!scope);
  const [notice, setNotice] = useState(scope ? '' : 'Skills are kept only for this session.');
  const current = useRef<LocalSkill[]>([]);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    if (!scope) return;
    let active = true;
    void loadSkills(scope).then(value => {
      if (active) { current.current = value; setSkills(value); }
    }, () => { if (active) setNotice('Could not read browser skill storage.'); })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [scope]);

  function update(change: (skills: LocalSkill[]) => LocalSkill[]) {
    if (!ready) throw new Error('The local skills library is still loading.');
    const next = change(current.current);
    current.current = next; setSkills(next);
    if (scope) writes.current = writes.current.then(() => storeSkills(scope, next)).catch(() => {
      setNotice('Could not save skills to browser storage. Changes may be lost when you leave.');
    });
  }

  return { skills, ready, notice, update };
}

export type LocalSkills = ReturnType<typeof useLocalSkills>;
