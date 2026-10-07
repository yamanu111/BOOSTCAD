export function elevationDifference(reference, point) {
  return reference.floor === point.floor ? point.xyz[2] - reference.xyz[2] : null;
}

// Each target shares the first point as its reference until the session is cleared.
export class ElevationSession {
  constructor() { this.clear(); }
  addPoint(point) {
    if (!this.reference) { this.reference = point; return true; }
    if (elevationDifference(this.reference, point) === null) return false;
    this.completed.push({ id: this.nextId++, points: [this.reference, point] });
    return true;
  }
  undo() {
    if (this.completed.length) this.completed.pop();
    else this.reference = null;
  }
  clear() { this.reference = null; this.completed = []; this.nextId = 1; }
}
