import type { VideoStatus } from '@streaik/gateway';

type JobDetails = { id: string; model: string; prompt: string; startedAt: number };
export type PendingVideoJob = JobDetails & { status: 'pending'; operation: string };
export type FinishedVideoJob = JobDetails & Exclude<VideoStatus, { status: 'pending' }>;
export type VideoJob = PendingVideoJob | FinishedVideoJob;

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('streaik-videos', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('jobs');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('jobs', mode);
      const request = action(tx.objectStore('jobs'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error('Video transaction aborted.'));
    });
  } finally { db.close(); }
}

export function listVideoJobs(scope: string): Promise<VideoJob[]> {
  return transaction('readonly', store => store.getAll(IDBKeyRange.bound([scope], [scope, []], false, true)));
}

// Replace the pending reference and its result in a single write.
export async function saveVideoJob(scope: string, job: VideoJob) {
  await transaction('readwrite', store => store.put(job, [scope, job.id]));
}
