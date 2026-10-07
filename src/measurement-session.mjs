// Completed measurements live until an explicit clear or a different plan is opened.
export class MeasurementSession {
  constructor() { this.clear(); }
  get points() { return this.pending ? [this.pending] : this.completed.at(-1)?.points || []; }
  addPoint(point, distanceMode = 'space') {
    if (!this.pending) { this.pending = point; return; }
    this.completed.push({ id: this.nextId++, points: [this.pending, point], distanceMode });
    this.pending = null;
  }
  undo() {
    if (this.pending) this.pending = null;
    else this.pending = this.completed.pop()?.points[0] || null;
  }
  cancelPending() { this.pending = null; }
  clear() { this.pending = null; this.completed = []; this.nextId = 1; }
}
