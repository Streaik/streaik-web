import { GatewayError } from '@streaik/gateway';
import type { CatalogModel, Gateway } from '@streaik/gateway';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { pcmSpeechPlayback } from './speechPlayback';
import { readSpeechPreferences } from './speechPreferences';
import type { SpeechRoute } from './speechPreferences';
import { synthesizeSpeech } from './speechSynthesis';

export type MessageSpeechState = { id: string } & (
  { phase: 'generating' | 'playing' | 'blocked' } | { phase: 'error'; message: string }
);
export type ToggleMessageSpeech = (id: string, text: string) => Promise<void>;
type SpeechRun = { id: string; controller: AbortController; audio?: HTMLAudioElement; release?: () => void; blocked?: boolean };

export function useMessageSpeech(gateway: Gateway, model: CatalogModel | undefined, route: SpeechRoute, scope?: string) {
  const [state, setState] = useState<MessageSpeechState>();
  const current = useRef<SpeechRun>(undefined);
  const stop = useCallback(() => {
    const run = current.current;
    current.current = undefined;
    run?.controller.abort();
    run?.release?.();
  }, []);

  useLayoutEffect(() => {
    setState(undefined);
    return stop;
  }, [gateway, model?.id, route, scope, stop]);

  const toggle = useCallback<ToggleMessageSpeech>(async (id, text) => {
    if (!model || !text) return;
    const previous = current.current;
    const retry = previous?.id === id && previous.blocked ? previous : undefined;
    if (!retry) {
      stop();
      if (previous?.id === id) { setState(undefined); return; }
    }

    const run: SpeechRun = retry ?? { id, controller: new AbortController() };
    current.current = run;
    run.blocked = false;
    function finish(message?: string) {
      if (current.current !== run) return;
      stop();
      setState(message ? { id, phase: 'error', message } : undefined);
    }

    if (!run.audio) {
      setState({ id, phase: 'generating' });
      let clip: Blob;
      const live = route === 'websocket' ? pcmSpeechPlayback(() => {
        if (current.current === run) setState({ id, phase: 'playing' });
      }) : undefined;
      run.release = live?.close;
      try {
        ({ audio: clip } = await synthesizeSpeech(gateway, route, model, text, readSpeechPreferences(scope), run.controller.signal,
          { pcm: live?.append }));
        if (await live?.finish()) { finish(); return; }
      } catch (cause) {
        finish(cause instanceof GatewayError ? cause.message : 'Could not generate speech.');
        return;
      }
      if (current.current !== run) return;
      if (!clip.type.startsWith('audio/')) { finish('Could not play this message.'); return; }
      const audio = new Audio();
      const url = URL.createObjectURL(clip);
      const ended = () => finish();
      const failed = () => finish('Could not play this message.');
      run.audio = audio;
      run.release = () => {
        audio.removeEventListener('ended', ended);
        audio.removeEventListener('error', failed);
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        URL.revokeObjectURL(url);
      };
      audio.addEventListener('ended', ended);
      audio.addEventListener('error', failed);
      audio.src = url;
    }

    setState({ id, phase: 'playing' });
    try { await run.audio.play(); }
    catch (cause) {
      if (current.current !== run) return;
      if (cause instanceof DOMException && cause.name === 'NotAllowedError') {
        // A second, explicit click can play the already generated clip under autoplay restrictions.
        run.blocked = true;
        setState({ id, phase: 'blocked' });
      } else finish('Could not play this message.');
    }
  }, [gateway, model, route, scope, stop]);

  return { state, toggle: model ? toggle : undefined };
}
