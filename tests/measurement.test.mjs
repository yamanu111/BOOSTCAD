import test from 'node:test';
import assert from 'node:assert/strict';
import { MeasurementSession } from '../src/measurement-session.mjs';
const point = x => ({ xyz: [x, 0, 0], floor: 'floor', name: 'model' });

test('successive two-point measurements remain while the next one is pending', () => {
  const session = new MeasurementSession();
  session.addPoint(point(1)); session.addPoint(point(2));
  session.addPoint(point(3));
  assert.equal(session.completed.length, 1);
  assert.equal(session.pending.xyz[0], 3);
  assert.deepEqual(session.completed[0].points.map(p => p.xyz[0]), [1, 2]);
  session.addPoint(point(4));
  assert.equal(session.pending, null);
  assert.deepEqual(session.completed.map(m => m.points.map(p => p.xyz[0])), [[1, 2], [3, 4]]);
  assert.deepEqual(session.points.map(p => p.xyz[0]), [3, 4]);
});
test('undo reopens the last measurement and keeps earlier measurements', () => {
  const session = new MeasurementSession();
  for (const x of [1, 2, 3, 4]) session.addPoint(point(x));
  session.undo();
  assert.equal(session.completed.length, 1);
  assert.equal(session.pending.xyz[0], 3);
  session.addPoint(point(5));
  assert.deepEqual(session.completed.map(m => m.points.map(p => p.xyz[0])), [[1, 2], [3, 5]]);
  session.addPoint(point(6)); session.undo();
  assert.equal(session.completed.length, 2);
  assert.equal(session.pending, null);
});
test('cancel only removes the unfinished point; clear removes every measurement', () => {
  const session = new MeasurementSession();
  for (const x of [1, 2, 3]) session.addPoint(point(x));
  session.cancelPending();
  assert.equal(session.completed.length, 1);
  session.addPoint(point(4)); session.clear();
  assert.deepEqual(session.completed, []);
  assert.equal(session.pending, null); assert.deepEqual(session.points, []);
  session.undo(); assert.equal(session.pending, null);
  session.addPoint(point(5)); session.addPoint(point(6));
  assert.equal(session.completed[0].id, 1);
});
