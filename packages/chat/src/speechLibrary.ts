import type { SpeechResponse } from '@streaik/gateway';

export type SavedSpeech = Pick<SpeechResponse, 'audio' | 'model' | 'timestamp' | 'format'> & { id: string; title: string };

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('streaik-speech', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('clips');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('clips', mode);
      const request = action(tx.objectStore('clips'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error('Speech transaction aborted.'));
    });
  } finally { db.close(); }
}

export const listSpeech = (scope: string): Promise<SavedSpeech[]> =>
  transaction('readonly', store => store.getAll(IDBKeyRange.bound([scope], [scope, []], false, true)));
export const saveSpeech = (scope: string, item: SavedSpeech) => transaction('readwrite', store => store.put(item, [scope, item.id]));
export const deleteSpeech = (scope: string, id: string) => transaction('readwrite', store => store.delete([scope, id]));

const extensions: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg',
  'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/webm': 'webm', 'application/zip': 'zip' };
export function speechFilename({ title, audio, format }: SavedSpeech) {
  const name = title.replace(/[\u0000-\u001F<>:"/\\|?*]/g, ' ').trim().replace(/[. ]+$/, '') || 'Speech';
  const extension = extensions[audio.type] ?? (format && /^[a-z0-9]{1,10}$/i.test(format) ? format.toLowerCase() : 'bin');
  return `${name}.${extension}`;
}
