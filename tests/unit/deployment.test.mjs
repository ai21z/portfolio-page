import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildSite, publicFiles, verifyPublicSite } from '../../scripts/build-site.mjs';

test('deploys only listed public files and removes stale output', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portfolio-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const privateFiles = [
    '.claude/launch.json', '.env', '.dev.vars', '.git/config', 'package.json',
    'docs/local/BLOG-GUIDE.md', 'tests/contact-form.spec.ts', 'functions/api/contact.js',
    'artifacts/browser-audit-report.json', 'artifacts/resume/private-draft.docx',
    'js/debug-notes.js', 'dist/stale.txt'
  ];
  for (const file of [...publicFiles, ...privateFiles]) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), file);
  }
  await writeFile(path.join(root, 'package.json'), '{}');
  await writeFile(path.join(root, 'styles/main.css'), '@import "base.css?v=1"; body { color: blue; }');
  await writeFile(path.join(root, 'styles/base.css'), 'body { color: red; background: url(../artifacts/bg_base.webp); }');
  const output = await buildSite(root);
  assert.deepEqual(await verifyPublicSite(output), [...publicFiles].sort());
  for (const file of publicFiles) {
    if (file === 'styles/main.css') continue;
    assert.equal(await readFile(path.join(output, file), 'utf8'), await readFile(path.join(root, file), 'utf8'));
  }
  const css = await readFile(path.join(output, 'styles/main.css'), 'utf8');
  assert.ok(!css.includes('@import'));
  assert.ok(css.indexOf('color:red') < css.indexOf('color:#00f'));
  assert.ok(css.includes('../artifacts/bg_base.webp'));
  assert.equal(await readFile(path.join(root, '.env'), 'utf8'), '.env');

  await writeFile(path.join(output, 'unintended.txt'), 'private');
  await assert.rejects(verifyPublicSite(output), /do not match/);
  await buildSite(root);
  await verifyPublicSite(output);

  await writeFile(path.join(root, 'styles/private.css'), 'body { --private: secret; }');
  await writeFile(path.join(root, 'styles/main.css'), '@import "private.css";');
  await assert.rejects(buildSite(root), /Unlisted stylesheet/);
  await verifyPublicSite(output);

  await rm(path.join(root, 'index.html'));
  await assert.rejects(buildSite(root), { code: 'ENOENT' });
  await verifyPublicSite(output);
});

test('includes the canonical public assets', () => {
  for (const file of ['index.html', '404.html', '_headers', 'robots.txt', 'sitemap.xml',
    'blog/articles.json', 'js/contact.js', 'artifacts/fonts/LICENSE.txt']) {
    assert.ok(publicFiles.includes(file), file);
  }
  assert.ok(publicFiles.every(file => !file.endsWith('.docx')));
});

test('rejects source and output directory links without touching their targets', async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'portfolio-links-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'site');
  const outside = path.join(temporary, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'keep.txt'), 'keep');
  for (const file of publicFiles) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), file);
  }

  await symlink(outside, path.join(root, 'dist'), 'junction');
  await assert.rejects(buildSite(root), /must not be a symlink/);
  await rm(path.join(root, 'dist'));
  await rm(path.join(root, 'js'), { recursive: true });
  await symlink(outside, path.join(root, 'js'), 'junction');
  await assert.rejects(buildSite(root), /Not a regular public file/);
  assert.equal(await readFile(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
});
