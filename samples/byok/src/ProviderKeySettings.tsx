import { Button, Select } from '@streaik/themes';
import { providerDirectory, useAppTranslation } from '@streaik/chat';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { catalogKeyProviders, directKeyProviderIds } from './providerKeys.ts';

const names = catalogKeyProviders(providerDirectory.providers);
const catalogProviderIds = [...names.keys()];
const providerName = (id: string) => names.get(id) ?? id;
type KeyEditor = { mode: 'add'; id?: string } | { mode: 'replace'; id: string };

export function ProviderKeySettings({ gatewayConfigured, configured, vault, busy, notice, mcp, onChangeKey, onPassphrase, onLock, onErase }: {
  gatewayConfigured: boolean;
  configured: readonly string[];
  vault: 'session' | 'locked' | 'unlocked';
  busy: boolean;
  notice: string;
  mcp: boolean;
  onChangeKey: (id: string, value?: string) => Promise<boolean>;
  onPassphrase: (event: FormEvent<HTMLFormElement>) => void;
  onLock: () => void;
  onErase: () => Promise<boolean>;
}) {
  const id = useId();
  const { t, i18n } = useAppTranslation();
  const [editor, setEditor] = useState<KeyEditor>();
  const [setup, setSetup] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const picker = useRef<HTMLDivElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const passphrase = useRef<HTMLInputElement>(null);
  const alphabetical = new Intl.Collator(i18n.resolvedLanguage, { sensitivity: 'base' });
  const sorted = (ids: readonly string[]) => ids.map(value => ({ value, label: providerName(value) }))
    .sort((a, b) => alphabetical.compare(a.label, b.label) || alphabetical.compare(a.value, b.value));
  const available = sorted((gatewayConfigured ? catalogProviderIds : directKeyProviderIds).filter(provider => !configured.includes(provider)));
  const selectedId = editor?.id;

  useLayoutEffect(() => {
    if (selectedId) keyInput.current?.focus();
    else if (editor) picker.current?.querySelector('button')?.focus();
    else if (opener.current) {
      (opener.current.isConnected ? opener.current : heading.current)?.focus();
      opener.current = null;
    }
  }, [editor, selectedId]);

  useLayoutEffect(() => {
    if (setup) passphrase.current?.focus();
  }, [setup]);

  function edit(next: KeyEditor, button: HTMLButtonElement) {
    opener.current = button;
    setEditor(next);
  }

  function submitKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    const form = event.currentTarget;
    const value = String(new FormData(form).get('key') ?? '').trim();
    form.reset();
    void onChangeKey(selectedId, value).then((saved) => { if (saved) setEditor(undefined); });
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
        {sorted(configured).map(({ value: provider, label }) => <li className="byok-provider" key={provider}>
          <strong>{label}</strong>
          <div className="byok-actions">
            <Button variant="subtle" aria-label={t('Replace {{provider}} key', { provider: label })} disabled={busy}
              onClick={(event) => edit({ mode: 'replace', id: provider }, event.currentTarget)}>{t('Replace')}</Button>
            <Button variant="subtle" aria-label={t('Remove {{provider}} key', { provider: label })} disabled={busy || selectedId === provider}
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
        {editor.mode === 'add' && <div ref={picker} className="byok-key-form">
          <label htmlFor={`${id}-provider`}>{t('Provider')}</label>
          <Select id={`${id}-provider`} label={t('Provider')} disabled={busy} value={selectedId ?? ''} options={available}
            placeholder={t('Choose a provider')} search={{ label: t('Search providers'), placeholder: t('Search providers'), emptyMessage: t('No matching providers.') }}
            onValueChange={(provider) => setEditor({ mode: 'add', id: provider })} />
        </div>}
        {selectedId ? <form className="byok-key-form" onSubmit={submitKey} key={selectedId}>
          <label htmlFor={`${id}-key`}>{t('{{provider}} API key', { provider: providerName(selectedId) })}</label>
          <input ref={keyInput} className="ui-input" id={`${id}-key`} name="key" type="password" autoComplete="off"
            maxLength={4096} required disabled={busy} />
          <div className="byok-actions">
            <Button type="submit" variant="primary" disabled={busy}>{t('Save {{provider}} key', { provider: providerName(selectedId) })}</Button>
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
