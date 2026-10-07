export function measure(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  return { distance: Math.hypot(dx, dy, dz), horizontal: Math.hypot(dx, dy), height: Math.abs(dz), dx, dy, dz };
}

export function distanceMeasurement(a, b, distanceMode = 'space') {
  const result = measure(a.xyz, b.xyz);
  const kind = distanceMode === 'plan' ? 'plan' : a.floor === b.floor ? 'space' : 'horizontal';
  return { ...result, kind, value: kind === 'space' ? result.distance : result.horizontal };
}
