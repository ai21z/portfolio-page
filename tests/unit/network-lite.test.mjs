import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { decodeNetworkPaths } from '../../js/graph.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// network-lite.json carries the paths as step letters. Read back, they are the quantised network: every
// point on the 3 px grid, consecutive points distinct, and the same 4,824 paths and 83,001 points.
test('the step-encoded network reads back to the quantised paths', async () => {
  const data = decodeNetworkPaths(JSON.parse(await readFile(path.join(root, 'artifacts/network-lite.json'), 'utf8')));
  assert.equal(data.width, 1920);
  assert.equal(data.height, 1080);
  assert.equal(data.paths.length, 4824);
  assert.equal(data.paths.reduce((sum, points) => sum + points.length, 0), 83001);
  for (const points of data.paths) {
    assert.ok(points.length >= 2);
    for (let i = 0; i < points.length; i++) {
      assert.ok(points[i][0] % 3 === 0 && points[i][1] % 3 === 0);
      if (i) assert.notDeepEqual(points[i], points[i - 1]);
    }
  }
});

test('a path with a longer step and plain point arrays both read back', () => {
  const steps = decodeNetworkPaths({ quant: 3, encoding: 'steps', paths: ['10,-2c(0,-4)h'] });
  assert.deepEqual(steps.paths, [[[30, -6], [33, -6], [33, -18], [30, -21]]]);
  const plain = { paths: [[[0, 0], [3, 0]]] };
  assert.equal(decodeNetworkPaths(plain), plain);
});
