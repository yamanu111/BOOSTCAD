// Independent experimental reader for the measured RIKCAD PLN layouts.
// Source coordinates are meters with Z up. No CAD executable or export is used.
import { expandHeap, allocations, payload, u16, u32, hex } from './rof.mjs';
import earcut from '../vendor/earcut.js';
import {readElements} from './elements.mjs';

export const READER_VERSION = 'native-0.2.0';
const C = {
  mesh: '46ee2f8f3f6aac41a32b69e44dc6276d',
  terrain: 'b898e0c2e9a8bb4696c57200ead406f5',
  morph: '7b3c36e60e94eb4daf958b3b39e86bd2',
  body: 'ad8c58f158255c49820bf3bcf4651007',
  slab: '75125c944879d44187449d22d72ca486',
};
const CACHE_LINK = 'f876b988fd101e41891a5ecca8c7b2a7';
const BODY_LINK = '6bfa7fd50fc17f4fabe60fd52f2cc23e';
const FLOOR_LINK = '0312b67984ae884da9c620ead705e0bc';
const ZERO = '00000000000000000000000000000000';
function requireThat(ok, reason) { if (!ok) throw new Error(reason); }
function view(b) { return new DataView(b.buffer, b.byteOffset, b.byteLength); }
function count(b, p, stride, end = b.length) {
  requireThat(p >= 0 && p + 4 <= end, '配列ヘッダーが途中で切れています');
  const n = u32(b, p);
  requireThat(n <= 1000000 && p + 4 + n * stride <= end, '配列の範囲が不正です');
  return n;
}
function doubles(b, p, n, end = b.length) {
  requireThat(p >= 0 && p + n * 8 <= end, '座標が途中で切れています');
  const v = view(b), out = Array.from({ length: n }, (_, i) => v.getFloat64(p + i * 8, true));
  requireThat(out.every(x => Number.isFinite(x) && Math.abs(x) < 1e7), '座標が不正です');
  return out;
}
function bodyEnd(b) {
  requireThat(b.length >= 43 && hex(b.subarray(16, 19)) === '020000', '未対応のODBヘッダー');
  const end = 39 + u32(b, 35);
  requireThat(end >= 39 && end + 4 <= b.length && end + 4 + u32(b, end) === b.length, 'ODBレコードの長さが一致しません');
  return end;
}
function name(b, cls) {
  const end = bodyEnd(b);
  const at = cls === C.slab ? 57 : 53;
  requireThat(hex(b.subarray(at, at + 16)) === cls, '未対応の部材レイアウト');
  const baseVersion = u16(b, at + 20);
  let extra = 0;
  if (baseVersion === 3) {
    // Measured newer base layout: an additional 122-byte empty metadata block
    // precedes the element-ID frame. Do not interpret it as an ID or level.
    const metadata = at + 30;
    requireThat(metadata + 122 < end && u32(b, metadata + 16) === 98 &&
      b.subarray(metadata, metadata + 16).every(x => x === 0) &&
      b.subarray(metadata + 20, metadata + 122).every(x => x === 0), '未対応の部材メタデータ');
    extra = 122;
  } else requireThat(baseVersion === 2, '未対応の部材基本版');
  const textAt = (cls === C.slab ? 114 : 110) + extra;
  const idFrame = cls === C.morph ? '080100' : '070100';
  requireThat(end > textAt && hex(b.subarray(at + 30 + extra, at + 33 + extra)) === idFrame, '未対応の部材IDフレーム');
  const n = count(b, textAt - 4, 2, end), after = textAt + n * 2;
  requireThat(n > 0 && n < 512, '部材IDが不正です');
  return { text: new TextDecoder('utf-16le').decode(b.subarray(textAt, after)), after, end };
}
// Match only a measured, single-reference association in the checked ODB tail.
function linked(b, association) {
  const end = bodyEnd(b), found = [];
  for (let p = end + 6; p + 33 <= b.length; p++) {
    if ((b[p] === 0x11 || b[p] === 0x12) && hex(b.subarray(p + 1, p + 17)) === association) {
      found.push(hex(b.subarray(p + 17, p + 33)));
    }
  }
  requireThat(found.length === 1, '部材との関連付けが一意ではありません');
  return found[0];
}

export function activeRecords(heap) {
  const b = heap.bytes, all = allocations(b);
  const logical = new Map(all.map(r => [r.offset, r]));
  // Freed allocations keep their former GUID. Index only live directory
  // records so a later freed copy cannot shadow the current directory.
  const guids = new Map();
  for (const r of all) if (r.kind === 65002) {
    requireThat(!guids.has(r.guid), '圧縮グループの有効な一覧が重複しています');
    guids.set(r.guid, r);
  }
  const physical = new Map(heap.blocks.map(r => [r.physical, logical.get(r.offset)]));
  const groups = new Map(heap.groups.map(g => [g.physical, g]));
  requireThat(all[0]?.kind === 65000, '未対応のデータベースルート');
  const root = payload(b, all[0]);
  requireThat(root && root.length >= 20, 'データベースルートが不正です');
  const base = 32 + u32(root, 0) * 16;
  const dirs = all.filter(r => r.kind === 65003);
  requireThat(dirs.length === 1, '有効なデータ一覧を一意に確認できません');
  const directory = payload(b, dirs[0]), active = [], seen = new Set();
  function add(r, kind, extent, id) {
    requireThat(r && r.kind === kind && r.size === extent && r.guid === id, '有効データの識別子・位置・サイズが一致しません');
    requireThat(!seen.has(id), '有効データの識別子が重複しています');
    seen.add(id); active.push(r);
  }
  function visit(data, group = null) {
    requireThat(data && data.length >= 40 && (data.length - 40) % 30 === 0, '未対応のデータ一覧');
    for (let p = 40; p < data.length; p += 30) {
      const kind = u16(data, p), id = hex(data.subarray(p + 14, p + 30));
      if (kind === 65500 || kind === 65501 || id === ZERO || (group && kind >= 65000)) continue;
      requireThat(u32(data, p + 6) === 0, '64ビットのデータ位置には未対応です');
      const offset = u32(data, p + 2) * 16, extent = u32(data, p + 10) * 16;
      if (kind === 65400 && !group) {
        const g = groups.get(base + offset), meta = guids.get(id);
        requireThat(g && meta?.kind === 65002, '圧縮グループの一覧が見つかりません');
        visit(payload(b, meta), g);
      } else add(group ? logical.get(group.logical + offset) : physical.get(base + offset), kind, extent, id);
    }
  }
  visit(directory);
  return active;
}

export function terrainGeometry(b) {
  const end = bodyEnd(b), v = view(b);
  requireThat(hex(b.subarray(39, 44)) === '0100030000', '未対応の地形キャッシュ版');
  const n = count(b, 44, 24, end), positions = doubles(b, 48, n * 3, end);
  requireThat(n >= 3, '地形の頂点数が不足しています');
  let q = 48 + n * 24;
  const nt = count(b, q, 16, end), ts = q + 4; q = ts + nt * 16;
  const ne = count(b, q, 28, end), es = q + 4;
  const indices = [];
  for (let i = 0; i < nt; i++) {
    const p = ts + i * 16, flag = u32(b, p);
    if (flag === 65536) continue;
    requireThat(flag === 0, '未知の三角形フラグ');
    const edges = [];
    for (let j = 0; j < 3; j++) {
      const ref = v.getInt32(p + 4 + j * 4, true), ei = Math.abs(ref) - 1;
      requireThat(ei >= 0 && ei < ne, '三角形の辺番号が不正です');
      const ep = es + ei * 28, ef = u32(b, ep);
      // Retained constraint/contour edges have measured flags 2, 4 and 12;
      // flag 1 denotes an unused slot and must never be referenced.
      requireThat(ef === 0 || ef === 2 || ef === 4 || ef === 12, '三角形が無効な辺を参照しています');
      let a = u32(b, ep + 12), c = u32(b, ep + 16);
      requireThat(a < n && c < n && a !== c, '辺の頂点番号が不正です');
      if (ref < 0) [a, c] = [c, a];
      edges.push([a, c]);
    }
    requireThat(edges.every((e, j) => e[1] === edges[(j + 1) % 3][0]), '三角形の辺が閉じていません');
    indices.push(...edges.map(e => e[0]));
  }
  requireThat(indices.length > 0, '有効な三角形がありません');
  return { positions, indices };
}

export function morphGeometry(b, matrix) {
  const end = bodyEnd(b), v = view(b);
  requireThat(hex(b.subarray(39, 56)) === '04008200030000000107002e0004000800', '未対応のモーフ形状版');
  const n = count(b, 195, 24, end), local = doubles(b, 199, n * 3, end);
  let q = 199 + n * 24;
  requireThat(count(b, q, 1, end) === 0, '追加の頂点データには未対応です'); q += 4;
  const ne = count(b, q, 24, end), es = q + 4; q = es + ne * 24;
  const nr = count(b, q, 4, end), rs = q + 4; q = rs + nr * 4;
  const nn = count(b, q, 24, end), ns = q + 4; q = ns + nn * 24;
  const np = count(b, q, 40, end), ps = q + 4;
  requireThat(n >= 3 && ne >= 3 && nn > 0 && np > 0, 'モーフの形状データが不足しています');
  const indices = [], normals = doubles(b, ns, nn * 3, end);
  for (let i = 0; i < np; i++) {
    const p = ps + i * 40, normal = Math.abs(v.getInt32(p + 20, true)) - 1;
    const first = u32(b, p + 24), last = u32(b, p + 28);
    requireThat(normal < nn && normal >= 0 && first <= last && last < nr, '面の範囲が不正です');
    const rings = [[]], directed = [[]];
    for (let j = first; j <= last; j++) {
      const ref = v.getInt32(rs + j * 4, true);
      if (!ref) { rings.push([]); directed.push([]); continue; }
      const e = Math.abs(ref) - 1;
      requireThat(e >= 0 && e < ne, '面の辺番号が不正です');
      const ep = es + e * 24;
      let a = u32(b, ep + 8), c = u32(b, ep + 12);
      requireThat(a < n && c < n && a !== c, '面の頂点番号が不正です');
      if (ref < 0) [a, c] = [c, a];
      rings.at(-1).push(a); directed.at(-1).push([a, c]);
    }
    requireThat(rings.every((ring, ri) => ring.length >= 3 && directed[ri].every((e, j, ar) => e[1] === ar[(j + 1) % ar.length][0])), '面の輪郭が閉じていません');
    const normalXYZ = normals.slice(normal * 3, normal * 3 + 3);
    const drop = normalXYZ.map(Math.abs).indexOf(Math.max(...normalXYZ.map(Math.abs)));
    const axes = [0, 1, 2].filter(a => a !== drop), flat = [], ids = [], holes = [];
    for (let ri = 0; ri < rings.length; ri++) {
      if (ri) holes.push(ids.length);
      for (const id of rings[ri]) { ids.push(id); flat.push(local[id * 3 + axes[0]], local[id * 3 + axes[1]]); }
    }
    const tris = earcut(flat, holes, 2);
    requireThat(tris.length > 0 && tris.length % 3 === 0, '面の三角形分割に失敗しました');
    indices.push(...tris.map(t => ids[t]));
  }
  const positions = [];
  for (let i = 0; i < n; i++) {
    const [x, y, z] = local.slice(i * 3, i * 3 + 3);
    for (let row = 0; row < 3; row++) positions.push(matrix[row * 4] * x + matrix[row * 4 + 1] * y + matrix[row * 4 + 2] * z + matrix[row * 4 + 3]);
  }
  return { positions, indices };
}

export function slabGeometry(b, info) {
  const { after, end } = info;
  const level = doubles(b, after, 1, end)[0], thickness = doubles(b, after + 9, 1, end)[0];
  // Measured reference-plane field agrees with APISlabRefPlane_Bottom = 3.
  requireThat(b[after + 8] === 3 && thickness > 0 && thickness < 1000, '底面基準以外のスラブには未対応です');
  requireThat(Math.abs(doubles(b, after + 17, 1, end)[0] - thickness) < 1e-9, '複雑なスラブ厚には未対応です');
  const candidates = [];
  for (const p of [after + 168, after + 272]) {
    if (p + 53 >= end || hex(b.subarray(p, p + 2)) !== '0201' || b[p + 6] !== 1 || u16(b, p + 7) !== 31) continue;
    const frameEnd = p + 6 + u32(b, p + 2);
    if (frameEnd > end) continue;
    const n = count(b, p + 41, 16, frameEnd), arcs = u32(b, p + 45), nc = u32(b, p + 49);
    requireThat(arcs === 0 && nc > 0 && nc < 1024 && n >= 4, '曲線スラブには未対応です');
    const coordinates = doubles(b, p + 53, (n + 1) * 2, frameEnd);
    const ep = p + 53 + (n + 1) * 16;
    requireThat(ep + 4 + nc * 4 <= frameEnd && u32(b, ep) === 0, '輪郭データが不正です');
    const rings = []; let first = 1;
    for (let i = 0; i < nc; i++) {
      const last = u32(b, ep + 4 + i * 4);
      requireThat(last <= n && last - first >= 3, '輪郭の終点が不正です');
      requireThat(Math.hypot(coordinates[first * 2] - coordinates[last * 2], coordinates[first * 2 + 1] - coordinates[last * 2 + 1]) < 1e-8, 'スラブ輪郭が閉じていません');
      rings.push(coordinates.slice(first * 2, last * 2)); first = last + 1;
    }
    requireThat(first === n + 1, '輪郭の頂点数が一致しません');
    const flat = rings.flat(), xs = [], ys = [];
    for (let i = 0; i < flat.length; i += 2) { xs.push(flat[i]); ys.push(flat[i + 1]); }
    const bbox = doubles(b, p + 9, 4, frameEnd);
    const measured = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    requireThat(bbox.every((x, i) => Math.abs(x - measured[i]) < 1e-7), '輪郭の外接範囲が一致しません');
    candidates.push(rings);
  }
  requireThat(candidates.length === 1, 'スラブ輪郭を一意に確認できません');
  const rings = candidates[0], flat = [], holes = [], positions = [], indices = [];
  for (let i = 0; i < rings.length; i++) { if (i) holes.push(flat.length / 2); flat.push(...rings[i]); }
  const n = flat.length / 2, tris = earcut(flat, holes, 2);
  requireThat(tris.length > 0, 'スラブの面分割に失敗しました');
  for (const z of [level, level + thickness]) for (let i = 0; i < n; i++) positions.push(flat[i * 2], flat[i * 2 + 1], z);
  for (let i = 0; i < tris.length; i += 3) { indices.push(tris[i + 2], tris[i + 1], tris[i], tris[i] + n, tris[i + 1] + n, tris[i + 2] + n); }
  let offset = 0;
  for (const ring of rings) {
    const rn = ring.length / 2;
    for (let i = 0; i < rn; i++) { const a = offset + i, c = offset + (i + 1) % rn; indices.push(a, c, c + n, a, c + n, a + n); }
    offset += rn;
  }
  return { positions, indices };
}

export function readPLN(input, progress = () => {}) {
  const started = performance.now();
  requireThat(input.byteLength <= 160 * 1024 * 1024, '試作版の上限は160 MiBです');
  progress('PLNの圧縮を展開しています');
  const heap = expandHeap(new Uint8Array(input));
  progress('現在の保存状態を確認しています');
  const active = activeRecords(heap), records = new Map(), counts = {};
  const wanted = new Set([411, 412, 455, 456, 337, 437, 439, 442, 198, 355, 260]);
  for (const r of active) {
    counts[r.kind] = (counts[r.kind] || 0) + 1;
    if (!wanted.has(r.kind)) continue;
    const data = payload(heap.bytes, r);
    requireThat(data && data.length >= 43, '形状レコードが不正です');
    records.set(r.guid, { ...r, data, cls: hex(data.subarray(0, 16)) });
  }
  progress('保存された頂点と面を復元しています');
  const objects = [], failures = [];
  for (const r of records.values()) {
    if (![C.mesh, C.morph, C.slab].includes(r.cls)) continue;
    try {
      const info = name(r.data, r.cls);
      const floor = linked(r.data, FLOOR_LINK);
      let geometry, kind;
      if (r.cls === C.mesh) {
        const cache = records.get(linked(r.data, CACHE_LINK));
        requireThat(cache?.cls === C.terrain && linked(cache.data, CACHE_LINK) === r.guid, '地形キャッシュとの関連が一致しません');
        geometry = terrainGeometry(cache.data);
        const level = doubles(r.data, info.after, 1, info.end)[0];
        for (let i = 2; i < geometry.positions.length; i += 3) geometry.positions[i] += level;
        kind = 'terrain';
      } else if (r.cls === C.morph) {
        requireThat(hex(r.data.subarray(info.after, info.after + 5)) === '0004008200', '未対応のモーフ変換版');
        const matrix = doubles(r.data, info.after + 5, 12, info.end);
        const body = records.get(linked(r.data, BODY_LINK));
        requireThat(body?.cls === C.body && linked(body.data, BODY_LINK) === r.guid, 'モーフ形状との関連が一致しません');
        geometry = morphGeometry(body.data, matrix); kind = 'morph';
      } else { geometry = slabGeometry(r.data, info); kind = 'slab'; }
      objects.push({ id: r.guid, name: info.text, kind, floor, positions: new Float64Array(geometry.positions), indices: new Uint32Array(geometry.indices) });
    } catch (error) { failures.push({ id: r.guid, message: error.message }); }
  }
  const elements=readElements(records);objects.push(...elements.objects);failures.push(...elements.failures);
  return {
    version: READER_VERSION, objects, failures, parts:elements.parts, warnings:elements.warnings,
    stats: { sourceBytes: input.byteLength, activeRecords: active.length, parseMs: performance.now() - started,
      terrain: objects.filter(o => o.kind === 'terrain').length, morph: objects.filter(o => o.kind === 'morph').length,
      slabs: objects.filter(o => o.kind === 'slab').length,
      walls:elements.objects.length, windows:0, products:0, excludedPlants:elements.excluded,
      triangles: objects.reduce((sum, o) => sum + o.indices.length / 3, 0),
      unsupported: { walls: (counts[437] || 0)-elements.objects.length, objects: elements.parts.filter(p=>p.kind==='product').length, windows:elements.parts.filter(p=>p.kind==='window').length } },
    coordinateNote: '保存座標から復元。フロア基準の絶対標高はRIKCADとの照合前です。',
  };
}
