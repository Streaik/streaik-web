import { GatewayError } from '@streaik/gateway';
import type { Gateway, VideoRequest } from '@streaik/gateway';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listVideoJobs, saveVideoJob } from './videoLibrary';
import type { FinishedVideoJob, VideoJob } from './videoLibrary';

// Lives under the gateway/account history key, independent of the active chat
// or view. Leaving Videos does not lose a submission that is being accepted.
export function useVideoJobs(gateway: Gateway, scope: string | undefined, open: boolean) {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [loading, setLoading] = useState(!!scope);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState('');
  const [storageError, setStorageError] = useState('');
  const submitting = useRef<AbortController>(null);

  useEffect(() => {
    if (!scope || !open || !loading) return;
    let live = true;
    void listVideoJobs(scope).then(saved => {
      if (!live) return;
      setJobs(saved.sort((a, b) => b.startedAt - a.startedAt));
      setLoading(false);
    }, () => {
      if (!live) return;
      setStorageError('Could not load saved videos.');
      setLoading(false);
    });
    return () => { live = false; };
  }, [scope, open, loading]);

  useEffect(() => () => { submitting.current?.abort(); }, []);

  async function start(request: VideoRequest) {
    if (submitting.current || loading) return false;
    const controller = new AbortController();
    submitting.current = controller;
    setBusy(true);
    setStartError('');
    try {
      const operation = await gateway.startVideo(request, controller.signal);
      const job = { ...request, id: crypto.randomUUID(), status: 'pending' as const, operation, startedAt: Date.now() };
      if (scope) try { await saveVideoJob(scope, job); } catch {
        if (!controller.signal.aborted) setStorageError('Could not save the video job. It may not resume after reload.');
      }
      if (controller.signal.aborted) return false;
      setJobs(items => [job, ...items]);
      return true;
    } catch (error) {
      if (!controller.signal.aborted) setStartError(error instanceof GatewayError ? error.message : 'Could not start video generation.');
      return false;
    } finally {
      submitting.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const finish = useCallback(async (job: FinishedVideoJob) => {
    if (scope) try { await saveVideoJob(scope, job); } catch { setStorageError('Could not save the video result.'); }
    setJobs(items => items.map(item => item.id === job.id ? job : item));
  }, [scope]);

  return { jobs, loading, busy, start, finish, startError, storageError };
}
