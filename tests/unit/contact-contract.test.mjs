import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContactHandler, onRequest, onRequestPost } from '../../functions/api/contact.js';
import { ContactAttempt, RETRY_LIFETIME } from '../../js/contact-attempt.js';

const env = {
  TURNSTILE_SECRET_KEY: 'test-secret',
  RESEND_API_KEY: 're_test',
  CONTACT_FROM_EMAIL: 'Portfolio <contact@example.test>',
  CONTACT_TARGET_EMAIL: 'aris@example.test'
};
const payload = {
  name: 'Test Visitor', email: 'visitor@example.test', subject: 'Contact regression test',
  message: 'A message that must not leave this test.', turnstileToken: 'test-token',
  submissionId: '3aefed3d-862d-446b-876f-bc2b35b690cc', submissionCreatedAt: Date.now()
};
const verification = { success: true, hostname: 'zounarakis.com', action: 'contact_form' };
const budget = { total: 200, body: 25, rate: 25, verification: 25, provider: 25 };

function request(body = payload, headers = {}) {
  return new Request('https://zounarakis.com/api/contact', {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers
  });
}

function services(t, { verify = () => Response.json(verification), send = () => Response.json({ id: 'accepted' }) } = {}) {
  const emails = [];
  const logs = [];
  t.mock.method(console, 'warn', value => logs.push(JSON.parse(value)));
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (String(input) === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') return verify(init);
    if (String(input) === 'https://api.resend.com/emails') {
      emails.push({ body: JSON.parse(init.body), key: init.headers['Idempotency-Key'] });
      return send(init);
    }
    throw new Error('Unexpected outbound request');
  });
  return { emails, logs };
}

function stall(signal) {
  return new Promise((_, reject) => {
    signal.throwIfAborted();
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

test('acceptance requires a provider ID and keeps routing and safe headers', async t => {
  const { emails } = services(t);
  const response = await onRequestPost({ request: request(), env });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, state: 'accepted' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('x-request-id'), /^[\da-f-]{36}$/);
  assert.deepEqual(emails[0].body.to, ['aris@example.test']);
  assert.equal(emails[0].body.reply_to, payload.email);
  assert.ok(!emails[0].key.includes(payload.email));
});

for (const status of [401, 403, 422, 429, 500]) {
  test('classifies provider ' + status + ' without exposing its diagnostic', async t => {
    const { logs } = services(t, { send: () => Response.json({ name: 'validation_error', message: 'private detail' }, { status }) });
    const response = await onRequestPost({ request: request(), env });
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.equal(result.state, status < 500 ? 'rejected' : 'unknown');
    assert.ok(!JSON.stringify([result, logs]).includes('private detail'));
  });
}

for (const body of [{}, { id: null }, { id: '' }, { error: 'unconfirmed' }]) {
  test('does not turn malformed acceptance ' + JSON.stringify(body) + ' into success', async t => {
    services(t, { send: () => Response.json(body) });
    const response = await onRequestPost({ request: request(), env });
    assert.equal((await response.json()).state, 'unknown');
  });
}

for (const result of [
  { success: false, 'error-codes': ['timeout-or-duplicate'] },
  { ...verification, hostname: 'attacker.test' },
  { ...verification, action: 'another_form' },
  { success: true }
]) {
  test('rejects wrong or expired verification ' + JSON.stringify(result), async t => {
    const { emails } = services(t, { verify: () => Response.json(result) });
    const response = await onRequestPost({ request: request(), env });
    assert.equal(response.status, 401);
    assert.equal(emails.length, 0);
  });
}

test('uses trusted configured hosts, never a caller supplied host', async t => {
  const { emails } = services(t, { verify: () => Response.json({ ...verification, hostname: 'preview.example.test' }) });
  assert.equal((await onRequestPost({ request: request(payload, { host: 'preview.example.test' }), env })).status, 401);
  assert.equal((await onRequestPost({ request: request(), env: { ...env, CONTACT_ALLOWED_HOSTNAMES: 'preview.example.test' } })).status, 200);
  assert.equal(emails.length, 1);
});

test('preserves escaping, line sanitation and message limits', async t => {
  const { emails } = services(t);
  assert.equal((await onRequestPost({ request: request({ ...payload, name: '<script>Visitor</script>', message: 'Hello <img src=x>\r\nnext line' }), env })).status, 200);
  assert.match(emails[0].body.html, /&lt;script&gt;/);
  assert.ok(!emails[0].body.html.includes('<img'));
  assert.ok(emails[0].body.text.includes('\nnext line'));
  assert.equal((await onRequestPost({ request: request({ ...payload, message: 'a'.repeat(351) }), env })).status, 422);
});

test('honeypot and unsupported methods never reach a provider', async t => {
  const { emails } = services(t);
  assert.equal((await onRequestPost({ request: request({ ...payload, honeypot: 'bot' }), env })).status, 200);
  const response = await onRequest({ request: new Request('https://zounarakis.com/api/contact'), env });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(emails.length, 0);
});

for (const headers of [{}, { 'content-length': '1' }, { 'content-length': 'invalid' }]) {
  test('counts streamed bytes with ' + JSON.stringify(headers), async t => {
    const { emails } = services(t);
    const response = await onRequestPost({ request: request(JSON.stringify({ pad: '\u20ac'.repeat(6000) }), headers), env });
    assert.equal(response.status, 413);
    assert.equal(emails.length, 0);
  });
}

test('cancels an oversized chunked request without consuming the rest', async t => {
  services(t);
  let canceled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(16385)); },
    cancel() { canceled = true; }
  });
  const response = await onRequestPost({
    request: new Request('https://zounarakis.com/api/contact', { method: 'POST', body, duplex: 'half' }), env
  });
  assert.equal(response.status, 413);
  assert.equal(canceled, true);
});

test('rejects truncated JSON and malformed UTF-8 without external calls', async t => {
  services(t);
  for (const body of ['{"name":', new Uint8Array([0xc3, 0x28])]) {
    const response = await onRequestPost({
      request: new Request('https://zounarakis.com/api/contact', { method: 'POST', body }), env
    });
    assert.equal(response.status, 400);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('cancels a stalled request body within its budget', async t => {
  services(t);
  let canceled = false;
  const body = new ReadableStream({ cancel() { canceled = true; } });
  const response = await createContactHandler({ budget })({
    request: new Request('https://zounarakis.com/api/contact', { method: 'POST', body, duplex: 'half' }), env
  });
  assert.equal(response.status, 408);
  assert.equal(canceled, true);
});

for (const phase of ['verification', 'provider']) {
  test('aborts a stalled ' + phase + ' request', async t => {
    let aborted = false;
    const stuck = async init => {
      try { return await stall(init.signal); } finally { aborted = init.signal.aborted; }
    };
    services(t, phase === 'verification' ? { verify: stuck } : { send: stuck });
    const response = await createContactHandler({ budget })({ request: request(), env });
    assert.equal(response.status, phase === 'verification' ? 503 : 504);
    assert.equal((await response.json()).state, phase === 'verification' ? 'not_sent' : 'unknown');
    assert.equal(aborted, true);
  });
  test('bounds stalled ' + phase + ' response body reads', async t => {
    let canceled = false;
    const response = () => new Response(new ReadableStream({ cancel() { canceled = true; } }));
    services(t, phase === 'verification' ? { verify: response } : { send: response });
    const result = await createContactHandler({ budget })({ request: request(), env });
    assert.equal(result.status, phase === 'verification' ? 503 : 504);
    assert.equal(canceled, true);
  });
}

test('a lost-response retry recovers after network, browser and verification changes', async t => {
  let accepted = 0;
  const provider = new Map();
  const { emails } = services(t, { send: init => {
    const key = init.headers['Idempotency-Key'];
    if (!provider.has(key)) {
      provider.set(key, init.body);
      accepted++;
      throw new Error('Response lost after acceptance');
    }
    assert.equal(provider.get(key), init.body);
    return Response.json({ id: 'already-accepted' });
  } });
  const first = await onRequestPost({
    request: request(payload, { 'cf-connecting-ip': '192.0.2.1', 'user-agent': 'Original Browser' }), env
  });
  assert.equal((await first.json()).state, 'unknown');
  const retry = await onRequestPost({
    request: request({ ...payload, turnstileToken: 'renewed' }, {
      'cf-connecting-ip': '2001:db8::1', 'user-agent': 'Updated Browser'
    }), env
  });
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), { success: true, state: 'accepted' });
  assert.equal(accepted, 1);
  assert.equal(emails[0].key, emails[1].key);
  assert.deepEqual(emails[0].body, emails[1].body);
});

test('changed content is distinct while request metadata changes replay the original', async t => {
  const provider = new Map();
  let accepted = 0;
  const { emails } = services(t, { send: init => {
    const key = init.headers['Idempotency-Key'];
    if (provider.has(key) && provider.get(key) !== init.body) {
      return Response.json({ name: 'invalid_idempotent_request' }, { status: 409 });
    }
    if (!provider.has(key)) {
      provider.set(key, init.body);
      accepted++;
    }
    return Response.json({ id: 'accepted' });
  } });
  assert.equal((await onRequestPost({ request: request(), env })).status, 200);
  assert.equal((await onRequestPost({ request: request(payload, {
    'cf-connecting-ip': '192.0.2.1', 'user-agent': 'Updated Browser'
  }), env })).status, 200);
  assert.equal(accepted, 1);
  assert.equal(emails[0].key, emails[1].key);
  assert.deepEqual(emails[0].body, emails[1].body);
  assert.equal((await onRequestPost({ request: request({ ...payload, message: 'This is an edited message.' }), env })).status, 200);
  assert.notEqual(emails[0].key, emails[2].key);
  assert.equal(accepted, 2);
});

test('request metadata stays out of email while IP protection remains active', async t => {
  const ip = '192.0.2.1';
  const agent = 'Private Browser Details';
  const keys = [];
  const { emails, logs } = services(t, { verify: init => {
    assert.equal(init.body.get('remoteip'), ip);
    assert.equal(init.body.get('response'), payload.turnstileToken);
    assert.ok(!String(init.body).includes(agent));
    return Response.json(verification);
  } });
  const handler = createContactHandler({ makeLimiter: () => ({
    async limit(key) { keys.push(key); return { success: true, pending: Promise.resolve() }; }
  }) });
  const response = await handler({
    request: request(payload, { 'cf-connecting-ip': ip, 'user-agent': agent }),
    env: { ...env, UPSTASH_REDIS_REST_URL: 'https://redis.example.test', UPSTASH_REDIS_REST_TOKEN: 'test' }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(keys, ['email:' + payload.email, 'ip:' + ip]);
  assert.equal(emails.length, 1);
  const captured = JSON.stringify({ emails, logs });
  for (const value of [ip, agent, payload.turnstileToken, 'User-Agent:', 'IP:']) {
    assert.ok(!captured.includes(value), 'Unexpected request metadata: ' + value);
  }
});

for (const setting of ['CONTACT_FROM_EMAIL', 'CONTACT_TARGET_EMAIL']) {
  test('a changed ' + setting + ' preserves the original identity and reports conflict', async t => {
    let originalBody;
    const { emails, logs } = services(t, { send: init => {
      if (!originalBody) {
        originalBody = init.body;
        return Response.json({ id: 'accepted' });
      }
      assert.notEqual(init.body, originalBody);
      return Response.json({ name: 'invalid_idempotent_request' }, { status: 409 });
    } });
    assert.equal((await onRequestPost({ request: request(), env })).status, 200);
    const retry = await onRequestPost({ request: request(), env: { ...env, [setting]: 'changed@example.test' } });
    assert.equal(retry.status, 409);
    assert.equal((await retry.json()).state, 'unknown');
    assert.equal(emails.length, 2);
    assert.equal(emails[0].key, emails[1].key);
    assert.ok(logs.some(log => log.category === 'provider_payload_conflict'));
  });
}

test('concurrent replies are unknown and expired identities never send again', async t => {
  const { emails } = services(t, { send: () => Response.json({ name: 'concurrent_idempotent_requests' }, { status: 409 }) });
  const result = await onRequestPost({ request: request(), env });
  assert.equal(result.status, 409);
  assert.equal((await result.json()).state, 'unknown');
  assert.equal((await onRequestPost({ request: request({ ...payload, submissionCreatedAt: Date.now() - RETRY_LIFETIME - 1 }), env })).status, 409);
  assert.equal(emails.length, 1);
});

test('overlapping attempts keep one provider identity and accept only once', async t => {
  let begin;
  let finish;
  const started = new Promise(resolve => { begin = resolve; });
  const hold = new Promise(resolve => { finish = resolve; });
  let accepted = 0;
  let activeKey;
  const { emails } = services(t, { send: async init => {
    if (activeKey) {
      assert.equal(init.headers['Idempotency-Key'], activeKey);
      return Response.json({ name: 'concurrent_idempotent_requests' }, { status: 409 });
    }
    activeKey = init.headers['Idempotency-Key'];
    begin();
    await hold;
    accepted++;
    return Response.json({ id: 'accepted-once' });
  } });
  const first = onRequestPost({ request: request(), env });
  await started;
  try {
    const second = await onRequestPost({ request: request({ ...payload, turnstileToken: 'renewed' }), env });
    assert.equal(second.status, 409);
    assert.equal((await second.json()).state, 'unknown');
  } finally { finish(); }
  assert.equal((await first).status, 200);
  assert.equal(accepted, 1);
  assert.equal(emails.length, 2);
});

test('the total deadline includes both sequential rate checks', async t => {
  const { emails } = services(t);
  const calls = [];
  const handler = createContactHandler({
    budget: { ...budget, total: 35 },
    makeLimiter: (env, signal) => ({
      async limit(key) { calls.push(key); return stall(signal); }
    })
  });
  const response = await handler({
    request: request(payload, { 'cf-connecting-ip': '192.0.2.1' }),
    env: { ...env, UPSTASH_REDIS_REST_URL: 'https://redis.example.test', UPSTASH_REDIS_REST_TOKEN: 'test' }
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).state, 'not_sent');
  assert.deepEqual(calls, ['email:' + payload.email, 'ip:192.0.2.1']);
  assert.equal(emails.length, 0);
});

for (const outage of ['timeout', 'throw']) {
  test('rate limiter ' + outage + ' preserves fail-open policy with a safe diagnostic', async t => {
    const { logs } = services(t);
    const handler = createContactHandler({ makeLimiter: () => ({
      async limit() {
        if (outage === 'throw') throw new Error('private Redis credential');
        return { success: true, reason: 'timeout', pending: Promise.resolve() };
      }
    }) });
    const response = await handler({ request: request(), env: { ...env, UPSTASH_REDIS_REST_URL: 'https://redis.example.test', UPSTASH_REDIS_REST_TOKEN: 'test' }, waitUntil() {} });
    assert.equal(response.status, 200);
    assert.ok(logs.some(log => log.category.startsWith('rate_')));
    assert.ok(!JSON.stringify(logs).includes('private Redis credential'));
  });
}

test('retains and handles pending analytics on an early rate rejection', async t => {
  const { emails, logs } = services(t);
  const pending = [];
  const handler = createContactHandler({ makeLimiter: () => ({
    async limit() { return { success: false, pending: Promise.reject(new Error('private analytics error')) }; }
  }) });
  const response = await handler({
    request: request(), env: { ...env, UPSTASH_REDIS_REST_URL: 'https://redis.example.test', UPSTASH_REDIS_REST_TOKEN: 'test' },
    waitUntil(promise) { pending.push(promise); }
  });
  await Promise.all(pending);
  assert.equal(response.status, 429);
  assert.equal(emails.length, 0);
  assert.equal(pending.length, 1);
  assert.ok(logs.some(log => log.category === 'rate_analytics_unavailable'));
});

test('browser storage retains only retry metadata and never resets an expired attempt', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const attempt = new ContactAttempt(storage);
  const first = await attempt.forPayload(payload);
  assert.deepEqual(await attempt.forPayload({ ...payload, turnstileToken: 'renewed' }), first);
  assert.deepEqual(await new ContactAttempt(storage).forPayload(payload), first);
  assert.ok(!JSON.stringify([...values.values()]).includes(payload.email));
  attempt.current.createdAt -= RETRY_LIFETIME + 1;
  await assert.rejects(attempt.forPayload(payload), /expired/);
  assert.equal(attempt.current.id, first.submissionId);
  assert.notEqual((await attempt.forPayload({ ...payload, subject: 'Edited subject' })).submissionId, first.submissionId);
  attempt.clear();
  assert.equal(values.size, 0);
});

test('blocked browser storage keeps identity in memory', async () => {
  const blocked = { getItem() { throw new Error(); }, setItem() { throw new Error(); }, removeItem() { throw new Error(); } };
  const attempt = new ContactAttempt(blocked);
  assert.deepEqual(await attempt.forPayload(payload), await attempt.forPayload(payload));
  attempt.clear();
});
