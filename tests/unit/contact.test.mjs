import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onRequest, onRequestPost } from '../../functions/api/contact.js';

const env = {
  TURNSTILE_SECRET_KEY: 'test-secret',
  RESEND_API_KEY: 're_test',
  CONTACT_FROM_EMAIL: 'Portfolio <contact@example.test>',
  CONTACT_TARGET_EMAIL: 'aris@example.test'
};

const payload = {
  name: 'Test Visitor',
  email: 'visitor@example.test',
  subject: 'Contact regression test',
  message: 'A message that must not leave this test.',
  turnstileToken: 'test-token'
};

function request(body = payload, url = 'https://zounarakis.com/api/contact') {
  return new Request(url, { method: 'POST', body: JSON.stringify(body) });
}

function mockServices(t, emailResponse, { verified = true } = {}) {
  const emails = [];
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'info', () => {});
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = String(input);
    if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      return Response.json({ success: verified });
    }
    if (url === 'https://api.resend.com/emails') {
      emails.push(JSON.parse(init.body));
      if (emailResponse instanceof Error) throw emailResponse;
      return emailResponse;
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  return emails;
}

test('reports success only after the provider accepts the email', async (t) => {
  const emails = mockServices(t, Response.json({ id: 'accepted-email' }));
  const response = await onRequestPost({ request: request(), env });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(emails.length, 1);
  assert.deepEqual(emails[0].to, ['aris@example.test']);
  assert.equal(emails[0].reply_to, payload.email);
});

for (const status of [401, 403, 422, 429, 500]) {
  test(`returns 502 when the provider rejects the email with ${status}`, async (t) => {
    const emails = mockServices(t, Response.json({
      name: 'validation_error', message: 'Private provider diagnostic'
    }, { status }));
    const response = await onRequestPost({ request: request(), env });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: 'Failed to deliver message. Please try again later.'
    });
    assert.equal(emails.length, 1);
  });
}

for (const body of [{}, { id: null }, { id: '' }]) {
  test(`rejects an unconfirmed provider response ${JSON.stringify(body)}`, async (t) => {
    mockServices(t, Response.json(body));
    const response = await onRequestPost({ request: request(), env });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).success, undefined);
  });
}

test('returns 502 on a provider network failure', async (t) => {
  mockServices(t, new Error('Network unavailable'));
  const response = await onRequestPost({ request: request(), env });
  assert.equal(response.status, 502);
});

test('does not send mail when verification fails', async (t) => {
  const emails = mockServices(t, undefined, { verified: false });
  const response = await onRequestPost({ request: request(), env });
  assert.equal(response.status, 401);
  assert.equal(emails.length, 0);
});

test('silently discards a filled honeypot', async (t) => {
  const emails = mockServices(t);
  const response = await onRequestPost({ request: request({ ...payload, honeypot: 'bot' }), env });
  assert.equal(response.status, 200);
  assert.equal(emails.length, 0);
  assert.equal(fetch.mock.callCount(), 0);
});

test('rejects unsupported methods on the canonical host', async () => {
  const response = await onRequest({ request: new Request('https://zounarakis.com/api/contact'), env });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
});
