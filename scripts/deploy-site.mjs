import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { verifyPublicSite } from './build-site.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const project = 'personal-webpage';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

async function fingerprint(root, files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort()) {
    const fullPath = path.join(root, file);
    if (!(await lstat(fullPath)).isFile()) throw new Error(`Not a regular file: ${file}`);
    hash.update(file).update('\0').update(await readFile(fullPath)).update('\0');
  }
  return hash.digest('hex');
}

async function sourceState(root, mode, expectedCommit) {
  const branch = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (mode === 'production' && branch !== 'master') throw new Error('Production requires master');
  if (mode === 'preview' && branch === 'master') throw new Error('Preview requires a non-master branch');
  const commit = git(root, ['rev-parse', 'HEAD']);
  if (commit !== expectedCommit) throw new Error('Source commit does not match --commit');
  if (git(root, ['status', '--porcelain', '--untracked-files=all'])) throw new Error('Source tree must be clean');
  if (git(root, ['ls-files', '--others', '--ignored', '--exclude-standard', 'functions'])) {
    throw new Error('Ignored files found in Functions source');
  }
  const files = git(root, ['ls-files', '-z']).split('\0').filter(Boolean);
  return { branch, commit, sourceHash: await fingerprint(root, files) };
}

function runNode(root, args, env = process.env) {
  execFileSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
}

function prepare(root) {
  git(root, ['diff', '--check']);
  runNode(root, ['--test', 'tests/unit/*.test.mjs']);
  runNode(root, ['scripts/build-site.mjs']);
  runNode(root, ['--test', 'tests/integration/*.test.mjs']);
}

function checkBrowsers(root) {
  const env = { ...process.env, CI: 'true' };
  delete env.BASE_URL;
  delete env.PLAYWRIGHT_BASE_URL;
  runNode(root, ['node_modules/playwright/cli.js', 'test', '--grep-invert',
    'browser audit|records Contact first-entry'], env);
}

function upload(root, receipt) {
  runNode(root, ['node_modules/wrangler/bin/wrangler.js', 'pages', 'deploy', 'dist',
    '--project-name', project, '--branch', receipt.branch,
    '--commit-hash', receipt.commit, '--commit-dirty=false']);
}

export async function deploySite({ root = repoRoot, mode, expectedCommit,
  prepareBuild = prepare, check = checkBrowsers, uploader = upload } = {}) {
  if (!['production', 'preview'].includes(mode)) throw new Error('Choose production or preview');
  if (!/^[a-f0-9]{40}$/.test(expectedCommit || '')) throw new Error('Supply the full reviewed SHA with --commit');
  const before = await sourceState(root, mode, expectedCommit);
  await prepareBuild(root);
  const output = path.join(root, 'dist');
  const outputHash = await fingerprint(output, await verifyPublicSite(output));
  await check(root);
  const after = await sourceState(root, mode, expectedCommit);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Source changed during checks');
  if (outputHash !== await fingerprint(output, await verifyPublicSite(output))) {
    throw new Error('Build output changed during checks');
  }
  const receipt = { project, mode, ...after, outputHash };
  console.log(JSON.stringify(receipt));
  await uploader(root, receipt);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ options: { commit: { type: 'string' } }, allowPositionals: true });
  try {
    if (positionals.length !== 1) throw new Error('Choose exactly one deployment mode');
    await deploySite({ mode: positionals[0], expectedCommit: values.commit });
  } catch (error) {
    console.error(`Deployment stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
