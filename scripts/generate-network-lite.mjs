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

// Each path travels as its start, in steps of quant, then one letter per step: nearly every step is
// one quant to one of the 8 neighbours, so 83,000 points fit in about a tenth of the plain JSON's bytes.
// A longer step is written in brackets. js/app.js (decodeNetworkPaths) reads it back.
const STEP_LETTERS = { '0,-1': 'a', '1,-1': 'b', '1,0': 'c', '1,1': 'd', '0,1': 'e', '-1,1': 'f', '-1,0': 'g', '-1,-1': 'h' };
const encode = (points) => {
  let out = `${points[0][0] / quant},${points[0][1] / quant}`;
  for (let i = 1; i < points.length; i++) {
    const dx = (points[i][0] - points[i - 1][0]) / quant;
    const dy = (points[i][1] - points[i - 1][1]) / quant;
    out += STEP_LETTERS[`${dx},${dy}`] || `(${dx},${dy})`;
  }
  return out;
};

const lite = {
  width: source.width,
  height: source.height,
  quant,
  encoding: 'steps',
  paths: paths.map(encode),
};

fs.writeFileSync(outputPath, `${JSON.stringify(lite)}\n`);

const sourceSize = fs.statSync(sourcePath).size;
const outputSize = fs.statSync(outputPath).size;
console.log(`network-lite.json: ${paths.length} paths, ${pointCount} points`);
console.log(`size: ${sourceSize} -> ${outputSize} bytes`);
