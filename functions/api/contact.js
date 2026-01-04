import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { Resend } from 'resend';
import { z } from 'zod';

// Schema validation
const CONTACT_SCHEMA = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().max(320),
  subject: z.string().min(5).max(60),
  message: z.string().min(10).max(350),
  turnstileToken: z.string().min(1).max(2048),
  honeypot: z.string().optional().transform((value) => (value || '').trim())
});

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_BODY_SIZE = 16 * 1024; // 16KB

// Helper: create JSON response
function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

// Helper: verify Turnstile token
async function verifyTurnstile(token, ipAddress, secret) {
  if (!secret) {
    throw new Error('TURNSTILE_NOT_CONFIGURED');
  }

  const form = new URLSearchParams();
  form.append('secret', secret);
  form.append('response', token);
  if (ipAddress) {
    form.append('remoteip', ipAddress);
  }

  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    body: form
  });

  if (!response.ok) {
    throw new Error(`TURNSTILE_HTTP_${response.status}`);
  }

  return await response.json();
}

// Helper: sanitize single-line text
function sanitizeLine(value) {
  return (value || '')
    .replace(/[\x00-\x1F\x7F]/g, '') // strip control chars
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Helper: sanitize multi-line message
function sanitizeMessage(value) {
  return (value || '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // strip control chars except \t\n\r
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

// Helper: escape HTML
function escapeHtml(value) {
  return (value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Main handler for POST /api/contact
export async function onRequestPost(context) {
  const { request, env } = context;

  // Get client IP from Cloudflare header
  const ipAddress = request.headers.get('cf-connecting-ip') || '';
  const userAgent = request.headers.get('user-agent') || 'unknown';

  // Check content length
  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_BODY_SIZE) {
    return jsonResponse(413, { error: 'Payload too large' });
  }

  // Read and parse body
  let rawBody = '';
  try {
    rawBody = await request.text();
    if (rawBody.length > MAX_BODY_SIZE) {
      return jsonResponse(413, { error: 'Payload too large' });
    }
  } catch (error) {
    return jsonResponse(400, { error: 'Unable to read request body' });
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBody || '{}');
  } catch (error) {
    return jsonResponse(400, { error: 'Invalid JSON payload' });
  }

  // Validate schema
  const validation = CONTACT_SCHEMA.safeParse(parsed);
  if (!validation.success) {
    return jsonResponse(422, { error: 'Invalid contact request' });
  }

  const data = validation.data;

  // Honeypot check - silently accept but don't send
  if (data.honeypot) {
    console.info('[contact] honeypot triggered — discarding payload');
    return jsonResponse(200, { success: true });
  }

  // Rate limiting (optional - only if Upstash configured)
  const redisConfigured = Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
  
  if (redisConfigured) {
    try {
      const redis = new Redis({
        url: env.UPSTASH_REDIS_REST_URL,
        token: env.UPSTASH_REDIS_REST_TOKEN
      });

      const ratelimit = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(5, '10 m'),
        analytics: true,
        prefix: 'contact'
      });

      const emailKey = `email:${data.email.toLowerCase()}`;
      const ipKey = ipAddress ? `ip:${ipAddress}` : null;
      const keysToCheck = [emailKey];
      if (ipKey) keysToCheck.push(ipKey);

      for (const key of keysToCheck) {
        const result = await ratelimit.limit(key);
        if (!result.success) {
          return jsonResponse(429, {
            error: 'Too many messages received. Please wait a few minutes and try again.'
          });
        }
      }
    } catch (error) {
      // Rate limiting failed - log but continue (graceful degradation)
      console.warn('[contact] rate limiter unavailable, proceeding without rate limit:', error.message);
    }
  }

  // Turnstile verification
  try {
    const turnstile = await verifyTurnstile(data.turnstileToken, ipAddress, env.TURNSTILE_SECRET_KEY);
    if (!turnstile.success) {
      const code = Array.isArray(turnstile['error-codes']) && turnstile['error-codes'].length
        ? turnstile['error-codes'].join(',')
        : 'unknown';
      return jsonResponse(401, { error: `Verification failed (${code}).` });
    }
  } catch (error) {
    console.error('[contact] turnstile verification failed', error);
    return jsonResponse(502, { error: 'Verification service unavailable. Please retry later.' });
  }

  // Email configuration
  const resendApiKey = env.RESEND_API_KEY;
  const resendFrom = env.CONTACT_FROM_EMAIL;
  const resendTo = (env.CONTACT_TARGET_EMAIL || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!resendApiKey || !resendFrom || resendTo.length === 0) {
    console.error('[contact] email delivery is not configured');
    return jsonResponse(500, { error: 'Contact service misconfigured. Please try again later.' });
  }

  // Sanitize inputs
  const safeName = sanitizeLine(data.name);
  const safeSubject = sanitizeLine(data.subject);
  const safeMessage = sanitizeMessage(data.message);

  // Build email content
  const htmlBody = `
    <h2 style="margin:0 0 12px 0;">New contact form submission</h2>
    <p style="margin:0 0 8px 0;"><strong>From:</strong> ${escapeHtml(safeName)}</p>
    <p style="margin:0 0 8px 0;"><strong>Email:</strong> ${escapeHtml(data.email)}</p>
    <p style="margin:0 0 8px 0;"><strong>Subject:</strong> ${escapeHtml(safeSubject)}</p>
    <p style="margin:16px 0 4px 0;"><strong>Message:</strong></p>
    <pre style="margin:0;font-family:'Fira Code', monospace;background:#f7f7f7;padding:12px;border-radius:6px;white-space:pre-wrap;">${escapeHtml(safeMessage)}</pre>
    <hr style="margin:20px 0;border:none;border-top:1px solid #e5e5e5;" />
    <p style="margin:4px 0;font-size:12px;color:#555;">IP: ${escapeHtml(ipAddress || 'unknown')}</p>
    <p style="margin:4px 0;font-size:12px;color:#555;">User-Agent: ${escapeHtml(userAgent)}</p>
  `;

  const textBody = [
    'New contact form submission',
    `From: ${safeName}`,
    `Email: ${data.email}`,
    `Subject: ${safeSubject}`,
    '',
    safeMessage,
    '',
    `IP: ${ipAddress || 'unknown'}`,
    `User-Agent: ${userAgent}`
  ].join('\n');

  // Send email via Resend
  try {
    const resend = new Resend(resendApiKey);
    await resend.emails.send({
      from: resendFrom,
      to: resendTo,
      subject: `[Portfolio] ${safeSubject}`,
      replyTo: data.email,
      html: htmlBody,
      text: textBody
    });
  } catch (error) {
    console.error('[contact] email delivery failed', error);
    return jsonResponse(502, { error: 'Failed to deliver message. Please try again later.' });
  }

  return jsonResponse(200, { success: true });
}

// Handle non-POST methods
export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: {
        'Allow': 'POST',
        'Content-Type': 'application/json'
      }
    });
  }
  return onRequestPost(context);
}
