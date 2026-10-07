import { svg, annotation, draw } from './measurement-overlay.mjs';
import { elevationDifference } from './elevation-session.mjs';

export class ElevationOverlay {
  constructor(root, labels, project, describe) {
    this.project = project; this.describe = describe;
    this.root = svg('g', { id: 'elevation-records' });
    this.labels = document.createElement('div'); labels.append(this.labels);
    // Leave vertex snap feedback on top of all measurement marks.
    root.insertBefore(this.root, root.querySelector('#snap-feedback'));
    this.preview = this.annotation(true);
    this.referenceDot = svg('circle', { r: 6, class: 'elevation-reference-dot' });
    this.root.append(this.referenceDot);
    this.referenceLabel = document.createElement('div');
    this.referenceLabel.className = 'dimension-label elevation-reference-label';
    this.referenceLabel.textContent = '基準 ±0'; this.referenceLabel.hidden = true;
    labels.append(this.referenceLabel);
    this.saved = []; this.reference = null;
    this.update(null);
  }
  annotation(preview = false) {
    const mark = annotation(this.root, this.labels, preview);
    mark.group.classList.add(preview ? 'elevation-preview' : 'elevation-mark');
    mark.label.classList.add('elevation-label');
    return mark;
  }
  setRecords(records) {
    for (const { mark } of this.saved) { mark.group.remove(); mark.label.remove(); }
    this.saved = records.map(record => {
      const mark = this.annotation();
      mark.group.dataset.elevationId = record.id; mark.label.dataset.elevationId = record.id;
      return { record, mark };
    });
  }
  draw(mark, reference, point) {
    if (!reference || !point || elevationDifference(reference, point) === null) {
      draw(mark, null, null); return;
    }
    const base = this.project([point.xyz[0], point.xyz[1], reference.xyz[2]]);
    const target = this.project(point.xyz);
    mark.label.textContent = this.describe(reference, point);
    draw(mark, base, target);
    if (base.visible && target.visible) {
      mark.label.style.left = `${target.x + 16}px`; mark.label.style.top = `${target.y}px`;
      mark.label.style.transform = 'translateY(-50%)';
    }
  }
  update(reference, cursor = null) {
    for (const { record, mark } of this.saved) this.draw(mark, ...record.points);
    this.draw(this.preview, reference, cursor?.point);
    const origin = reference ? this.project(reference.xyz) : null;
    this.referenceDot.style.display = origin?.visible ? '' : 'none';
    this.referenceLabel.hidden = !origin?.visible;
    if (origin?.visible) {
      this.referenceDot.setAttribute('cx', origin.x); this.referenceDot.setAttribute('cy', origin.y);
      this.referenceLabel.style.left = `${origin.x}px`; this.referenceLabel.style.top = `${origin.y - 8}px`;
    }
  }
}
