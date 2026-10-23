import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { onRequest } from '../../functions/_middleware.js';

function context(pathname, { method = 'GET', host = 'zounarakis.com' } = {}) {
  return {
    request: new Request(`https://${host}${pathname}`, { method }),
    next: () => new Response('public content'),
    env: {
      ASSETS: {
        fetch: async url => {
          assert.equal(url.pathname, '/404.html');
          return new Response('Not found', { headers: { 'Content-Type': 'text/html' } });
        }
      }
    }
  };
}

test('redirects www while preserving paths, queries, and POST requests', async () => {
  for (const [method, status] of [['GET', 301], ['HEAD', 301], ['POST', 308]]) {
    const ctx = context('/api/contact?source=site&return=%2Fwork', { method, host: 'www.zounarakis.com' });
    ctx.next = () => { throw new Error('Redirect must not reach the contact endpoint'); };
    const response = await onRequest(ctx);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('location'), 'https://zounarakis.com/api/contact?source=site&return=%2Fwork');
  }
});

test('sends blog URLs to their one address, keeping the query', async () => {
  const cases = [
    ['/blog', 'https://zounarakis.com/#blog'],
    ['/blog/', 'https://zounarakis.com/#blog'],
    ['/blog/?ref=card', 'https://zounarakis.com/?ref=card#blog'],
    ['/blog/codex/fail-fast-learn-faster/', 'https://zounarakis.com/blog/codex/fail-fast-learn-faster'],
    ['/blog/cosmos/first-year-software-engineer/?utm=x', 'https://zounarakis.com/blog/cosmos/first-year-software-engineer?utm=x'],
    ['/blog/cosmos/first-year-software-%65ngineer/', 'https://zounarakis.com/blog/cosmos/first-year-software-%65ngineer']
  ];
  for (const [method, status] of [['GET', 301], ['HEAD', 301], ['POST', 308]]) {
    for (const [pathname, location] of cases) {
      const ctx = context(pathname, { method });
      ctx.next = () => { throw new Error('A redirect must not serve content'); };
      const response = await onRequest(ctx);
      assert.equal(response.status, status, `${method} ${pathname}`);
      assert.equal(response.headers.get('location'), location, pathname);
    }
  }
  // Unknown articles and the hub paths are not invented.
  for (const pathname of ['/blog/codex/not-a-post/', '/blog/codex/', '/blogs/', '/blog/codex/fail-fast-learn-faster%2F']) {
    const response = await onRequest(context(pathname));
    assert.equal(response.status, 404, pathname);
  }
});

test('passes public assets, clean page URLs, and the contact endpoint through', async () => {
  for (const pathname of ['/', '/index.html', '/js/app.js?v=1', '/styles/main.css',
    '/blog/codex/fail-fast-learn-faster', '/blog/codex/fail-fast-learn-faster.html',
    '/robots.txt', '/api/contact', '/404.html']) {
    const response = await onRequest(context(pathname));
    assert.equal(response.status, 200, pathname);
    assert.equal(await response.text(), 'public content');
  }
});

test('caches a file as immutable only when its token matches the bytes served', async () => {
  const body = 'export const answer = 42;\n';
  const current = createHash('sha256').update(body).digest('hex').slice(0, 12);
  const serve = (pathname, method = 'GET') => {
    const ctx = context(pathname, { method });
    ctx.next = () => new Response(method === 'HEAD' ? null : body, { headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=0, must-revalidate' } });
    return onRequest(ctx);
  };
  const fresh = await serve(`/js/app.js?v=${current}`);
  assert.equal(fresh.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(fresh.headers.get('content-type'), 'text/javascript');
  assert.equal(await fresh.text(), body);
  // An old token (a tab open across a deploy), a malformed one, and a module without one must
  // revalidate. Said explicitly, since the zone's browser cache TTL lifts the default max-age=0 to 4 h.
  for (const pathname of ['/js/app.js?v=0123456789ab', '/js/app.js?v=1', '/js/app.js', '/styles/main.css', '/icons/favicon-32.png?v=0123456789ab']) {
    const response = await serve(pathname);
    assert.equal(response.headers.get('cache-control'), 'no-cache', pathname);
    assert.equal(await response.text(), body, pathname);
  }
  // A versioned request reaches the assets without conditional headers, so it is always a whole
  // 200 that can be hashed. A 304 would carry the zone's TTL onto bytes the browser already holds.
  let forwarded;
  const conditional = context(`/js/app.js?v=0123456789ab`);
  conditional.request = new Request(conditional.request, { headers: { 'If-None-Match': '"b-etag"', 'If-Modified-Since': 'Mon, 01 Jan 2024 00:00:00 GMT', Range: 'bytes=0-9' } });
  conditional.next = (input) => { forwarded = input; return new Response(body); };
  assert.equal((await onRequest(conditional)).headers.get('cache-control'), 'no-cache');
  assert.ok(forwarded, 'the versioned request must be forwarded explicitly');
  for (const name of ['if-none-match', 'if-modified-since', 'range']) assert.equal(forwarded.headers.get(name), null, name);
  // A module or stylesheet revalidated without a token gets no-cache on its 304 too.
  const notModified = context('/js/app.js');
  notModified.next = () => new Response(null, { status: 304, headers: { 'Cache-Control': 'public, max-age=14400, must-revalidate' } });
  const reply = await onRequest(notModified);
  assert.equal(reply.status, 304);
  assert.equal(reply.headers.get('cache-control'), 'no-cache');
  // HEAD, HTML and unversioned images keep what Pages sends.
  for (const [pathname, method] of [[`/js/app.js?v=${current}`, 'HEAD'], [`/404.html?v=${current}`, 'GET'], ['/icons/favicon-32.png', 'GET']]) {
    const response = await serve(pathname, method);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=0, must-revalidate', `${method} ${pathname}`);
  }
});

test('blocks private paths even if an older cached asset exists', async () => {
  for (const pathname of ['/.claude/launch.json', '/%2eclaude/launch.json',
    '/docs/local/BLOG-GUIDE.md', '/tests/contact-form.spec.ts', '/package.json',
    '/artifacts/browser-audit-report.json', '/functions/api/contact.js', '/_headers',
    '/unlisted.js', '/scripts/public-files.json']) {
    const ctx = context(pathname);
    ctx.next = () => new Response('private cached content');
    const response = await onRequest(ctx);
    assert.equal(response.status, 404, pathname);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), 'Not found');
  }
});

test('handles HEAD and malformed paths without leaking assets', async () => {
  const head = await onRequest(context('/package.json', { method: 'HEAD' }));
  assert.equal(head.status, 404);
  assert.equal(await head.text(), '');
  const invalid = await onRequest(context('/%zz'));
  assert.equal(invalid.status, 400);
});
