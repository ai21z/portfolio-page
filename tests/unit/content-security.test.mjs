import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { contentSecurityPolicy, appendContentSecurity } from '../../scripts/content-security.mjs';

test('hashes parsed inline script bytes and does not allow arbitrary inline code', () => {
  const source = '\nwindow.ready = true;\n';
  const hash = createHash('sha256').update(source).digest('base64');
  const policy = contentSecurityPolicy(['<script>' + source + '</script>']);
  assert.ok(policy.includes("'sha256-" + hash + "'"));
  assert.ok(!policy.split(';').find(part => part.trim().startsWith('script-src')).includes('unsafe'));
  assert.ok(policy.includes('frame-src https://challenges.cloudflare.com'));
  assert.ok(policy.split(';').find(part => part.trim().startsWith('script-src')).includes('https://static.cloudflareinsights.com'));
  assert.ok(policy.split(';').find(part => part.trim().startsWith('connect-src')).includes('https://cloudflareinsights.com'));
  assert.match(appendContentSecurity('/*\n  X-Frame-Options: DENY\n', ['<h1>Fixture</h1>'], 'report-only'), /Content-Security-Policy-Report-Only/);
});

test('rejects inline event handlers and executable URLs before building', () => {
  assert.throws(() => contentSecurityPolicy(['<button onclick="run()">Go</button>']), /not permitted/);
  assert.throws(() => contentSecurityPolicy(['<a href="javascript:run()">Go</a>']), /not permitted/);
});
