import type { Transcript } from '@streaik/gateway';

export type SavedTranscript = { id: string; name: string; model: string; timestamp: number; transcript: Transcript; audio?: Blob };

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('streaik-transcriptions', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('transcripts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('transcripts', mode);
      const request = action(tx.objectStore('transcripts'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error('Transcript transaction aborted.'));
    });
  } finally { db.close(); }
}

export const listTranscripts = (scope: string): Promise<SavedTranscript[]> =>
  transaction('readonly', store => store.getAll(IDBKeyRange.bound([scope], [scope, []], false, true)));
export const saveTranscript = (scope: string, item: SavedTranscript) => transaction('readwrite', store => store.put(item, [scope, item.id]));
export const deleteTranscript = (scope: string, id: string) => transaction('readwrite', store => store.delete([scope, id]));
