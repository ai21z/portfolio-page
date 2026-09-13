import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Response } from 'miniflare';
import { createPagesRuntime } from '../helpers/pages-runtime.mjs';

test('compiled Pages middleware, assets and contact work together with isolated providers', { timeout: 90000 }, async () => {
  const emails = [];
  const provider = new Map();
  const verifications = [];
  const server = await createPagesRuntime({
    bindings: {
      TURNSTILE_SECRET_KEY: 'synthetic-secret', RESEND_API_KEY: 'synthetic-key',
      CONTACT_FROM_EMAIL: 'contact@example.test', CONTACT_TARGET_EMAIL: 'recipient@example.test'
    },
    outbound: async request => {
      if (request.url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
        verifications.push(new URLSearchParams(await request.text()));
        return Response.json({ success: true, action: 'contact_form', hostname: 'zounarakis.com' });
      }
      if (request.url === 'https://api.resend.com/emails') {
        const body = await request.text();
        const key = request.headers.get('idempotency-key');
        emails.push({ body, key });
        if (provider.has(key) && provider.get(key) !== body) {
          return Response.json({ name: 'invalid_idempotent_request' }, { status: 409 });
        }
        provider.set(key, body);
        return Response.json({ id: 'synthetic-accepted' });
      }
    }
  });
  try {
    const fetch = (pathname, init = {}) => server.runtime.dispatchFetch('https://zounarakis.com' + pathname, init);
    const home = await fetch('/');
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('cache-control'), 'no-cache');
    assert.equal(home.headers.get('x-frame-options'), 'DENY');
    assert.ok(home.headers.get('content-security-policy-report-only') || home.headers.get('content-security-policy'));
    assert.match(await home.text(), /Aris Zounarakis/);
    const robots = await fetch('/robots.txt');
    assert.match(robots.headers.get('content-type'), /text\/plain/);
    assert.equal(robots.headers.get('cache-control'), 'public, max-age=3600');
    for (const pathname of ['/package.json', '/docs/CONTACT-CONTRACT.md', '/functions/api/contact.js', '/tests/contact-form.spec.ts']) {
      const response = await fetch(pathname);
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    const article = await fetch('/blog/codex/fail-fast-learn-faster');
    assert.equal(article.status, 200);
    assert.equal(article.headers.get('cache-control'), 'no-cache');
    for (const method of ['GET', 'POST']) {
      const response = await server.runtime.dispatchFetch('https://www.zounarakis.com/path?q=test', { method, redirect: 'manual' });
      assert.equal(response.status, method === 'GET' ? 301 : 308);
      assert.equal(response.headers.get('location'), 'https://zounarakis.com/path?q=test');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    }
    const invalid = await fetch('/api/contact', { method: 'POST', body: '{' });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    const payload = {
      name: 'Fixture Visitor', email: 'visitor@example.test', subject: 'Local Pages check',
      message: 'Synthetic message with no real recipient.', turnstileToken: 'synthetic-token',
      submissionId: crypto.randomUUID(), submissionCreatedAt: Date.now()
    };
    const accepted = await fetch('/api/contact', {
      method: 'POST', body: JSON.stringify(payload),
      headers: { 'cf-connecting-ip': '192.0.2.1', 'user-agent': 'Original Browser' }
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { success: true, state: 'accepted' });
    assert.equal(accepted.headers.get('cache-control'), 'no-store');
    const retry = await fetch('/api/contact', {
      method: 'POST', body: JSON.stringify({ ...payload, turnstileToken: 'renewed-token' }),
      headers: { 'cf-connecting-ip': '2001:db8::1', 'user-agent': 'Updated Browser' }
    });
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), { success: true, state: 'accepted' });
    assert.deepEqual(JSON.parse(emails[0].body).to, ['recipient@example.test']);
    assert.equal(emails.length, 2);
    assert.deepEqual(emails[0], emails[1]);
    assert.ok(emails[0].key.startsWith('contact/' + payload.submissionId + '/'));
    assert.equal(provider.size, 1);
    assert.deepEqual(verifications.map(body => body.get('remoteip')), ['192.0.2.1', '2001:db8::1']);
    assert.deepEqual(verifications.map(body => body.get('response')), ['synthetic-token', 'renewed-token']);
    for (const value of ['192.0.2.1', '2001:db8::1', 'Original Browser', 'Updated Browser', 'synthetic-token', 'renewed-token']) {
      assert.ok(!emails[0].body.includes(value));
    }
    assert.deepEqual(server.unexpected, []);
  } finally {
    await server.close();
  }
});
