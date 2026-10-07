import { prism } from './solid.mjs';
import { wallGeometry } from './elements.mjs';
import { completeBrowserModel } from './browser-model.mjs';

// Original geometry: no customer plan or commercial library content.
export function createDemoModel() {
  const floor = 'demo-ground', objects = [];
  function add(name, kind, geometry) {
    objects.push({ id: `demo-${objects.length}`, name, kind, floor,
      positions: new Float64Array(geometry.positions), indices: new Uint32Array(geometry.indices) });
  }
  add('デモの地面', 'terrain', prism([[-6, -5, 6, -5, 6, 5, -6, 5]], -.1, 0));
  add('デモの床', 'slab', prism([[-3, -2, 3, -2, 3, 2, -3, 2]], 0, .15));
  add('デモの段差', 'slab', prism([[3.5, -2, 5, -2, 5, -.5, 3.5, -.5]], 0, .45));
  const walls = [
    { name: 'デモの南壁', length: 6, matrix: [1, 0, 0, -3, 0, 1, 0, -2, 0, 0, 1, 0] },
    { name: 'デモの北壁', length: 6, matrix: [1, 0, 0, -3, 0, -1, 0, 2, 0, 0, 1, 0] },
    { name: 'デモの西壁', length: 4, matrix: [0, 1, 0, -3, 1, 0, 0, -2, 0, 0, 1, 0] },
    { name: 'デモの東壁', length: 4, matrix: [0, -1, 0, 3, 1, 0, 0, -2, 0, 0, 1, 0] }
  ];
  const opening = { id: 'demo-opening', name: 'デモの窓', kind: 'window', floor, width: 1.6, height: 1.2, center: 3, bottom: 1,
    matrix: [1, 0, 0, 0, 0, 0, 1, -2, 0, 1, 0, 1] };
  for (const [i, wall] of walls.entries()) add(wall.name, 'wall', wallGeometry({ ...wall, base: .15, height: 2.8,
    footprint: [0, 0, wall.length, 0, wall.length, .18, 0, .18] }, i === 0 ? [opening] : []));
  return completeBrowserModel({ demo: true, objects, parts: [opening], failures: [], warnings: [],
    coordinateNote: '操作確認用に作成したデモ形状です。',
    stats: { sourceBytes: 0, activeRecords: 0, parseMs: 0, terrain: 1, slabs: 2, morph: 0, walls: 4, windows: 0, products: 0, excludedPlants: 0,
      triangles: 0, unsupported: { walls: 0, objects: 0, windows: 0 } } });
}
