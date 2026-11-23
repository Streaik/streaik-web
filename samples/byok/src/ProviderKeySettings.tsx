import { Button } from '@streaik/themes';
import { useAppTranslation } from '@streaik/chat';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { providerIds, providers } from './providerKeys.ts';
import type { ProviderId } from './providerKeys.ts';

type KeyEditor = { mode: 'add'; id?: ProviderId } | { mode: 'replace'; id: ProviderId };

export function ProviderKeySettings({ configured, vault, busy, notice, mcp, onChangeKey, onPassphrase, onLock, onErase }: {
  configured: ProviderId[];
  vault: 'session' | 'locked' | 'unlocked';
  busy: boolean;
  notice: string;
  mcp: boolean;
  onChangeKey: (id: ProviderId, value?: string) => Promise<boolean>;
  onPassphrase: (event: FormEvent<HTMLFormElement>) => void;
  onLock: () => void;
  onErase: () => Promise<boolean>;
}) {
  const id = useId();
  const { t } = useAppTranslation();
  const [editor, setEditor] = useState<KeyEditor>();
  const [setup, setSetup] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const picker = useRef<HTMLSelectElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const passphrase = useRef<HTMLInputElement>(null);
  const available = providerIds.filter((provider) => !configured.includes(provider));

  useLayoutEffect(() => {
    if (editor?.id) keyInput.current?.focus();
    else if (editor) picker.current?.focus();
    else if (opener.current) {
      (opener.current.isConnected ? opener.current : heading.current)?.focus();
      opener.current = null;
    }
  }, [editor]);

  useLayoutEffect(() => {
    if (setup) passphrase.current?.focus();
  }, [setup]);

  function edit(next: KeyEditor, button: HTMLButtonElement) {
    opener.current = button;
    setEditor(next);
  }

  function submitKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor?.id) return;
    const form = event.currentTarget;
    const value = String(new FormData(form).get('key') ?? '').trim();
    form.reset();
    void onChangeKey(editor.id, value).then((saved) => { if (saved) setEditor(undefined); });
  }

  function lock() {
    setEditor(undefined);
    setSetup(false);
    setConfirmErase(false);
    onLock();
  }

  return <section className="chat-settings-section byok-settings" aria-labelledby={`${id}-title`}>
    <h3 ref={heading} tabIndex={-1} id={`${id}-title`}>{t('Provider keys')}</h3>
    <p>{t('Gateway chat sends the selected provider’s key to the configured Streaik gateway. Direct chat sends it only to that provider.')}
      {mcp && <> {t('When MCP tools are enabled, the matching provider key also goes to the configured MCP host.')}</>}</p>
    {vault !== 'locked' && <>
      {configured.length ? <ul className="byok-providers" aria-label={t('Configured providers')}>
        {configured.map((provider) => <li className="byok-provider" key={provider}>
          <strong>{providers[provider].label}</strong>
          <div className="byok-actions">
            <Button variant="subtle" aria-label={t('Replace {{provider}} key', { provider: providers[provider].label })} disabled={busy}
              onClick={(event) => edit({ mode: 'replace', id: provider }, event.currentTarget)}>{t('Replace')}</Button>
            <Button variant="subtle" aria-label={t('Remove {{provider}} key', { provider: providers[provider].label })} disabled={busy || editor?.id === provider}
              onClick={() => { void onChangeKey(provider); }}>{t('Remove')}</Button>
          </div>
        </li>)}
      </ul> : <p className="byok-empty">{t('No API keys added yet. Add a key to use models from that provider.')}</p>}
      {available.length > 0 && <div><Button variant="primary" disabled={busy} aria-expanded={editor?.mode === 'add'}
        onClick={(event) => {
          if (editor?.mode === 'add') setEditor(undefined);
          else edit({ mode: 'add' }, event.currentTarget);
        }}>{t('Add API key')}</Button></div>}
      {editor && <div className="byok-editor">
        {editor.mode === 'add' && <div className="byok-key-form">
          <label htmlFor={`${id}-provider`}>{t('Provider')}</label>
          <select ref={picker} className="ui-input byok-provider-select" id={`${id}-provider`} disabled={busy} value={editor.id ?? ''}
            onChange={(event) => setEditor({ mode: 'add', id: available.find((provider) => provider === event.currentTarget.value) })}>
            <option value="" disabled>{t('Choose a provider')}</option>
            {available.map((provider) => <option key={provider} value={provider}>{providers[provider].label}</option>)}
          </select>
        </div>}
        {editor.id ? <form className="byok-key-form" onSubmit={submitKey} key={editor.id}>
          <label htmlFor={`${id}-key`}>{t('{{provider}} API key', { provider: providers[editor.id].label })}</label>
          <input ref={keyInput} className="ui-input" id={`${id}-key`} name="key" type="password" autoComplete="off"
            maxLength={4096} required disabled={busy} />
          <div className="byok-actions">
            <Button type="submit" variant="primary" disabled={busy}>{t('Save {{provider}} key', { provider: providers[editor.id].label })}</Button>
            <Button disabled={busy} onClick={() => setEditor(undefined)}>{t('Cancel')}</Button>
          </div>
        </form> : <div><Button disabled={busy} onClick={() => setEditor(undefined)}>{t('Cancel')}</Button></div>}
      </div>}
    </>}
    <section className="byok-storage" aria-labelledby={`${id}-storage`}>
      <div className="byok-storage-heading">
        <h4 id={`${id}-storage`}>{t('Encrypted storage')}</h4>
        <span className="byok-storage-state">{t(vault === 'session' ? 'Session only' : vault === 'locked' ? 'Locked' : 'On')}</span>
      </div>
      <p>{t(vault === 'session' ? 'Keys are session-only unless you create a vault. Choose a strong passphrase; there is no recovery.'
        : vault === 'locked' ? 'Unlock the vault to use or change saved keys.' : 'Keys are saved encrypted in this browser.')}</p>
      {vault === 'session' && !setup && <div><Button disabled={busy} onClick={() => setSetup(true)}>{t('Set up encrypted storage')}</Button></div>}
      {(vault === 'locked' || (vault === 'session' && setup)) && <form className="byok-key-form" onSubmit={onPassphrase} key={vault}>
        <label htmlFor={`${id}-passphrase`}>{t('Vault passphrase')}</label>
        <input ref={passphrase} className="ui-input" id={`${id}-passphrase`} type="password" name="passphrase" required maxLength={256}
          autoComplete={vault === 'session' ? 'new-password' : 'current-password'} disabled={busy} />
        {vault === 'session' && <>
          <label htmlFor={`${id}-confirm`}>{t('Confirm passphrase')}</label>
          <input className="ui-input" id={`${id}-confirm`} type="password" name="confirm" required maxLength={256} autoComplete="new-password" disabled={busy} />
        </>}
        <div className="byok-actions">
          <Button type="submit" disabled={busy}>{t(vault === 'session' ? 'Enable encrypted storage' : 'Unlock vault')}</Button>
          {vault === 'session' && <Button disabled={busy} onClick={() => setSetup(false)}>{t('Cancel setup')}</Button>}
        </div>
      </form>}
      {vault === 'unlocked' && <div><Button disabled={busy} onClick={lock}>{t('Lock vault')}</Button></div>}
      {vault !== 'session' && confirmErase && <p>{t('This permanently removes all keys saved in this vault.')}</p>}
      {vault !== 'session' && <div className="byok-actions">
        {confirmErase ? <><Button disabled={busy} onClick={() => {
          void onErase().then((erased) => { if (erased) { setEditor(undefined); setSetup(false); setConfirmErase(false); } });
        }}>{t('Confirm erase vault')}</Button>
          <Button onClick={() => setConfirmErase(false)} disabled={busy}>{t('Cancel erase')}</Button></>
          : <Button disabled={busy} onClick={() => setConfirmErase(true)}>{t('Erase vault')}</Button>}
      </div>}
    </section>
    <p className="byok-notice" role="status">{notice && t(notice)}</p>
  </section>;
}
