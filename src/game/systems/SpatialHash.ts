// Cell size 2, offset 24: covers x/y in [-24, 24). Section 5's tripled
// vertical range reaches y = ±21.6 (stage-05.json minY/maxY) - anything
// entering/leaving a cell outside these bounds used to be silently
// dropped by insert() (rows only went up to y = ±14), so bullets could
// never find enemies up there at all: not a steering bug, a broad-phase
// coverage bug, worst at the vertical extremes and invisible on every
// earlier stage because none of them came close to y = ±14.
const CELLS = 24;
const OFFSET = 24;
/** Linked-list grid: fixed storage, no per-query arrays or callbacks. */
export class SpatialHash {
  readonly heads = new Int32Array(CELLS * CELLS);
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
    const cx = Math.floor((x + OFFSET) / 2),
      cy = Math.floor((y + OFFSET) / 2);
    if (cx < 0 || cx >= CELLS || cy < 0 || cy >= CELLS) return;
    const cell = cy * CELLS + cx;
    this.next[i] = this.heads[cell];
    this.heads[cell] = i;
  }
  query(x: number, y: number, r: number) {
    this.resultCount = 0;
    const x0 = Math.max(0, Math.floor((x - r + OFFSET) / 2)),
      x1 = Math.min(CELLS - 1, Math.floor((x + r + OFFSET) / 2)),
      y0 = Math.max(0, Math.floor((y - r + OFFSET) / 2)),
      y1 = Math.min(CELLS - 1, Math.floor((y + r + OFFSET) / 2));
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        let i = this.heads[cy * CELLS + cx];
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
