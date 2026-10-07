import test from 'node:test';
import assert from 'node:assert/strict';
import { ElevationSession, elevationDifference } from '../src/elevation-session.mjs';
const point = (z, floor = 'floor') => ({ xyz: [0, 0, z], floor, name: 'model' });

test('all targets keep the original reference and report signed vertical differences', () => {
  const session = new ElevationSession(), reference = point(2.5);
  session.addPoint(reference);
  for (const z of [4, 1.2, 2.5]) session.addPoint(point(z));
  assert.equal(session.reference, reference);
  assert.deepEqual(session.completed.map(r => elevationDifference(...r.points)), [1.5, -1.3, 0]);
  assert.ok(session.completed.every(r => r.points[0] === reference));
  assert.equal(elevationDifference(reference, { ...point(4), xyz: [100, -75, 4] }), 1.5);
});

test('a different floor cannot create a misleading height or change the reference', () => {
  const session = new ElevationSession(), reference = point(3, 'ground');
  session.addPoint(reference);
  assert.equal(session.addPoint(point(4, 'upper')), false);
  assert.equal(session.reference, reference); assert.equal(session.completed.length, 0);
  assert.equal(elevationDifference(reference, point(4, 'upper')), null);
  assert.equal(session.addPoint(point(5, 'ground')), true);
  assert.equal(session.completed[0].id, 1);
});

test('undo and clear preserve the reference until targets are gone and allow a new reference', () => {
  const session = new ElevationSession(), reference = point(3);
  for (const p of [reference, point(4), point(2)]) session.addPoint(p);
  session.undo(); assert.equal(session.completed.length, 1); assert.equal(session.reference, reference);
  session.undo(); assert.equal(session.completed.length, 0); assert.equal(session.reference, reference);
  session.undo(); assert.equal(session.reference, null);
  session.addPoint(point(8)); session.addPoint(point(10));
  session.clear(); assert.equal(session.reference, null); assert.deepEqual(session.completed, []);
  session.addPoint(point(-1)); session.addPoint(point(1));
  assert.equal(session.completed[0].id, 1); assert.equal(elevationDifference(...session.completed[0].points), 2);
});
