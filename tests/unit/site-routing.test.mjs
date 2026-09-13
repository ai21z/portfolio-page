import assert from 'node:assert/strict';
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

test('passes public assets, clean page URLs, and the contact endpoint through', async () => {
  for (const pathname of ['/', '/index.html', '/js/app.js?v=1', '/styles/main.css',
    '/blog/codex/fail-fast-learn-faster', '/blog/codex/fail-fast-learn-faster.html',
    '/robots.txt', '/api/contact', '/404.html']) {
    const response = await onRequest(context(pathname));
    assert.equal(response.status, 200, pathname);
    assert.equal(await response.text(), 'public content');
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
