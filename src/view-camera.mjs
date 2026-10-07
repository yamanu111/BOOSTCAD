import * as THREE from '../vendor/three.module.js';

export function createViewCameras() {
  const perspective = new THREE.PerspectiveCamera(38, 1, .01, 10000);
  const plan = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 10000);
  // Native +Y points up the screen; native Z is the viewing direction.
  plan.up.set(0, 0, -1);
  return { perspective, plan };
}

export function resizeViewCamera(camera, aspect) {
  if (camera.isOrthographicCamera) {
    const halfHeight = (camera.top - camera.bottom) / 2;
    camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect;
  } else camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

export function fitViewCamera(camera, box, aspect, view) {
  const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 1);
  let distance;
  if (camera.isOrthographicCamera) {
    const halfHeight = Math.max(size.z, size.x / aspect, 1) * 1.15 / 2;
    camera.top = halfHeight; camera.bottom = -halfHeight;
    distance = span * 2 + 1;
    camera.position.copy(center).add(new THREE.Vector3(0, distance, 0));
  } else {
    distance = span / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.25 / Math.min(aspect, 1);
    const direction = view === 'front' ? new THREE.Vector3(0, .01, 1) : new THREE.Vector3(1, .85, 1.1).normalize();
    camera.position.copy(center).addScaledVector(direction, distance);
  }
  camera.zoom = 1; camera.near = Math.max(.001, span / 10000); camera.far = distance + span * 100;
  resizeViewCamera(camera, aspect);
  camera.lookAt(center); camera.updateMatrixWorld(true);
  return center;
}
