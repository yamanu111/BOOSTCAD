const svgNS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}) {
  const el = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}
export function annotation(parent, labels, preview = false) {
  const group = svg('g', { class: preview ? 'measurement-preview' : 'measurement-mark' });
  const lines = ['glow', 'core', 'light'].map(name => svg('line', { class: `measure-line ${name}` }));
  const dots = [svg('circle', { r: 4.5, class: 'measure-dot' }), svg('circle', { r: 4.5, class: 'measure-dot' })];
  group.append(...lines, ...dots); parent.append(group);
  const label = document.createElement('div'); label.className = 'dimension-label'; label.hidden = true;
  labels.append(label);
  return { group, lines, dots, label };
}
export function draw(mark, a, b) {
  mark.group.style.display = a?.visible ? '' : 'none';
  mark.dots[0].style.display = a?.visible ? '' : 'none';
  mark.dots[1].style.display = b?.visible ? '' : 'none';
  for (const [point, dot] of [[a, mark.dots[0]], [b, mark.dots[1]]]) if (point?.visible) {
    dot.setAttribute('cx', point.x); dot.setAttribute('cy', point.y);
  }
  const visible = a?.visible && b?.visible;
  for (const line of mark.lines) {
    line.style.display = visible ? '' : 'none';
    if (visible) for (const [key, value] of Object.entries({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })) line.setAttribute(key, value);
  }
  mark.label.hidden = !visible || !mark.label.textContent;
  if (visible) { mark.label.style.left = `${(a.x + b.x) / 2}px`; mark.label.style.top = `${(a.y + b.y) / 2}px`; }
  return !!visible;
}
function snapIndicator(root) {
  const group = svg('g', { id: 'snap-feedback' });
  group.style.display = 'none';
  const guide = svg('line', { class: 'snap-guide' });
  const marker = svg('g', { class: 'snap-target' });
  marker.append(
    svg('circle', { r: 12, class: 'snap-ring-halo' }),
    svg('circle', { r: 12, class: 'snap-ring' }),
    svg('circle', { r: 2.5, class: 'snap-center' })
  );
  group.append(guide, marker); root.append(group);
  return { group, guide, marker, key: null };
}
export class MeasurementOverlay {
  constructor(root, labels, project, describe) {
    this.project = project; this.describe = describe;
    this.savedRoot = svg('g', { id: 'measurement-records' });
    this.savedLabels = document.createElement('div'); labels.append(this.savedLabels);
    root.append(this.savedRoot); this.preview = annotation(root, labels, true);
    this.preview.label.id = 'dimension-label'; this.saved = [];
    draw(this.preview, null, null);
    this.snap = snapIndicator(root);
  }
  setRecords(records) {
    this.savedRoot.replaceChildren(); this.savedLabels.replaceChildren();
    this.saved = records.map(record => {
      const mark = annotation(this.savedRoot, this.savedLabels);
      mark.group.dataset.measurementId = record.id; mark.label.dataset.measurementId = record.id;
      mark.label.textContent = this.describe(...record.points, record);
      return { record, mark };
    });
  }
  update(pending, cursor, snapCursor = cursor) {
    for (const { record, mark } of this.saved) draw(mark, ...record.points.map(point => this.project(point.xyz)));
    const a = pending ? this.project(pending.xyz) : null;
    const b = cursor ? cursor.point ? this.project(cursor.point.xyz) : { ...cursor.screen, visible: true } : null;
    this.preview.label.textContent = pending && cursor?.point ? this.describe(pending, cursor.point) : '';
    const active = draw(this.preview, a, b);
    document.body.dataset.measurePreview = String(active);
    this.updateSnap(snapCursor);
  }
  updateSnap(cursor) {
    const point = cursor?.point;
    const target = point?.snap ? this.project(point.xyz) : null;
    const indicator = this.snap;
    const visible = target?.visible;
    indicator.group.style.display = visible ? '' : 'none';
    if (!visible) {
      indicator.key = null; delete indicator.group.dataset.target;
      indicator.marker.querySelector('.snap-pulse')?.remove();
      return;
    }
    // Use the same native vertex as the measurement, even across duplicate triangle vertices.
    const key = `${point.id}:${point.xyz.join(',')}`;
    if (key !== indicator.key) {
      indicator.key = key; indicator.group.dataset.target = key;
      indicator.marker.querySelector('.snap-pulse')?.remove();
      indicator.marker.prepend(svg('circle', { r: 15, class: 'snap-pulse' }));
    }
    indicator.marker.setAttribute('transform', `translate(${target.x} ${target.y})`);
    for (const [name, value] of Object.entries({ x1: cursor.screen.x, y1: cursor.screen.y, x2: target.x, y2: target.y })) {
      indicator.guide.setAttribute(name, value);
    }
  }
}
