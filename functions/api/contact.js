import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis/cloudflare';
import { z } from 'zod';
import { BodyLimitError, deadline, readJsonBounded } from '../_lib/bounded-io.js';

const CONTACT_SCHEMA = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().max(320),
  subject: z.string().min(5).max(60),
  message: z.string().min(10).max(350),
  turnstileToken: z.string().min(1).max(2048),
  submissionId: z.string().uuid(),
  submissionCreatedAt: z.number().int().positive(),
  honeypot: z.string().optional().transform(value => (value || '').trim())
});

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const RESEND_URL = 'https://api.resend.com/emails';
const RETRY_LIFETIME = 23 * 60 * 60 * 1000;
const BUDGET = { total: 27000, body: 3000, rate: 5000, verification: 5000, provider: 8000 };

function jsonResponse(status, payload, requestId) {
  return Response.json(payload, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-ID': requestId
    }
  });
}

function sanitizeLine(value) {
  return (value || '')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeMessage(value) {
  return (value || '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Keep tabs and line breaks.
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function escapeHtml(value) {
  return (value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function emailPayload(data, env) {
  const resendFrom = env.CONTACT_FROM_EMAIL;
  const resendTo = (env.CONTACT_TARGET_EMAIL || '').split(',').map(value => value.trim()).filter(Boolean);
  const safeName = sanitizeLine(data.name);
  const safeSubject = sanitizeLine(data.subject);
  const safeMessage = sanitizeMessage(data.message);

  const htmlBody = `
    <h2 style="margin:0 0 12px 0;">New contact form submission</h2>
    <p style="margin:0 0 8px 0;"><strong>From:</strong> ${escapeHtml(safeName)}</p>
    <p style="margin:0 0 8px 0;"><strong>Email:</strong> ${escapeHtml(data.email)}</p>
    <p style="margin:0 0 8px 0;"><strong>Subject:</strong> ${escapeHtml(safeSubject)}</p>
    <p style="margin:16px 0 4px 0;"><strong>Message:</strong></p>
    <pre style="margin:0;font-family:'Fira Code', monospace;background:#f7f7f7;padding:12px;border-radius:6px;white-space:pre-wrap;">${escapeHtml(safeMessage)}</pre>
  `;

  const textBody = [
    'New contact form submission',
    `From: ${safeName}`,
    `Email: ${data.email}`,
    `Subject: ${safeSubject}`,
    '',
    safeMessage
  ].join('\n');

  return {
    from: resendFrom,
    to: resendTo,
    subject: `[Portfolio] ${safeSubject}`,
    reply_to: data.email,
    html: htmlBody,
    text: textBody
  };
}

function createLimiter(env, signal, timeout) {
  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
    signal,
    retry: false
  });
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '10 m'),
    analytics: true,
    prefix: 'contact',
    timeout
  });
}

async function submissionKey(data) {
  const content = JSON.stringify([data.name, data.email, data.subject, data.message]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return `contact/${data.submissionId}/${data.submissionCreatedAt}/${hash}`;
}

export function createContactHandler({ budget = BUDGET, makeLimiter = createLimiter } = {}) {
  return async function handleContact(context) {
    const { request, env } = context;
    const requestId = crypto.randomUUID();
    const reply = (status, payload) => jsonResponse(status, payload, requestId);
    const log = category => console.warn(JSON.stringify({ event: 'contact', requestId, category }));
    const total = deadline(budget.total, request.signal);
    const ipAddress = request.headers.get('cf-connecting-ip') || '';
    let sending = false;

    async function stage(milliseconds, operation) {
      const scope = deadline(milliseconds, total.signal);
      try { return await operation(scope.signal); }
      finally { scope.dispose(); }
    }

    try {
      let parsed;
      try {
        parsed = await stage(budget.body, signal => readJsonBounded(request, signal));
      } catch (error) {
        if (error instanceof BodyLimitError) return reply(413, { state: 'not_sent', error: 'Payload too large.' });
        return reply(error.name === 'TimeoutError' ? 408 : 400, {
          state: 'not_sent', error: 'Unable to read a valid contact request.'
        });
      }

      const validation = CONTACT_SCHEMA.safeParse(parsed);
      if (!validation.success) return reply(422, { state: 'not_sent', error: 'Invalid contact request.' });
      const data = validation.data;
      if (data.honeypot) return reply(200, { success: true, state: 'accepted' });

      const age = Date.now() - data.submissionCreatedAt;
      if (age > RETRY_LIFETIME || age < -60000) {
        return reply(409, { state: 'unknown', error: 'This retry has expired. An earlier attempt may have been accepted. Please email me directly.' });
      }

      if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
        const keys = [`email:${data.email.toLowerCase()}`];
        if (ipAddress) keys.push(`ip:${ipAddress}`);
        for (const key of keys) {
          const scope = deadline(budget.rate, total.signal);
          let retained = false;
          try {
            const result = await makeLimiter(env, scope.signal, budget.rate).limit(key);
            const pending = Promise.resolve(result.pending).catch(() => log('rate_analytics_unavailable')).finally(() => {
              scope.cancel();
              scope.dispose();
            });
            if (typeof context.waitUntil === 'function') {
              context.waitUntil(pending);
              retained = true;
            } else {
              await pending;
            }
            if (result.reason === 'timeout') {
              scope.cancel();
              log('rate_timeout');
            } else if (!result.success) {
              return reply(429, { state: 'not_sent', error: 'Too many messages received. Please wait a few minutes and try again.' });
            }
          } catch {
            log('rate_unavailable');
          } finally {
            if (!retained) {
              scope.cancel();
              scope.dispose();
            }
          }
        }
      }

      if (!env.TURNSTILE_SECRET_KEY || !env.RESEND_API_KEY || !env.CONTACT_FROM_EMAIL ||
          !env.CONTACT_TARGET_EMAIL?.split(',').some(value => value.trim())) {
        log('configuration_missing');
        return reply(503, { state: 'not_sent', error: 'Contact service unavailable. Please email me directly.' });
      }

      try {
        const turnstile = await stage(budget.verification, async signal => {
          const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: data.turnstileToken });
          if (ipAddress) body.set('remoteip', ipAddress);
          const response = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body, signal });
          const result = await readJsonBounded(response, signal);
          if (!response.ok) throw new Error('Verification unavailable');
          return result;
        });
        const hosts = (env.CONTACT_ALLOWED_HOSTNAMES || 'zounarakis.com').split(',').map(value => value.trim()).filter(Boolean);
        if (turnstile?.success !== true || turnstile.action !== 'contact_form' || !hosts.includes(turnstile.hostname)) {
          log('verification_rejected');
          return reply(401, { state: 'not_sent', error: 'Verification failed or expired. Please complete the challenge again.' });
        }
      } catch {
        log('verification_unavailable');
        return reply(503, { state: 'not_sent', error: 'Verification service unavailable. Please retry later or email me directly.' });
      }

      const key = await submissionKey(data);
      const body = JSON.stringify(emailPayload(data, env));
      const result = await stage(budget.provider, async signal => {
        signal.throwIfAborted();
        sending = true;
        const response = await fetch(RESEND_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': key
          },
          body,
          signal
        });
        return { status: response.status, ok: response.ok, data: await readJsonBounded(response, signal) };
      });

      if (result.ok && typeof result.data?.id === 'string' && result.data.id.trim()) {
        return reply(200, { success: true, state: 'accepted' });
      }
      if (result.status === 409) {
        const concurrent = result.data?.name === 'concurrent_idempotent_requests';
        log(concurrent ? 'provider_concurrent' : 'provider_payload_conflict');
        return reply(409, {
          state: 'unknown',
          error: concurrent
            ? 'An earlier attempt is still processing. Wait a moment before retrying the same message.'
            : 'An earlier attempt may have been accepted. This retry no longer matches it. Please email me directly.'
        });
      }
      if (result.status >= 400 && result.status < 500) {
        log('provider_rejected');
        return reply(502, { state: 'rejected', error: 'The email service rejected this attempt. Please try later or email me directly.' });
      }
      log('provider_unconfirmed');
      return reply(502, { state: 'unknown', error: 'The email service did not confirm the result. Your message may already have been accepted.' });
    } catch (error) {
      log(sending ? 'provider_unknown' : 'attempt_interrupted');
      return reply(error.name === 'TimeoutError' || total.signal.aborted ? 504 : 502, {
        state: sending ? 'unknown' : 'not_sent',
        error: sending
          ? 'The email service did not confirm the result. Your message may already have been accepted.'
          : 'This attempt could not complete. Please retry later or email me directly.'
      });
    } finally {
      total.dispose();
    }
  };
}

export const onRequestPost = createContactHandler();

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    const response = jsonResponse(405, { error: 'Method Not Allowed' }, crypto.randomUUID());
    response.headers.set('Allow', 'POST');
    return response;
  }
  return onRequestPost(context);
}
