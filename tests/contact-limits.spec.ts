import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readText(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function match(re: RegExp, text: string, label: string): [number, number] {
  const m = text.match(re);
  if (!m) throw new Error(`Could not locate ${label}`);
  return [Number(m[1]), Number(m[2])];
}

// The contact form validates lengths twice: once in the browser module
// (js/contact.js) and once in the Cloudflare Pages Function (functions/api/
// contact.js). They have no shared import path, so this guards against the two
// silently drifting apart.
test('contact form length limits agree between client and server', () => {
  const client = readText('js/contact.js');
  const server = readText('functions/api/contact.js');

  const c = {
    name: match(/NAME_LIMIT\s*=\s*\{\s*min:\s*(\d+),\s*max:\s*(\d+)\s*\}/, client, 'client NAME_LIMIT'),
    subject: match(/SUBJECT_LIMIT\s*=\s*\{\s*min:\s*(\d+),\s*max:\s*(\d+)\s*\}/, client, 'client SUBJECT_LIMIT'),
    message: match(/MESSAGE_LIMIT\s*=\s*\{\s*min:\s*(\d+),\s*max:\s*(\d+)\s*\}/, client, 'client MESSAGE_LIMIT'),
  };
  const s = {
    name: match(/name:\s*z\.string\(\)\.min\((\d+)\)\.max\((\d+)\)/, server, 'server name'),
    subject: match(/subject:\s*z\.string\(\)\.min\((\d+)\)\.max\((\d+)\)/, server, 'server subject'),
    message: match(/message:\s*z\.string\(\)\.min\((\d+)\)\.max\((\d+)\)/, server, 'server message'),
  };

  expect(c.name, 'name min/max must match the server schema').toEqual(s.name);
  expect(c.subject, 'subject min/max must match the server schema').toEqual(s.subject);
  expect(c.message, 'message min/max must match the server schema').toEqual(s.message);
});
