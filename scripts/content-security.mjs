import { createHash } from 'node:crypto';
import { parse } from 'parse5';

export function contentSecurityPolicy(htmlPages) {
  const hashes = new Set();
  function visit(node) {
    const attrs = new Map((node.attrs || []).map(attr => [attr.name, attr.value]));
    for (const [name, value] of attrs) {
      if (name.startsWith('on') || /^\s*javascript:/i.test(value)) {
        throw new Error('Inline event handlers and javascript URLs are not permitted');
      }
    }
    if (node.tagName === 'script' && !attrs.has('src')) {
      const text = (node.childNodes || []).map(child => child.value || '').join('');
      hashes.add("'sha256-" + createHash('sha256').update(text).digest('base64') + "'");
    }
    for (const child of node.childNodes || []) visit(child);
    if (node.content) visit(node.content);
  }
  for (const html of htmlPages) visit(parse(html));
  return [
    "default-src 'self'",
    "script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com " + [...hashes].sort().join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https://challenges.cloudflare.com https://cloudflareinsights.com",
    "frame-src https://challenges.cloudflare.com",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ');
}

export function appendContentSecurity(headers, htmlPages, mode) {
  const name = mode === 'report-only' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
  return headers.trimEnd() + '\n\n/*\n  ' + name + ': ' + contentSecurityPolicy(htmlPages) + '\n';
}
