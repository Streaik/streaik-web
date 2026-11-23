import type { ChatMessage } from '@streaik/gateway';
import { convertedAttachmentName } from './chatAttachments.ts';

// AI Happey UI conversation shape. The scope is an IndexedDB key, not part of the conversation.
export type Conversation = {
  id: string;
  messages: ChatMessage[];
  metadata?: { name?: string; updatedAt?: string; model?: string; pinned?: boolean; [key: string]: unknown };
};

export function newConversation(): Conversation {
  return { id: crypto.randomUUID(), messages: [] };
}

function openingParts(conversation: Conversation) {
  return conversation.messages.find((message) => message.role === 'user')?.parts ?? [];
}

export function conversationOpeningText(conversation: Conversation) {
  return openingParts(conversation).flatMap(part => part.type === 'text' && !convertedAttachmentName(part) ? [part.text] : [])
    .join(' ').trim().replace(/\s+/g, ' ');
}

export function conversationTitle(conversation: Conversation, fallback = 'Conversation') {
  const name = conversation.metadata?.name;
  const title = (typeof name === 'string' && name.trim()) || conversationOpeningText(conversation)
    || openingParts(conversation).map(part => part.type === 'file' ? part.filename : convertedAttachmentName(part)).find(Boolean);
  return title ? [...title].slice(0, 60).join('') : fallback;
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('streaik-conversations', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('conversations'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('conversations', mode);
      const request = action(tx.objectStore('conversations'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error('Conversation transaction aborted.'));
    });
  } finally { db.close(); }
}

export function listConversations(scope: string): Promise<Conversation[]> {
  return transaction('readonly', (store) => store.getAll(IDBKeyRange.bound([scope], [scope, []], false, true)));
}

export async function saveConversation(scope: string, conversation: Conversation) {
  await transaction('readwrite', (store) => store.put(conversation, [scope, conversation.id]));
}

export async function deleteConversation(scope: string, id: string) {
  await transaction('readwrite', (store) => store.delete([scope, id]));
}

export function newestFirst(a: Conversation, b: Conversation) {
  return (b.metadata?.updatedAt ?? '').localeCompare(a.metadata?.updatedAt ?? '');
}
