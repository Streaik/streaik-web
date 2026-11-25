import { GatewayError, transcriptionUploadLimit } from '@streaik/gateway';
import { useLayoutEffect, useRef, useState } from 'react';
import { appendDictation, composerDictationRoute } from './composerDictation';
import type { ComposerDictation } from './composerDictation';
import { recordDictation } from './microphone';

type Phase = 'connecting' | 'capturing' | 'finishing';
type Take = { cancel: AbortController; finish: AbortController; phase: Phase };
type View = { phase?: Phase; preview?: string; error?: string };

export function useComposerDictation(config: ComposerDictation, blocked: boolean, commit: (text: string) => void) {
  const current = useRef<Take>(null);
  const latestCommit = useRef(commit);
  const [view, setView] = useState<View>({});
  const { gateway, model, mode } = config ?? {};

  useLayoutEffect(() => { latestCommit.current = commit; }, [commit]);
  useLayoutEffect(() => {
    setView(view => view.phase || view.error ? {} : view);
    return () => {
      const take = current.current;
      current.current = null;
      take?.cancel.abort();
    };
  }, [gateway, model, mode, blocked]);

  async function toggle() {
    const existing = current.current;
    if (existing) {
      if (existing.phase === 'connecting') {
        current.current = null;
        existing.cancel.abort();
        setView({});
      } else if (existing.phase === 'capturing') {
        existing.phase = 'finishing';
        setView(view => ({ ...view, phase: 'finishing' }));
        existing.finish.abort();
      }
      return;
    }
    if (!config || blocked) return;

    const take: Take = { cancel: new AbortController(), finish: new AbortController(), phase: 'connecting' };
    current.current = take;
    setView({ phase: 'connecting' });
    const signal = take.cancel.signal;
    const stop = take.finish.signal;
    const isCurrent = () => current.current === take && !signal.aborted;
    const ready = () => {
      if (!isCurrent()) return;
      take.phase = 'capturing';
      setView(view => ({ ...view, phase: 'capturing' }));
    };
    const preview = (text: string) => { if (isCurrent()) setView(view => ({ ...view, preview: text })); };
    let final = '', error = '';
    try {
      if (config.mode === 'realtime') {
        const { runMicrophone } = await import('./liveTranscription');
        signal.throwIfAborted();
        await runMicrophone(config.gateway, config.model, undefined, { signal, stop, ready,
          update(transcript, partial) {
            final = transcript.text;
            preview(appendDictation(final, partial));
          } });
      } else {
        const file = await recordDictation(signal, stop, transcriptionUploadLimit(composerDictationRoute), ready);
        signal.throwIfAborted();
        take.phase = 'finishing';
        setView({ phase: 'finishing' });
        final = (await config.gateway.transcribe(composerDictationRoute, config.model, file, {}, signal, preview)).text;
      }
    } catch (problem) {
      error = problem instanceof GatewayError ? problem.message : 'Could not complete dictation.';
    } finally {
      if (isCurrent()) {
        current.current = null;
        // Keep finalized realtime text, not an unfinished hypothesis or a failed file preview.
        if (final.trim()) latestCommit.current(final);
        setView({ error });
      }
    }
  }

  return { ...view, toggle, active: () => current.current !== null };
}
