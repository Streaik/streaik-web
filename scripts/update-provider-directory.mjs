import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// The committed snapshot makes web builds independent of the sibling checkout.
// Regenerate deliberately from the desired revision of streaik-catalog.
const source = new URL('../../streaik-catalog/metadata/', import.meta.url);
const output = new URL('../packages/chat/src/provider-directory.json', import.meta.url);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const read = (file) => readFileSync(new URL(file, source), 'utf8').replace(/\r\n/g, '\n');
const manifest = read('index.json');
const files = new Map(JSON.parse(manifest).files.map(({ file, sha256 }) => [file, sha256]));

function verified(file) {
  const content = read(file);
  if (sha256(content) !== files.get(file)) throw new Error(`Catalog manifest does not match ${file}.`);
  return JSON.parse(content);
}

function tokenPricing(id) {
  const file = `pricing/providers/${id}.json`;
  if (!files.has(file)) return;
  const rate = (value) => typeof value === 'string' && value.trim() ? Number(value) : value;
  return Object.fromEntries(Object.entries(verified(file)).flatMap(([model, { pricing }]) => {
    const input = rate(pricing?.input), output = rate(pricing?.output);
    const valid = (value) => Number.isFinite(value) && value >= 0;
    if (!model.startsWith(`${id}/`) || !valid(input) || !valid(output)) return [];
    const cacheRead = rate(pricing.input_cache_read), cacheWrite = rate(pricing.input_cache_write);
    return [[model, { input, output, ...(valid(cacheRead) && { cacheRead }), ...(valid(cacheWrite) && { cacheWrite }) }]];
  }));
}

const ids = new Set();
const browserChatEndpoints = new Set(['/v1/chat/completions', '/v1/responses', '/v1/messages']);
const providers = verified('providers/index.json').map(({ id, file }) => {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id) || ids.has(id) || !/^[a-z0-9][a-z0-9_-]*\.json$/.test(file)) {
    throw new Error(`Invalid catalog entry: ${id}`);
  }
  ids.add(id);
  const { name, description, category, providerCountry, inferenceRegions, urls, apiBaseUrl, chatEndpoints } = verified(`providers/${file}`);
  const endpoints = [...new Set((chatEndpoints ?? []).filter(endpoint => browserChatEndpoints.has(endpoint)))];
  let direct;
  // A display record can list supported protocols without a direct API URL.
  if (endpoints.length && apiBaseUrl) {
    const api = new URL(apiBaseUrl);
    if (api.protocol !== 'https:' || api.username || api.password || api.search || api.hash) throw new Error(`Invalid direct API for ${id}.`);
    direct = { apiBaseUrl: api.href.replace(/\/+$/, ''), chatEndpoints: endpoints, tokenPricing: tokenPricing(id) };
  }
  return { id, name, description, category, country: providerCountry, regions: inferenceRegions, urls, ...direct };
});
const snapshot = JSON.stringify({ sourceManifestSha256: sha256(manifest), providers }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (snapshot !== readFileSync(output, 'utf8').replace(/\r\n/g, '\n')) throw new Error('The provider directory snapshot is out of date.');
} else {
  writeFileSync(output, snapshot);
}
