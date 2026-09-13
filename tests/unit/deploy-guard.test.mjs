import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { publicFiles } from '../../scripts/build-site.mjs';
import { deploySite } from '../../scripts/deploy-site.mjs';

async function fixture(t, branch = 'master') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portfolio-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', branch);
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.test');
  await writeFile(path.join(root, '.gitignore'), 'dist/\nfunctions/ignored.js\n');
  await writeFile(path.join(root, 'source.txt'), 'baseline');
  await mkdir(path.join(root, 'functions'));
  await writeFile(path.join(root, 'functions/contact.js'), 'export const version = 1');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
  const uploads = [];
  return { root, git, uploads, options: {
    root, mode: 'production', expectedCommit: git('rev-parse', 'HEAD'),
    prepareBuild: async () => {
      for (const file of publicFiles) {
        const destination = path.join(root, 'dist', file);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, file);
      }
    },
    check: async () => {}, uploader: async (_root, receipt) => uploads.push(receipt)
  } };
}

for (const scenario of ['wrong branch', 'detached', 'tracked change', 'untracked file', 'wrong commit', 'missing commit', 'ignored Function']) {
  test(`never uploads with ${scenario}`, async t => {
    const f = await fixture(t, scenario === 'wrong branch' ? 'improvements' : 'master');
    if (scenario === 'detached') f.git('checkout', '--detach');
    if (scenario === 'tracked change') await writeFile(path.join(f.root, 'source.txt'), 'changed');
    if (scenario === 'untracked file') await writeFile(path.join(f.root, 'draft.txt'), 'draft');
    if (scenario === 'ignored Function') await writeFile(path.join(f.root, 'functions/ignored.js'), 'private');
    if (scenario === 'wrong commit') f.options.expectedCommit = '0'.repeat(40);
    if (scenario === 'missing commit') delete f.options.expectedCommit;
    await assert.rejects(deploySite(f.options));
    assert.equal(f.uploads.length, 0);
  });
}

for (const scenario of ['build failure', 'test failure', 'source mutation', 'commit mutation', 'output mutation', 'extra output']) {
  test(`never uploads after ${scenario}`, async t => {
    const f = await fixture(t);
    if (scenario === 'build failure') f.options.prepareBuild = async () => { throw new Error('Build failed'); };
    f.options.check = async () => {
      if (scenario === 'test failure') throw new Error('Tests failed');
      if (scenario === 'source mutation') await writeFile(path.join(f.root, 'functions/contact.js'), 'changed');
      if (scenario === 'commit mutation') f.git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'changed');
      if (scenario === 'output mutation') await writeFile(path.join(f.root, 'dist/index.html'), 'stale');
      if (scenario === 'extra output') await writeFile(path.join(f.root, 'dist/private.txt'), 'private');
    };
    await assert.rejects(deploySite(f.options));
    assert.equal(f.uploads.length, 0);
  });
}

test('records reviewed source and verified output before a permitted upload', async t => {
  const f = await fixture(t);
  const receipt = await deploySite(f.options);
  assert.equal(receipt.commit, f.options.expectedCommit);
  assert.equal(receipt.branch, 'master');
  assert.match(receipt.sourceHash, /^[a-f0-9]{64}$/);
  assert.match(receipt.outputHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(f.uploads, [receipt]);
});

test('preview preserves its branch and cannot masquerade as production', async t => {
  const f = await fixture(t, 'improvements');
  const receipt = await deploySite({ ...f.options, mode: 'preview' });
  assert.equal(receipt.branch, 'improvements');
  const master = await fixture(t);
  await assert.rejects(deploySite({ ...master.options, mode: 'preview' }), /non-master/);
  assert.equal(master.uploads.length, 0);
});
