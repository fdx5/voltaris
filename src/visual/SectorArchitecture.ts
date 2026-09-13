import * as T from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Distant architecture has no collision or bloom. One merged draw per finish.
 * Landmarks frame the upper and lower thirds, leaving a quiet combat corridor. */
export function buildSectorArchitecture(sector: string) {
  const root = new T.Group();
  root.name = `sector-architecture-${sector}`;
  const parts: T.BufferGeometry[][] = [[], [], []];
  const add = (g: T.BufferGeometry, finish = 0) =>
    parts[finish].push(g.index ? g.toNonIndexed() : g);
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, a = 0, f = 0) =>
    add(new T.BoxGeometry(w, h, d).rotateZ(a).translate(x, y, z), f);
  const arc = (x: number, y: number, r: number, start: number, length: number, f = 0) =>
    add(
      new T.TorusGeometry(r, f === 1 ? 0.045 : 0.22, 6, 100, length)
        .rotateZ(start)
        .translate(x, y, -42),
      f,
    );
  if (sector === 'earth') {
    // Orbital shipyard: open crescent, radial berths and a tiny service convoy.
    for (const r of [19, 20.4, 23]) arc(13, 20, r, 3.05, 3.2);
    arc(13, 20, 20.8, 3.2, 2.7, 1);
    for (let i = 0; i < 26; i++) {
      const a = 3.15 + i * 0.118;
      const x = 13 + Math.cos(a) * 21.5,
        y = 20 + Math.sin(a) * 21.5;
      box(x, y, -41.7, 2.8, 0.5, 0.7, a);
      box(x, y, -41.2, 0.7, 0.22, 0.2, a, 2);
    }
    for (let i = 0; i < 6; i++) {
      box(-28 + i * 3, 11 + i * 0.45, -35, 1.7, 0.38, 0.4);
      box(-28.9 + i * 3, 11 + i * 0.45, -34.7, 0.18, 0.14, 0.12, 0, 1);
    }
  } else if (sector === 'mars') {
    // Abandoned mass driver: interrupted rails and broken mining ribs.
    for (let i = 0; i < 23; i++) {
      const x = -54 + i * 4.7,
        y = 12 + Math.sin(i * 0.28) * 2.1;
      if (i % 7 === 3) continue;
      box(x, y, -44, 4.4, 0.55, 0.7, -0.08);
      box(x, y + 3, -44, 4.4, 0.32, 0.5, -0.08);
      box(x, y + 1.3, -43, 0.32, 4.8, 0.7, -0.35);
      box(x, y, -43.5, 0.55, 0.09, 0.2, 0, 1);
      if (i % 3 === 0) box(x + 1, y - 2.1, -43, 2.3, 2.7, 1.4, 0.12, 2);
    }
    for (const r of [9, 10.5]) arc(31, -18, r, 0.18, 4.8);
  } else if (sector === 'jupiter') {
    // Io's horizon carries a procession of immense geothermal collectors.
    for (let i = 0; i < 12; i++) {
      const x = -54 + i * 9.8,
        h = 4 + (i % 4) * 1.7;
      box(x, -8 + h / 2, -43, 1.1, h, 1.2);
      box(x, -8 + h, -43, 5.8, 0.55, 1.1, 0, 2);
      for (const s of [-1, 1]) {
        box(x + s * 2.1, -6 + h, -43, 0.22, 3.6, 0.3, s * -0.16);
        box(x + s * 2.35, -4.4 + h, -42.6, 0.16, 0.3, 0.1, 0, 1);
      }
    }
    arc(32, 25, 16, 3.35, 2.6);
    arc(32, 25, 17, 3.35, 2.6, 1);
  } else {
    // An ancient segmented halo, half buried in Triton's ice.
    for (let i = 0; i < 17; i++) {
      const a = 0.2 + i * 0.31;
      arc(23, 1, 19, a, 0.21);
      arc(23, 1, 20.1, a, 0.21, 1);
      const x = 23 + Math.cos(a) * 20,
        y = 1 + Math.sin(a) * 20;
      box(x, y, -42, 1.6, 0.6, 0.9, a, 2);
    }
  }
  const palettes: Record<string, string[]> = {
    earth: ['#1b2b3b', '#527c89', '#304355'],
    mars: ['#302721', '#937051', '#453930'],
    jupiter: ['#29272c', '#8c7964', '#3e3540'],
    neptune: ['#182d40', '#497a8a', '#2d4359'],
  };
  parts.forEach((list, i) => {
    if (!list.length) return;
    const merged = mergeGeometries(list)!;
    list.forEach((g) => g.dispose());
    const mesh = new T.Mesh(
      merged,
      i === 1
        ? new T.MeshBasicNodeMaterial({ color: palettes[sector][i], fog: false })
        : new T.MeshStandardNodeMaterial({
            color: palettes[sector][i],
            metalness: 0.45,
            roughness: 0.7,
            fog: false,
          }),
    );
    root.add(mesh);
  });
  // Soft auroral ribbons: edges fade to black under additive blending.
  const curtain = new T.Group();
  if (sector === 'jupiter' || sector === 'neptune') {
    for (let band = 0; band < 3; band++) {
      const g = new T.PlaneGeometry(130, 10, 96, 8);
      const p = g.getAttribute('position');
      const colors = new Float32Array(p.count * 3);
      const tint = new T.Color(sector === 'neptune' ? '#235c72' : '#493e62');
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i),
          y = p.getY(i);
        const fade =
          Math.pow(Math.max(0, 1 - Math.abs(y) / 5), 2) * Math.max(0, 1 - Math.abs(x) / 65);
        tint
          .clone()
          .multiplyScalar(fade * 0.5)
          .toArray(colors, i * 3);
        p.setY(i, y + 21 + band * 2 + Math.sin(x * 0.065 + band) * 5 + Math.sin(x * 0.2) * 0.8);
      }
      g.setAttribute('color', new T.BufferAttribute(colors, 3));
      const mesh = new T.Mesh(
        g,
        new T.MeshBasicNodeMaterial({
          vertexColors: true,
          transparent: true,
          blending: T.AdditiveBlending,
          depthWrite: false,
          side: T.DoubleSide,
          fog: false,
        }),
      );
      mesh.position.z = -62 - band * 3;
      curtain.add(mesh);
    }
  }
  root.add(curtain);
  return {
    root,
    update(t: number) {
      root.position.x = Math.sin(t * 0.012) * 5;
      curtain.position.y = Math.sin(t * 0.09) * 0.65;
    },
  };
}
