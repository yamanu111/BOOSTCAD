import test from 'node:test';
import assert from 'node:assert/strict';
import { openingGeometry, completeBrowserModel } from '../src/browser-model.mjs';
import { createDemoModel } from '../src/demo-model.mjs';

const window = { id: 'test-opening', kind: 'window', name: 'test window', floor: 'ground', width: 2, height: 1.5,
  matrix: [0, 0, 1, 10, 1, 0, 0, 20, 0, 1, 0, 3] };
const model = () => ({ objects: [], parts: [], stats: { unsupported: {} }, failures: [], warnings: [] });

test('opening dimension plane preserves saved width, height, base and wall rotation', () => {
  const g = openingGeometry(window);
  assert.deepEqual(g.positions, [10, 19, 3, 10, 21, 3, 10, 21, 4.5, 10, 19, 4.5]);
  assert.equal(g.indices.length, 6);
  assert.throws(() => openingGeometry({ ...window, width: NaN }));
  assert.throws(() => openingGeometry({ ...window, height: -1 }));
  assert.throws(() => openingGeometry({ ...window, matrix: [] }));
});

test('browser edition generates only saved openings and lists every manufacturer instance', () => {
  const result = model();
  result.parts = [window, { kind: 'product', library: 'test product.gsm' }, { kind: 'product', library: 'test product.gsm' },
    { kind: 'window', id: 'broken', name: 'invalid', width: -1, height: 1, matrix: window.matrix }];
  completeBrowserModel(result);
  assert.equal(result.objects.length, 1);
  assert.equal(result.objects[0].geometryBasis, 'opening');
  assert.equal(result.stats.windows, 1);
  assert.equal(result.stats.products, 0);
  assert.equal(result.stats.unsupported.windows, 1);
  assert.equal(result.stats.unsupported.objects, 2);
  assert.deepEqual(result.missingParts, [{ name: 'test product.gsm', count: 2 }]);
  assert.equal(result.failures.length, 1);
  assert.equal(result.parts, undefined);
});

test('original demo has finite geometry, valid triangle indices and a real wall opening', () => {
  const result = createDemoModel();
  assert.equal(result.demo, true);
  assert.equal(result.objects.length, 8);
  assert.equal(result.stats.walls, 4);
  assert.equal(result.stats.windows, 1);
  assert.equal(result.stats.triangles, 122);
  assert.equal(result.failures.length, 0);
  for (const object of result.objects) {
    assert.ok([...object.positions].every(Number.isFinite));
    assert.ok([...object.indices].every(i => i < object.positions.length / 3));
  }
  // The south wall has no triangle interior crossing the center of the window.
  const wall = result.objects.find(o => o.name === 'デモの南壁');
  for (let i = 0; i < wall.indices.length; i += 3) {
    const vertices = [...wall.indices.slice(i, i + 3)].map(j => [...wall.positions.slice(j * 3, j * 3 + 3)]);
    const center = [0, 1, 2].map(k => vertices.reduce((sum, p) => sum + p[k], 0) / 3);
    assert.ok(!(Math.abs(center[0]) < .8 - 1e-9 && center[2] > 1 + 1e-9 && center[2] < 2.2 - 1e-9));
  }
});
