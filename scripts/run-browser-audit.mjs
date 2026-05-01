import { spawnSync } from 'node:child_process';

function run(command, args) {
  return spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
}

const clean = run('npm', ['run', 'clean:audit']);
if (clean.status !== 0) process.exit(clean.status || 1);

const testRun = run('npx', ['playwright', 'test', 'tests/audit/site-audit.spec.ts', '--workers=1']);
const merge = run('npm', ['run', 'audit:merge']);

if (merge.status !== 0) process.exit(merge.status || 1);
process.exit(testRun.status || 0);
