import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(repoRoot, 'artifacts', 'network.json');
const outputPath = path.join(repoRoot, 'artifacts', 'network-lite.json');
const quant = 3;

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const paths = [];
let pointCount = 0;

for (const pathPoints of source.paths || []) {
  const out = [];
  let previousKey = '';

  for (const [x, y] of pathPoints) {
    const px = Math.round(x / quant) * quant;
    const py = Math.round(y / quant) * quant;
    const key = `${px},${py}`;
    if (key === previousKey) continue;

    out.push([px, py]);
    previousKey = key;
  }

  if (out.length >= 2) {
    paths.push(out);
    pointCount += out.length;
  }
}

const lite = {
  width: source.width,
  height: source.height,
  quant,
  paths,
};

fs.writeFileSync(outputPath, `${JSON.stringify(lite)}\n`);

const sourceSize = fs.statSync(sourcePath).size;
const outputSize = fs.statSync(outputPath).size;
console.log(`network-lite.json: ${paths.length} paths, ${pointCount} points`);
console.log(`size: ${sourceSize} -> ${outputSize} bytes`);
