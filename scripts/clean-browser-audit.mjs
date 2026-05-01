import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const artifactsDir = path.join(repoRoot, 'artifacts');

const targets = [
  path.join(artifactsDir, 'audit-screenshots'),
  path.join(artifactsDir, 'browser-audit-parts'),
  path.join(artifactsDir, 'browser-audit-report.json')
];

for (const target of targets) {
  fs.rmSync(target, { recursive: true, force: true });
}

fs.mkdirSync(path.join(artifactsDir, 'audit-screenshots'), { recursive: true });
fs.mkdirSync(path.join(artifactsDir, 'browser-audit-parts'), { recursive: true });

console.log('Cleaned browser audit artifacts.');
