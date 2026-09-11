import * as T from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Nose +X, dorsal +Y, wings along Z: neutral flight presents the flank. */
export function makeShip() {
  const root = new T.Group();
  root.name = 'VOLTARIS / Peregrine interceptor';
  const hull = new T.Group();
  // Author planform in XY, then turn the whole airframe into side elevation.
  hull.rotation.x = -Math.PI / 2;
  root.add(hull);
  const materials = {
    ceramic: new T.MeshStandardNodeMaterial({ color: '#dbe9f0', metalness: 0.55, roughness: 0.3 }),
    steel: new T.MeshStandardNodeMaterial({ color: '#253749', metalness: 0.75, roughness: 0.36 }),
    blue: new T.MeshStandardNodeMaterial({ color: '#176f9c', metalness: 0.65, roughness: 0.3 }),
    copper: new T.MeshStandardNodeMaterial({ color: '#f3a35c', metalness: 0.7, roughness: 0.28 }),
    glass: new T.MeshStandardNodeMaterial({
      color: '#12374d',
      emissive: '#14749a',
      emissiveIntensity: 0.45,
      metalness: 0.7,
      roughness: 0.12,
    }),
    lamp: new T.MeshBasicNodeMaterial({ color: '#88edff', toneMapped: false }),
  };
  type Finish = keyof typeof materials;
  const parts = new Map<Finish, T.BufferGeometry[]>();
  const add = (g: T.BufferGeometry, finish: Finish) => {
    // Compress the forebody in thickness as well as width. Extruding a
    // pointed planform alone leaves a blunt vertical edge in side elevation.
    const positions = g.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      if (x <= 0.6) continue;
      const taper = Math.max(0.025, 1 - (x - 0.6) / 1.075);
      positions.setZ(i, positions.getZ(i) * taper);
      positions.setX(i, 0.6 + (x - 0.6) * 1.15);
    }
    g.computeVertexNormals();
    const list = parts.get(finish) ?? [];
    list.push(g);
    parts.set(finish, list);
  };
  const plate = (points: number[][], depth: number, z: number, finish: Finish) => {
    const shape = new T.Shape();
    points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    shape.closePath();
    add(
      new T.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: true,
        bevelSize: 0.025,
        bevelThickness: 0.025,
        bevelSegments: 1,
        steps: 1,
      }).translate(0, 0, z),
      finish,
    );
  };
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, finish: Finish) =>
    add(new T.BoxGeometry(w, h, d).translate(x, y, z), finish);
  const barrel = (
    x: number,
    y: number,
    z: number,
    radius: number,
    length: number,
    finish: Finish,
  ) =>
    add(
      new T.CylinderGeometry(radius, radius, length, 12).rotateZ(Math.PI / 2).translate(x, y, z),
      finish,
    );

  // Long chisel nose, armoured shoulders and a darker, vented ventral keel.
  plate(
    [
      [1.65, 0],
      [0.55, -0.24],
      [-0.65, -0.33],
      [-1.25, -0.22],
      [-1.25, 0.22],
      [-0.65, 0.33],
      [0.55, 0.24],
    ],
    0.29,
    -0.13,
    'ceramic',
  );
  plate(
    [
      [1.38, 0],
      [0.25, -0.2],
      [-1.12, -0.24],
      [-1.27, 0],
      [-1.12, 0.24],
      [0.25, 0.2],
    ],
    0.14,
    -0.29,
    'steel',
  );
  plate(
    [
      [1.48, 0],
      [0.35, -0.07],
      [-0.94, -0.07],
      [-0.94, 0.07],
      [0.35, 0.07],
    ],
    0.025,
    0.18,
    'blue',
  );
  const canopy = new T.SphereGeometry(1, 24, 12);
  canopy.scale(0.48, 0.19, 0.22).translate(0.44, 0, 0.23);
  add(canopy, 'glass');
  box(0.16, 0, 0.32, 0.04, 0.37, 0.16, 'ceramic');
  for (const side of [-1, 1]) {
    const y = (v: number) => side * v;
    plate(
      [
        [0.48, y(0.2)],
        [-0.64, y(1.04)],
        [-1.35, y(0.93)],
        [-1.02, y(0.48)],
        [-0.8, y(0.22)],
      ],
      0.08,
      -0.02,
      'blue',
    );
    plate(
      [
        [0.18, y(0.3)],
        [-0.73, y(0.86)],
        [-1.12, y(0.84)],
        [-0.6, y(0.36)],
      ],
      0.025,
      0.09,
      'ceramic',
    );
    plate(
      [
        [0.85, y(0.16)],
        [0.31, y(0.51)],
        [0.05, y(0.46)],
        [0.25, y(0.18)],
      ],
      0.055,
      0.035,
      'copper',
    );
    // Distinct underside panels remain visible during a descending bank.
    plate(
      [
        [-0.13, y(0.39)],
        [-0.8, y(0.9)],
        [-1.17, y(0.86)],
        [-0.77, y(0.41)],
      ],
      0.025,
      -0.09,
      'steel',
    );
    box(-0.66, y(0.58), -0.105, 0.37, 0.075, 0.025, 'copper');
    barrel(-0.85, y(0.43), 0, 0.21, 0.92, 'steel');
    barrel(-0.87, y(0.43), 0, 0.225, 0.48, 'ceramic');
    barrel(-1.32, y(0.43), 0, 0.225, 0.12, 'copper');
    barrel(-1.39, y(0.43), 0, 0.155, 0.03, 'lamp');
    barrel(-0.01, y(0.77), 0.02, 0.045, 0.7, 'steel');
    box(-0.81, y(0.9), 0.1, 0.32, 0.025, 0.025, 'lamp');
    // Swept vertical stabilizers give the side profile height and character.
    const fin = new T.Shape();
    fin.moveTo(-1.17, 0.12);
    fin.lineTo(-1.13, 0.67);
    fin.lineTo(-0.83, 0.67);
    fin.lineTo(-0.38, 0.13);
    fin.closePath();
    add(
      new T.ExtrudeGeometry(fin, { depth: 0.055, bevelEnabled: false })
        .rotateX(Math.PI / 2)
        .translate(0, y(0.53), 0),
      'blue',
    );
    for (let j = 0; j < 5; j++) {
      box(-0.35 - j * 0.12, y(0.22), 0.2, 0.045, 0.13, 0.025, 'steel');
      box(-0.33 - j * 0.13, y(0.17), -0.3, 0.045, 0.11, 0.025, 'copper');
    }
    const exhaust = new T.Group();
    exhaust.name = 'exhaust';
    exhaust.position.set(-1.42, y(0.43), 0);
    exhaust.userData.phase = side * 1.8;
    // Every layer starts at the nozzle; changing length never opens a gap.
    for (const [radius, length, color, opacity] of [
      [0.23, 2.05, '#ff3020', 0.24],
      [0.185, 1.7, '#ff7b18', 0.34],
      [0.14, 1.3, '#ffd34a', 0.46],
      [0.105, 0.92, '#278dff', 0.6],
      [0.052, 0.57, '#f4fbff', 0.9],
    ] as const) {
      const geometry = new T.ConeGeometry(radius, length, 20, 1, true)
        .rotateZ(Math.PI / 2)
        .translate(-length / 2, 0, 0);
      exhaust.add(
        new T.Mesh(
          geometry,
          new T.MeshBasicNodeMaterial({
            color,
            transparent: true,
            opacity,
            blending: T.AdditiveBlending,
            depthWrite: false,
            side: T.DoubleSide,
            toneMapped: false,
          }),
        ),
      );
    }
    // White-hot compression diamonds inside the warm outer flame.
    const diamondMaterial = new T.MeshBasicNodeMaterial({
      color: '#fff0c2',
      transparent: true,
      opacity: 0.7,
      blending: T.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    for (let j = 0; j < 4; j++) {
      const diamond = new T.Mesh(new T.OctahedronGeometry(1), diamondMaterial);
      const r = 0.065 - j * 0.011;
      diamond.scale.set(0.13 - j * 0.018, r, r);
      diamond.position.x = -0.24 - j * 0.25;
      exhaust.add(diamond);
    }
    hull.add(exhaust);
  }
  for (const [finish, geometries] of parts) {
    const flat = geometries.map((g) => (g.index ? g.toNonIndexed() : g));
    const merged = mergeGeometries(flat);
    if (merged) hull.add(new T.Mesh(merged, materials[finish]));
    new Set([...geometries, ...flat]).forEach((g) => g.dispose());
  }
  root.userData.exhausts = hull.children.filter((child) => child.name === 'exhaust');
  return root;
}

export function animateShip(ship: T.Group, time: number, thrust: number) {
  const engines = ship.userData.exhausts as T.Group[];
  for (const engine of engines) {
    const phase = engine.userData.phase as number;
    const flutter = Math.sin(time * 43 + phase) * 0.045 + Math.sin(time * 71 + phase) * 0.025;
    engine.scale.set(0.9 + thrust * 0.25 + flutter, 1 + flutter * 0.6, 1 + flutter * 0.6);
    for (let i = 0; i < 5; i++) {
      const layer = engine.children[i];
      layer.scale.x = 1 + Math.sin(time * (29 + i * 7) + phase + i) * (0.045 + i * 0.008);
    }
  }
}
