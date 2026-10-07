import { transformed } from './solid.mjs';

export function openingGeometry(part) {
  const { width, height, matrix } = part;
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) ||
      !Array.isArray(matrix) || matrix.length !== 12 || !matrix.every(Number.isFinite)) throw Error('窓開口の寸法・配置が不正です');
  // A dimension plane at the saved wall reference, not a manufacturer's frame or glass.
  return transformed({ positions: [-width / 2, 0, 0, width / 2, 0, 0, width / 2, height, 0, -width / 2, height, 0], indices: [0, 1, 2, 0, 2, 3] }, matrix);
}

export function completeBrowserModel(result) {
  const missing = new Map();
  for (const part of result.parts || []) {
    if (part.kind === 'window') {
      try {
        const geometry = openingGeometry(part);
        result.objects.push({ id: part.id, name: `${part.name}（窓開口）`, kind: 'window', floor: part.floor,
          geometryBasis: 'opening', positions: new Float64Array(geometry.positions), indices: new Uint32Array(geometry.indices) });
      } catch (error) { result.failures.push({ id: part.id, name: part.name, message: error.message }); }
    } else missing.set(part.library, (missing.get(part.library) || 0) + 1);
  }
  result.missingParts = [...missing].map(([name, count]) => ({ name, count }));
  result.stats.windows = result.objects.filter(o => o.kind === 'window').length;
  result.stats.products = 0; result.stats.libraryMs = 0;
  result.stats.unsupported.windows = (result.parts || []).filter(p => p.kind === 'window').length - result.stats.windows;
  result.stats.unsupported.objects = (result.parts || []).filter(p => p.kind === 'product').length;
  result.stats.triangles = result.objects.reduce((n, o) => n + o.indices.length / 3, 0);
  result.warnings.push('窓は保存された開口寸法の矩形面です。窓枠・ガラス・メーカー部品の形状は再現していません。');
  delete result.parts;
  return result;
}
