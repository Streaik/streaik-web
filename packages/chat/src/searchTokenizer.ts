export const wordPattern = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu;

export function normalizeWord(word: string) {
  return word.toLowerCase().normalize('NFD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC');
}

export function tokenize(text: string) {
  return Array.from(new Set((text.match(wordPattern) ?? []).map(normalizeWord)));
}

// Use the same Unicode word boundaries for indexing and querying mixed-language text.
export function createSearchTokenizer() {
  return { language: 'unicode', normalizationCache: new Map<string, string>(), tokenize };
}
