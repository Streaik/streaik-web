import type { ImageResponse } from '@streaik/gateway';

// Match AIHappey's stored ImageItem. Scope lives in the key, not the record.
export type ImageItem = { id: string; imageResponse: ImageResponse };

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('streaik-images', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('images', mode);
      const request = action(tx.objectStore('images'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error('Image transaction aborted.'));
    });
  } finally { db.close(); }
}

export function listImages(scope: string): Promise<ImageItem[]> {
  return transaction('readonly', store => store.getAll(IDBKeyRange.bound([scope], [scope, []], false, true)));
}

export async function saveImage(scope: string, item: ImageItem) {
  await transaction('readwrite', store => store.put(item, [scope, item.id]));
}
