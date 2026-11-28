import { validProviderId, validProviderKey } from './providerKeys.ts';
import type { ProviderKeys } from './providerKeys.ts';

const encoder = new TextEncoder();
const iterations = 600_000;
const version = 1;
const maxVaultLength = 2_000_000;
type Bytes = Uint8Array<ArrayBuffer>;
type Cipher = { salt: Bytes; key: CryptoKey };
function encode(value: Bytes) {
  let binary = '';
  for (let start = 0; start < value.length; start += 0x8000) binary += String.fromCharCode(...value.subarray(start, start + 0x8000));
  return btoa(binary);
}
const decode = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const associatedData = (scope: string) => encoder.encode(`streaik/provider-keys/${version}\n${scope}`);

async function derive(passphrase: string, salt: Bytes): Promise<Cipher> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations, salt }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { salt, key };
}

async function seal(cipher: Cipher, keys: ProviderKeys, scope: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: associatedData(scope) },
    cipher.key, encoder.encode(JSON.stringify(keys)));
  const raw = JSON.stringify({ version, salt: encode(cipher.salt), iv: encode(iv), ciphertext: encode(new Uint8Array(encrypted)) });
  if (raw.length > maxVaultLength) throw new Error('Vault is too large.');
  return raw;
}

function encryptWith(cipher: Cipher, scope: string) {
  return (keys: ProviderKeys) => seal(cipher, keys, scope);
}

export async function createVault(passphrase: string, scope: string) {
  if (passphrase.length < 12 || passphrase.length > 256) throw new Error('Use a passphrase of 12–256 characters.');
  return encryptWith(await derive(passphrase, crypto.getRandomValues(new Uint8Array(16))), scope);
}

export async function unlockVault(raw: string, passphrase: string, scope: string) {
  // Refuse malformed or unexpectedly large values before deriving a key.
  if (!raw || raw.length > maxVaultLength || passphrase.length > 256) throw new Error('Invalid vault.');
  const record = JSON.parse(raw);
  if (record?.version !== version || typeof record.salt !== 'string' || typeof record.iv !== 'string' ||
      typeof record.ciphertext !== 'string') throw new Error('Invalid vault.');
  const salt = decode(record.salt), iv = decode(record.iv), ciphertext = decode(record.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw new Error('Invalid vault.');
  const cipher = await derive(passphrase, salt);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: associatedData(scope) }, cipher.key, ciphertext);
  const decoded: unknown = JSON.parse(new TextDecoder().decode(plaintext));
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('Invalid vault.');
  const entries = Object.entries(decoded);
  for (const [id, key] of entries) {
    if (!validProviderId(id) || typeof key !== 'string' || !validProviderKey(key)) throw new Error('Invalid vault.');
  }
  return { keys: Object.fromEntries<string>(entries), encrypt: encryptWith(cipher, scope) };
}
