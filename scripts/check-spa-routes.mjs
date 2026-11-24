import { conversationPath, pagePaths } from '../packages/chat/src/chatLocation.ts';

if (!process.argv[2]) throw new Error('Provide the site URL, including any app base path.');
const site = new URL(process.argv[2]);
if (!site.pathname.endsWith('/')) site.pathname += '/';

function request(path) {
  return fetch(new URL(path.replace(/^\//, ''), site), {
    redirect: 'manual', headers: { accept: 'text/html' }, signal: AbortSignal.timeout(15_000),
  });
}

function isAppDocument(response, html) {
  return response.headers.get('content-type')?.includes('text/html') && /\bid=["']root["']/.test(html);
}

for (const path of ['/', ...Object.values(pagePaths), conversationPath('00000000-0000-4000-8000-000000000001')]) {
  const response = await request(path);
  const ok = response.status === 200 && isAppDocument(response, await response.text());
  console.log(`${ok ? 'PASS' : 'FAIL'} ${response.status} ${response.url}`);
  if (!ok) process.exitCode = 1;
}

for (const path of ['/assets/__spa-rewrite-check__.js', '/api/__spa-rewrite-check__', '/auth-redirect.html']) {
  const response = await request(path);
  // The storage origin can return the app HTML as its error document; it is still not a successful rewrite.
  const ok = !response.ok || !isAppDocument(response, await response.text());
  console.log(`${ok ? 'PASS' : 'FAIL'} ${response.status} ${response.url} (not a successful SPA route)`);
  if (!ok) process.exitCode = 1;
}
