/** Deterministic squad layouts, in world units; all arrive from beyond the right edge. */
export function formationPosition(
  ordinal: number,
  n: number,
  count: number,
  radius: number,
  center: number,
  minY: number,
  maxY: number,
) {
  const rows = Math.min(count, Math.max(2, Math.floor((maxY - minY) / (radius * 2 + 0.65))));
  const row = n % rows,
    column = Math.floor(n / rows);
  const step = Math.min(radius * 2 + 0.85, (maxY - minY) / Math.max(1, rows - 1));
  const middle = (rows - 1) / 2;
  let y = (row - middle) * step;
  let x = column * (radius * 2 + 1.2);
  switch (ordinal % 6) {
    case 0:
      x += Math.abs(row - middle) * 0.95;
      break; // chevron
    case 1:
      x += (row % 2) * 0.9;
      break; // staggered line
    case 2:
      y = (row - middle) * step;
      x += row < middle ? 0 : 1.5;
      break; // split wings
    case 3:
      x += row * 0.65;
      break; // echelon
    case 4:
      x += (middle - Math.abs(row - middle)) * 1.1;
      break; // crescent
    case 5:
      x += (column % 2) * 0.6;
      break; // grid
  }
  const half = middle * step;
  const anchor = Math.max(minY + half, Math.min(maxY - half, center));
  return { x: 17.4 + radius + x, y: anchor + y };
}
