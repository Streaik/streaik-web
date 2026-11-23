import { providerIds, validProviderKey } from './providerKeys.ts';
import type { ProviderKeys } from './providerKeys.ts';

const encoder = new TextEncoder();
const iterations = 600_000;
const version = 1;
type Bytes = Uint8Array<ArrayBuffer>;
type Cipher = { salt: Bytes; key: CryptoKey };
const encode = (value: Bytes) => btoa(String.fromCharCode(...value));
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
  return JSON.stringify({ version, salt: encode(cipher.salt), iv: encode(iv), ciphertext: encode(new Uint8Array(encrypted)) });
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
  if (!raw || raw.length > 14_000 || passphrase.length > 256) throw new Error('Invalid vault.');
  const record = JSON.parse(raw);
  if (record?.version !== version || typeof record.salt !== 'string' || typeof record.iv !== 'string' ||
      typeof record.ciphertext !== 'string') throw new Error('Invalid vault.');
  const salt = decode(record.salt), iv = decode(record.iv), ciphertext = decode(record.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw new Error('Invalid vault.');
  const cipher = await derive(passphrase, salt);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: associatedData(scope) }, cipher.key, ciphertext);
  const decoded: unknown = JSON.parse(new TextDecoder().decode(plaintext));
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('Invalid vault.');
  const keys: ProviderKeys = {};
  for (const [id, key] of Object.entries(decoded)) {
    const provider = providerIds.find((value) => value === id);
    if (!provider || typeof key !== 'string' || !validProviderKey(key)) throw new Error('Invalid vault.');
    keys[provider] = key;
  }
  return { keys, encrypt: encryptWith(cipher, scope) };
}
