import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { createViewCameras, fitViewCamera, resizeViewCamera } from '../src/view-camera.mjs';
import { distanceMeasurement } from '../src/measurement.mjs';
import { MeasurementSession } from '../src/measurement-session.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const box = new THREE.Box3(new THREE.Vector3(-10, -2, -20), new THREE.Vector3(10, 12, 20));
const point = (xyz, floor = 'ground') => ({ xyz, floor, name: 'model' });

test('orthographic plan projection has equal XY positions at different heights and north points up', () => {
  const { plan } = createViewCameras(); fitViewCamera(plan, box, 1.5, 'top');
  assert.equal(plan.isOrthographicCamera, true);
  const a = new THREE.Vector3(8, -2, -12).project(plan), b = new THREE.Vector3(8, 12, -12).project(plan);
  near(a.x, b.x); near(a.y, b.y); assert.notEqual(a.z, b.z);
  const center = box.getCenter(new THREE.Vector3());
  const north = center.clone().add(new THREE.Vector3(0, 0, -1)).project(plan);
  assert.ok(north.y > center.clone().project(plan).y);
});

test('plan fit includes the XY bounds in portrait and landscape and resize preserves scale and zoom', () => {
  for (const aspect of [.4, 1.5, 3]) {
    const { plan } = createViewCameras(); fitViewCamera(plan, box, aspect, 'top');
    for (const x of [-10, 10]) for (const y of [-2, 12]) for (const z of [-20, 20]) {
      const p = new THREE.Vector3(x, y, z).project(plan);
      assert.ok(Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && Math.abs(p.z) < 1);
    }
    plan.zoom = 2; const halfHeight = plan.top;
    resizeViewCamera(plan, .8);
    near(plan.top, halfHeight); near(plan.zoom, 2);
    const origin = new THREE.Vector3(0, 0, 0).project(plan);
    const east = new THREE.Vector3(1, 0, 0).project(plan), north = new THREE.Vector3(0, 0, -1).project(plan);
    near((east.x - origin.x) * 800, (north.y - origin.y) * 1000);
  }
});

test('plan distance excludes height, including vertical pairs and different floors', () => {
  const a = point([0, 0, 0]), b = point([3, 4, 12]);
  assert.equal(distanceMeasurement(a, b).value, 13);
  assert.equal(distanceMeasurement(a, b, 'plan').value, 5);
  assert.equal(distanceMeasurement(a, point([0, 0, 12]), 'plan').value, 0);
  assert.equal(distanceMeasurement(a, point([3, 4, 99], 'upper'), 'plan').value, 5);
  assert.equal(distanceMeasurement(a, b, 'plan').kind, 'plan');
});

test('a plan measurement keeps its distance mode when a later measurement uses 3D', () => {
  const session = new MeasurementSession();
  session.addPoint(point([0, 0, 0])); session.addPoint(point([3, 4, 12]), 'plan');
  session.addPoint(point([0, 0, 0])); session.addPoint(point([3, 4, 12]), 'space');
  assert.deepEqual(session.completed.map(r => distanceMeasurement(...r.points, r.distanceMode).value), [5, 13]);
  session.undo(); assert.equal(session.completed[0].distanceMode, 'plan');
});
