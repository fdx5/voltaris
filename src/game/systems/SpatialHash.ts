/** Linked-list grid: fixed storage, no per-query arrays or callbacks. */
export class SpatialHash {
  readonly heads = new Int32Array(24 * 14);
  readonly next: Int32Array;
  readonly results: Int32Array;
  resultCount = 0;
  constructor(capacity: number) {
    this.next = new Int32Array(capacity);
    this.results = new Int32Array(capacity);
    this.clear();
  }
  clear() {
    this.heads.fill(-1);
  }
  insert(i: number, x: number, y: number) {
    const cx = Math.floor((x + 24) / 2),
      cy = Math.floor((y + 14) / 2);
    if (cx < 0 || cx >= 24 || cy < 0 || cy >= 14) return;
    const cell = cy * 24 + cx;
    this.next[i] = this.heads[cell];
    this.heads[cell] = i;
  }
  query(x: number, y: number, r: number) {
    this.resultCount = 0;
    const x0 = Math.max(0, Math.floor((x - r + 24) / 2)),
      x1 = Math.min(23, Math.floor((x + r + 24) / 2)),
      y0 = Math.max(0, Math.floor((y - r + 14) / 2)),
      y1 = Math.min(13, Math.floor((y + r + 14) / 2));
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        let i = this.heads[cy * 24 + cx];
        while (i !== -1) {
          this.results[this.resultCount++] = i;
          i = this.next[i];
        }
      }
    return this.resultCount;
  }
}
export function segmentCircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x: number,
  y: number,
  r: number,
) {
  const dx = bx - ax,
    dy = by - ay,
    d = dx * dx + dy * dy;
  const t = d ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / d)) : 0;
  const ex = ax + t * dx - x,
    ey = ay + t * dy - y;
  return ex * ex + ey * ey < r * r;
}
