import assert from 'node:assert/strict';
import test from 'node:test';
import { stripComments } from '../../scripts/build-site.mjs';

test('the served page drops development comments and keeps the email_off markers', () => {
  const html = [
    '<!doctype html>',
    '<html><head>',
    '  <!-- a note -->',
    '  <script>const marker = "<!-- not a comment -->";</script>',
    '</head><body>',
    '  <!--email_off-->',
    '  <p>Hi <!-- inline --> there</p>',
    '  <svg><!-- inside svg --><path d="M0 0"/></svg>',
    '  <!--/email_off-->',
    '</body></html>'
  ].join('\r\n');
  const out = stripComments(html);
  assert.equal(out, [
    '<!doctype html>',
    '<html><head>',
    '  <script>const marker = "<!-- not a comment -->";</script>',
    '</head><body>',
    '  <!--email_off-->',
    '  <p>Hi  there</p>',
    '  <svg><path d="M0 0"/></svg>',
    '  <!--/email_off-->',
    '</body></html>'
  ].join('\r\n'));
});
