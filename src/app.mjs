import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { measure, distanceMeasurement } from './measurement.mjs';
import { MeasurementSession } from './measurement-session.mjs';
import { MeasurementOverlay } from './measurement-overlay.mjs';
import { ElevationSession, elevationDifference } from './elevation-session.mjs';
import { ElevationOverlay } from './elevation-overlay.mjs';
import { createViewCameras, fitViewCamera, resizeViewCamera } from './view-camera.mjs';
import { createDemoModel } from './demo-model.mjs';

const $ = id => document.getElementById(id);
const viewport = $('viewport');
let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); }
catch { $('empty').querySelector('p').textContent = '3D表示に必要なWebGLを利用できません。ChromeまたはEdgeのグラフィック設定を確認してください。'; throw new Error('WebGL unavailable'); }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0xf2f5f4); renderer.outputColorSpace = THREE.SRGBColorSpace;
$('canvas-host').append(renderer.domElement);
const scene = new THREE.Scene(), cameras = createViewCameras();
let camera = cameras.perspective;
camera.position.set(30, 24, 30);
let controls = createControls(camera);
scene.add(new THREE.HemisphereLight(0xffffff, 0xb1c5b3, 2.3));
const sun = new THREE.DirectionalLight(0xffffff, 2.1); sun.position.set(-20, 50, 30); scene.add(sun);
const model = new THREE.Group(); scene.add(model);
const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
const v3 = new THREE.Vector3();
let meshes = [], mode = 'orbit', selectedView = 'iso', worker = null;
const measurements = new MeasurementSession();
const elevations = new ElevationSession();
let activeTool = 'measure';
let cursor = null;
let result = null, started = 0, requestId = 0, currentName = '', down = null, hover = null;
let grid = null, toastTimer;
const renderPoint = xyz => new THREE.Vector3(xyz[0], xyz[2], -xyz[1]);
const sourcePoint = v => [v.x, -v.z, v.y];
const project = xyz => {
  const pos = renderPoint(xyz).project(camera);
  return { x: (pos.x + 1) / 2 * viewport.clientWidth, y: (1 - pos.y) / 2 * viewport.clientHeight, visible: pos.z >= -1 && pos.z <= 1 };
};
const overlay = new MeasurementOverlay($('measurement-overlay'), $('measurement-labels'), project, (a, b, record) => {
  const m = distanceMeasurement(a, b, displayDistanceMode(record));
  return `${m.kind === 'plan' ? '平面 ' : m.kind === 'horizontal' ? '水平 ' : ''}${format(m.value)} ${$('unit').value}`;
});
const elevationOverlay = new ElevationOverlay($('measurement-overlay'), $('measurement-labels'), project,
  (a, b) => `${signedHeight(elevationDifference(a, b))} ${$('unit').value}`);
const labels = { terrain: '地形', slab: 'スラブ', morph: 'モーフ' };

function toast(message, persist = false) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
  if (!persist) toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}
function dispose(group) {
  for (const child of [...group.children]) {
    child.traverse(o => { o.geometry?.dispose(); if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material?.dispose(); });
    group.remove(child);
  }
}
function visibleMeshes() { return meshes.filter(m => m.visible); }
function createControls(viewCamera) {
  const next = new OrbitControls(viewCamera, renderer.domElement);
  next.enableDamping = true; next.dampingFactor = .12;
  if (viewCamera.isOrthographicCamera) {
    next.enableRotate = false; next.screenSpacePanning = true;
    next.mouseButtons.LEFT = THREE.MOUSE.PAN;
    next.touches.ONE = THREE.TOUCH.PAN; next.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  }
  next.addEventListener('start', clearCursor);
  return next;
}
function isPlanView() { return selectedView === 'top'; }
function displayDistanceMode(record) { return isPlanView() || record?.distanceMode === 'plan' ? 'plan' : 'space'; }
function fit(view = selectedView) {
  clearCursor();
  selectedView = view;
  const box = new THREE.Box3();
  for (const m of visibleMeshes()) box.expandByObject(m);
  if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
  controls.dispose(); camera = isPlanView() ? cameras.plan : cameras.perspective;
  const center = fitViewCamera(camera, box, viewport.clientWidth / Math.max(viewport.clientHeight, 1), view);
  controls = createControls(camera); controls.target.copy(center); controls.update();
  for (const button of document.querySelectorAll('.view-toolbar button[data-view]')) {
    button.classList.toggle('selected', button.dataset.view === view);
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
  document.body.dataset.projection = camera.isOrthographicCamera ? 'orthographic' : 'perspective';
  document.body.dataset.cameraView = view;
  updateInstruction(); updateMeasurements();
}
function updateLabels() {
  overlay.update(measurements.pending, mode === 'measure' ? cursor : null, isMeasuring() ? cursor : null);
  elevationOverlay.update(elevations.reference, mode === 'elevation' ? cursor : null);
}
const resize = new ResizeObserver(() => {
  clearCursor();
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h); resizeViewCamera(camera, w / Math.max(h, 1));
}); resize.observe(viewport);
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); updateLabels(); });

function format(value) {
  const mm = $('unit').value === 'mm';
  return (value * (mm ? 1000 : 1)).toLocaleString('ja-JP', { minimumFractionDigits: mm ? 1 : 3, maximumFractionDigits: mm ? 1 : 3 });
}
function signedHeight(value) {
  const number = format(Math.abs(value));
  const sign = Number(number.replaceAll(',', '')) === 0 ? '±' : value < 0 ? '−' : '+';
  return sign + number;
}
function updateElevationDetails() {
  const reference = elevations.reference, target = elevations.completed.at(-1)?.points[1];
  const difference = reference && target ? elevationDifference(reference, target) : null;
  $('length-details').hidden = activeTool === 'elevation';
  $('elevation-details').hidden = activeTool !== 'elevation';
  $('elevation-delta').textContent = difference === null ? '—' : signedHeight(difference);
  $('elevation-direction').textContent = difference === null ? reference ? '計測する点をクリックしてください' : '最初に基準点をクリック'
    : difference > 0 ? '基準点より上' : difference < 0 ? '基準点より下' : '基準点と同じ高さ';
  for (const [id, point, placeholder] of [['elevation-reference', reference, '基準点を選択'], ['elevation-point', target, '計測点を選択']]) {
    $(id).querySelector('strong').textContent = point ? `${id === 'elevation-reference' ? '基準点' : '計測点'} · ${point.name}` : placeholder;
    $(id).querySelector('small').textContent = point ? `${point.snap ? '頂点' : '面上'} · Z ${point.xyz[2].toFixed(3)} m / フロア基準`
      : id === 'elevation-reference' ? 'この点を ±0 として測ります' : '続けて何点でも選択できます';
  }
}
function updateMeasurements() {
  const points = measurements.points;
  const sameFloor = points.length === 2 && points[0].floor === points[1].floor;
  const measurement = points.length === 2 ? measure(points[0].xyz, points[1].xyz) : null;
  const distance = points.length === 2 ? distanceMeasurement(...points, displayDistanceMode(measurements.completed.at(-1))) : null;
  $('distance-caption').textContent = distance?.kind === 'plan' || !distance && isPlanView() ? '平面距離' : distance?.kind === 'horizontal' ? '水平距離' : '2点間の距離';
  $('distance').textContent = distance ? format(distance.value) : '—';
  $('horizontal').textContent = measurement ? format(measurement.horizontal) : '—';
  $('height').textContent = measurement && sameFloor ? format(measurement.height) : '—';
  for (const el of document.querySelectorAll('.unit-label')) el.textContent = $('unit').value;
  $('measure-note').textContent = measurement && !sameFloor ? 'フロアが異なるため、水平距離のみ表示しています。' : '保存座標で計測します。異なるフロア間の高低差は計測できません。';
  if (isPlanView()) $('measure-note').textContent = '平面図では高さを含めず、XYの平面距離で計測します。';
  else if (distance?.kind === 'plan') $('measure-note').textContent = '平面図で確定した計測のため、平面距離を表示しています。';
  if (activeTool === 'elevation') $('measure-note').textContent = '基準点は固定されます。同一フロア内の保存座標で計測します。一括クリアで基準点もリセットできます。';
  for (const [i, id] of ['point-a', 'point-b'].entries()) {
    const el = $(id), point = points[i];
    el.querySelector('strong').textContent = point ? point.name : i ? '終点を選択' : '始点を選択';
    el.querySelector('small').textContent = point ? `${point.snap ? '頂点' : '面上'} · Z ${point.xyz[2].toFixed(3)} m / フロア基準` : 'モデル上をクリック';
  }
  updateElevationDetails();
  const total = measurements.completed.length + elevations.completed.length;
  $('undo').disabled = activeTool === 'elevation' ? !elevations.reference : points.length === 0;
  $('clear').disabled = !measurements.pending && !total && !elevations.reference;
  $('measurement-count').textContent = total;
  $('measurement-empty').hidden = total > 0;
  const list = $('measurement-list'); list.replaceChildren();
  for (const record of elevations.completed.slice().reverse()) {
    const [reference, target] = record.points;
    const item = document.createElement('li'), title = document.createElement('strong'), detail = document.createElement('small');
    item.dataset.elevationId = record.id;
    title.textContent = `高低差 ${record.id} · ${signedHeight(elevationDifference(reference, target))} ${$('unit').value}`;
    detail.textContent = `${target.name} / 基準点：${reference.name}`;
    item.append(title, detail); list.append(item);
  }
  for (const record of measurements.completed.slice().reverse()) {
    const [a, b] = record.points, m = measure(a.xyz, b.xyz), sameFloor = a.floor === b.floor;
    const distance = distanceMeasurement(a, b, displayDistanceMode(record));
    const item = document.createElement('li'), title = document.createElement('strong'), detail = document.createElement('small');
    item.dataset.measurementId = record.id;
    title.textContent = `${distance.kind === 'plan' ? '平面距離' : '長さ'} ${record.id} · ${distance.kind === 'horizontal' ? '水平 ' : ''}${format(distance.value)} ${$('unit').value}`;
    detail.textContent = sameFloor ? `水平 ${format(m.horizontal)} / 高低差 ${format(m.height)} ${$('unit').value}` : 'フロアが異なるため水平距離のみ';
    item.append(title, detail); list.append(item);
  }
  overlay.setRecords(measurements.completed); elevationOverlay.setRecords(elevations.completed); updateLabels();
  document.body.dataset.measurePoints = points.length;
  document.body.dataset.measurements = measurements.completed.length;
  document.body.dataset.measurePending = String(!!measurements.pending);
  document.body.dataset.elevations = elevations.completed.length;
  document.body.dataset.elevationReference = String(!!elevations.reference);
}
function clearCursor() { hover = null; cursor = null; }
function isMeasuring() { return mode === 'measure' || mode === 'elevation'; }
function updateInstruction() {
  $('instruction').innerHTML = mode === 'elevation' ? '最初の1点が基準点です。<br>続けて点を選ぶと高低差を追加。'
    : mode === 'measure' ? isPlanView() ? '2点を選んで平面距離を計測。<br>高さは距離に含めません。' : '2点を選ぶたびに計測を追加。<br>光る線がカーソルに追従します。'
      : isPlanView() ? 'ドラッグで平面を移動。<br>ホイールで拡大・縮小できます。' : 'ドラッグで回転。ホイールで拡大。<br>右ドラッグで移動できます。';
}
function setMode(value) {
  mode = value; if (isMeasuring()) activeTool = value;
  viewport.classList.toggle('measuring', isMeasuring());
  for (const id of ['orbit', 'measure', 'elevation']) { $(id).classList.toggle('selected', id === value); $(id).setAttribute('aria-pressed', String(id === value)); }
  updateInstruction();
  clearCursor(); updateMeasurements();
}
$('orbit').onclick = () => setMode('orbit'); $('measure').onclick = () => setMode('measure'); $('elevation').onclick = () => setMode('elevation');
$('clear').onclick = () => { measurements.clear(); elevations.clear(); clearCursor(); updateMeasurements(); };
$('undo').onclick = () => { (activeTool === 'elevation' ? elevations : measurements).undo(); clearCursor(); updateMeasurements(); };
$('unit').onchange = updateMeasurements;
$('snap').onchange = () => { clearCursor(); updateLabels(); };
$('fit').onclick = () => fit();
for (const button of document.querySelectorAll('.view-toolbar button[data-view]')) button.onclick = () => fit(button.dataset.view);
for (const input of document.querySelectorAll('[data-layer]')) input.onchange = () => {
  for (const mesh of meshes) if (mesh.userData.source.kind === input.dataset.layer) mesh.visible = input.checked;
  clearCursor();
};
$('edges').onchange = () => { for (const mesh of meshes) mesh.children.forEach(c => { c.visible = $('edges').checked; }); };

function hit(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect(), x = clientX - rect.left, y = clientY - rect.top;
  pointer.set(x / rect.width * 2 - 1, 1 - y / rect.height * 2); raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(visibleMeshes(), false);
  if (!hits.length) return null;
  const picked = hits[0], source = picked.object.userData.source;
  let xyz = sourcePoint(picked.point), snap = false, screen = [x, y];
  if ($('snap').checked && picked.face) {
    let best = 12;
    for (const id of [picked.face.a, picked.face.b, picked.face.c]) {
      const vertex = Array.from(source.positions.subarray(id * 3, id * 3 + 3));
      const p = renderPoint(vertex).project(camera), sx = (p.x + 1) / 2 * rect.width, sy = (1 - p.y) / 2 * rect.height;
      const d = Math.hypot(sx - x, sy - y);
      if (p.z >= -1 && p.z <= 1 && d < best) { best = d; xyz = vertex; snap = true; screen = [sx, sy]; }
    }
  }
  return { xyz, snap, screen, name: source.library ? source.library.replace(/\.gsm$/i,'') : source.name, id: source.id, floor: source.floor };
}
renderer.domElement.addEventListener('pointerdown', event => { down = { x: event.clientX, y: event.clientY, button: event.button }; });
renderer.domElement.addEventListener('pointermove', event => {
  if (!isMeasuring() || event.buttons || worker) { clearCursor(); return; }
  hover = hit(event.clientX, event.clientY);
  const rect = renderer.domElement.getBoundingClientRect();
  cursor = { point: hover, screen: { x: event.clientX - rect.left, y: event.clientY - rect.top } };
});
renderer.domElement.addEventListener('pointerleave', clearCursor);
renderer.domElement.addEventListener('pointerup', event => {
  const initial = down; down = null;
  if (!isMeasuring() || !initial || initial.button !== 0 || Math.hypot(event.clientX - initial.x, event.clientY - initial.y) > 4 || worker) return;
  const picked = hit(event.clientX, event.clientY); if (!picked) { toast('表示されている形状の面をクリックしてください。'); return; }
  if (mode === 'elevation') {
    if (!elevations.addPoint(picked)) toast('基準点と同じフロアの点を選んでください。別フロアとの高低差は計測できません。');
  } else measurements.addPoint(picked, isPlanView() ? 'plan' : 'space');
  clearCursor(); updateMeasurements();
});
renderer.domElement.addEventListener('pointercancel', () => { down = null; });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { if (mode !== 'elevation') measurements.cancelPending(); clearCursor(); updateMeasurements(); return; }
  if (event.target.matches('input,select,button')) return;
  if (event.key.toLowerCase() === 'm') setMode('measure');
  if (event.key.toLowerCase() === 'h') setMode('elevation');
  if (event.key.toLowerCase() === 'v') setMode('orbit');
  if (event.key.toLowerCase() === 'f') fit();
});

function showResult(parsed) {
  result = parsed; const palette = { terrain: [0xa2bba1, 0xb6c7ab, 0x91b298], slab: [0xb6b4a9, 0xc9c8bc, 0xa9b1ab], morph: [0x799aa4, 0x87a4ad, 0x65848f], wall:[0xd9d4c8,0xe1ddd3,0xd0ccc2], window:[0x90b4c1,0x9dc0cb,0x83a8b6], product:[0x77928a,0x8b9f97,0x6e8582] };
  parsed.objects.forEach((source, index) => {
    const positions = new Float32Array(source.positions.length);
    for (let i = 0; i < source.positions.length; i += 3) { positions[i] = source.positions[i]; positions[i + 1] = source.positions[i + 2]; positions[i + 2] = -source.positions[i + 1]; }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setIndex(new THREE.BufferAttribute(source.indices, 1)); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: palette[source.kind][index % 3], roughness: .88, side: THREE.DoubleSide }));
    mesh.userData.source = source;
    mesh.visible = document.querySelector(`[data-layer="${source.kind}"]`).checked;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 28), new THREE.LineBasicMaterial({ color: 0x617b6d, transparent: true, opacity: .45 }));
    edges.visible = $('edges').checked; mesh.add(edges); model.add(mesh); meshes.push(mesh);
  });
  const box = new THREE.Box3().setFromObject(model);
  if (!box.isEmpty()) {
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3()), span = Math.ceil(Math.max(size.x, size.z, 5) / 5) * 5;
    grid = new THREE.GridHelper(span * 1.6, Math.ceil(span * 1.6), 0xc2d0c5, 0xdde5dd);
    grid.position.set(center.x, box.min.y - .02, center.z); grid.material.transparent = true; grid.material.opacity = .5; scene.add(grid);
  }
  const stats = parsed.stats;
  $('object-count').textContent = parsed.objects.length;
  $('terrain-count').textContent = stats.terrain; $('slab-count').textContent = stats.slabs; $('morph-count').textContent = stats.morph;
  $('wall-count').textContent=stats.walls; $('window-count').textContent=stats.windows; $('product-count').textContent=stats.products;
  $('coverage-summary').textContent = `壁 ${stats.walls}・窓開口 ${stats.windows} を復元。窓枠・ガラス・メーカー部品・植栽は表示しません。屋根や壁の上端トリムは未対応です。`;
  const missing=$('missing-parts');missing.replaceChildren();missing.hidden=!parsed.missingParts?.length;
  if(!missing.hidden){const title=document.createElement('strong');title.textContent='未表示のメーカー部品（ライブラリ不使用）';missing.append(title);for(const p of parsed.missingParts){const line=document.createElement('div');line.textContent=`${p.name.replace(/\.gsm$/i,'')} × ${p.count}`;missing.append(line);}}
  $('coverage-detail').textContent = `有効データ：${stats.activeRecords.toLocaleString()} 件\n三角形：${stats.triangles.toLocaleString()} 面\nPLN解析：${(stats.parseMs / 1000).toFixed(3)} 秒\n植栽の除外：${stats.excludedPlants} 件\n${parsed.coordinateNote}\n曲面は面分割した形状で計測します。\nスラブのトリム・接合・ソリッド演算、地形の側面・底面は未対応です。\n\n`+(parsed.warnings||[]).join('\n')+(parsed.failures.length ? `\n\n復元できなかった形状 ${parsed.failures.length} 件：\n${parsed.failures.map(x => `${x.name||x.id.slice(0, 8)}: ${x.message}`).join('\n')}` : '\n対応する形状の構造チェック：エラーなし');
  $('loadtime').textContent = `表示 ${( (performance.now() - started) / 1000).toFixed(2)} 秒`;
  $('filemeta').textContent = parsed.demo ? `自作の操作確認用デモ · ${parsed.objects.length} 形状` : `${(stats.sourceBytes / 1024 / 1024).toFixed(1)} MB · PLNから直接復元 · ${parsed.objects.length} 形状`;
  $('scene-status').textContent = `${parsed.objects.length} 形状 / ${stats.triangles.toLocaleString()} 面 · 一部形状の表示`;
  $('empty').hidden = parsed.objects.length > 0;
  if (!parsed.objects.length) toast('このPLNから対応する形状を復元できませんでした。詳細を確認してください。', true);
  fit('iso');
  document.body.dataset.state = 'ready'; document.body.dataset.modelObjects = parsed.objects.length;
}
function reset() {
  dispose(model); meshes = []; result = null; measurements.clear(); elevations.clear(); clearCursor(); updateMeasurements();
  if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); grid = null; }
  $('loadtime').textContent = ''; $('empty').hidden = false; $('toast').hidden = true;
  $('object-count').textContent = '0'; for (const id of ['terrain-count', 'slab-count', 'morph-count','wall-count','window-count','product-count']) $(id).textContent = '0';
  $('missing-parts').hidden=true; $('missing-parts').replaceChildren();
  $('coverage-summary').textContent = '地形・スラブ・モーフ・壁・窓開口の保存寸法に対応します。メーカー部品・植栽は表示しません。';
  $('coverage-detail').textContent = '読み込み結果を待っています。'; $('scene-status').textContent = 'モデル未読み込み';
  document.body.dataset.modelObjects = '0';
}
function cancel() {
  requestId++; worker?.terminate(); worker = null; $('busy').hidden = true;
  document.body.dataset.state = 'idle'; $('filemeta').textContent = '読み込みを中止しました';
}
async function load(getBuffer, filename) {
  cancel(); const token = requestId; reset(); currentName = filename; started = performance.now();
  $('filename').textContent = filename; $('filemeta').textContent = 'ファイルを読み込んでいます';
  $('progress').textContent = 'ファイルを読み込んでいます'; $('busy').hidden = false; document.body.dataset.state = 'loading';
  const failed = message => { worker?.terminate(); worker = null; $('busy').hidden = true; $('filemeta').textContent = '読み込みできませんでした'; document.body.dataset.state = 'error'; toast(`読み込み失敗：${message}`, true); };
  try {
    const buffer = await getBuffer(); if (requestId !== token) return;
    worker = new Worker(new URL('./worker.mjs?v=0.3.2', import.meta.url), { type: 'module' });
    worker.onerror = () => { if (requestId === token) failed('解析処理を起動できません。ChromeまたはEdgeでページを再読み込みしてください。'); };
    worker.onmessage = ({ data }) => {
      if (requestId !== token) return;
      if (data.type === 'progress') $('progress').textContent = data.message;
      else if (data.type === 'error') failed(data.message);
      else { worker.terminate(); worker = null; $('busy').hidden = true; try { showResult(data.result); } catch (error) { reset(); failed(error.message); } }
    };
    worker.postMessage(buffer, [buffer]);
  } catch (error) { if (requestId === token) failed(error.message); }
}
function loadFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.pln')) { toast('.pln のプランファイルを選択してください。'); return; }
  if (file.size > 160 * 1024 * 1024) { toast('試作版のファイル上限は160 MBです。'); return; }
  load(() => file.arrayBuffer(), file.name);
}
const open = () => { $('file').value = ''; $('file').click(); };
$('open').onclick = open; $('empty-open').onclick = open; $('file').onchange = () => loadFile($('file').files[0]); $('cancel').onclick = cancel;
viewport.addEventListener('dragover', event => { event.preventDefault(); viewport.classList.add('dragging'); });
viewport.addEventListener('dragleave', event => { if (!viewport.contains(event.relatedTarget)) viewport.classList.remove('dragging'); });
viewport.addEventListener('drop', event => { event.preventDefault(); viewport.classList.remove('dragging'); loadFile(event.dataTransfer.files[0]); });
document.body.dataset.state = 'idle'; updateMeasurements();
$('sample').onclick = () => {
  cancel(); reset(); started = performance.now(); $('filename').textContent = 'デモモデル';
  showResult(createDemoModel());
};
if (new URLSearchParams(location.search).get('demo') === '1') $('sample').click();
