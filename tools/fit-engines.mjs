// Finds where each hull's engines are: its rear-facing plating (nozzle ends,
// exhaust bells) in the back of the airframe, clustered across the hull's
// cross-section. Pure geometry, shared by the hardpoint fitter and its preview.
export function fitEngines(geometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox,
    p = geometry.attributes.position,
    index = geometry.index;
  const length = box.max.x - box.min.x;
  const vertex = (k) => (index ? index.getX(k) : k);
  const count = index ? index.count : p.count;
  const faces = [];
  let cy = 0,
    cz = 0,
    cw = 0;
  for (let k = 0; k + 2 < count; k += 3) {
    const a = vertex(k),
      b = vertex(k + 1),
      c = vertex(k + 2);
    const ax = p.getX(a),
      ay = p.getY(a),
      az = p.getZ(a);
    const ux = p.getX(b) - ax,
      uy = p.getY(b) - ay,
      uz = p.getZ(b) - az;
    const vx = p.getX(c) - ax,
      vy = p.getY(c) - ay,
      vz = p.getZ(c) - az;
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const doubled = Math.hypot(nx, ny, nz);
    if (!doubled) continue;
    const x = (ax + p.getX(b) + p.getX(c)) / 3,
      y = (ay + p.getY(b) + p.getY(c)) / 3,
      z = (az + p.getZ(b) + p.getZ(c)) / 3;
    const area = doubled / 2,
      facing = nx / doubled;
    cy += y * area;
    cz += z * area;
    cw += area;
    // Rear-facing plating in the back 30% of the airframe; the further back, the likelier a nozzle.
    if (facing > 0.6 && x > box.max.x - length * 0.3)
      faces.push({ x, y, z, w: area * facing * (0.4 + (x - box.min.x) / length) });
  }
  const midY = cy / cw,
    midZ = cz / cw;
  // Engines sit near the hull's centre of mass; wing trailing edges and fin
  // tips far out to the side are discounted.
  for (const f of faces) f.w /= 1 + (Math.hypot(f.y - midY, f.z - midZ) / (length * 0.3)) ** 2;
  faces.sort((a, b) => b.w - a.w);
  const reach = length * 0.08;
  let clusters = [];
  for (const f of faces) {
    let best = null,
      nearest = reach;
    for (const c of clusters) {
      const d = Math.hypot(c.y / c.w - f.y, c.z / c.w - f.z);
      if (d < nearest) [best, nearest] = [c, d];
    }
    if (!best) clusters.push((best = { x: 0, y: 0, z: 0, w: 0, back: -Infinity }));
    best.x += f.x * f.w;
    best.y += f.y * f.w;
    best.z += f.z * f.w;
    best.w += f.w;
    best.back = Math.max(best.back, f.x);
  }
  clusters.sort((a, b) => b.w - a.w);
  const top = clusters[0]?.w ?? 0;
  clusters = clusters.filter((c) => c.w >= top * 0.28);
  const engines = [];
  for (const c of clusters) {
    const y = c.y / c.w,
      z = c.z / c.w;
    const radius = Math.min(length * 0.07, Math.max(length * 0.03, Math.sqrt(c.w / Math.PI) * 0.9));
    // Two bells closer than their own size read as one engine.
    if (engines.some((e) => Math.hypot(e[1] - y, e[2] - z) < (e[3] + radius) * 0.9)) continue;
    engines.push([c.back, y, z, radius].map((v) => Math.round(v * 1000) / 1000));
    if (engines.length === 3) break;
  }
  if (!engines.length)
    engines.push([box.max.x, midY, midZ, length * 0.05].map((v) => Math.round(v * 1000) / 1000));
  // A bell found inside the silhouette is pushed back to where the hull really
  // ends along its line, so the flame never starts in the middle of the plating.
  for (const engine of engines) {
    let back = engine[0];
    for (let i = 0; i < p.count; i++)
      if (Math.hypot(p.getY(i) - engine[1], p.getZ(i) - engine[2]) < engine[3] * 1.2)
        back = Math.max(back, p.getX(i));
    engine[0] = Math.round(back * 1000) / 1000;
  }
  return engines;
}
