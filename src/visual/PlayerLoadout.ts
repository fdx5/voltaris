import * as T from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { asset } from '../core/assets';
import { finishHull, makeImportedShip } from './ImportedFleet';
import type { Weapon } from '../game/GameState';

export const PLAYER_CRAFT = {
  LASER: { name: 'STRIKER', role: '정밀 요격기', color: '#81cfff' },
  MISSILE: { name: 'KESTREL', role: '유도 미사일 전투기', color: '#ffba68' },
  SPREAD: { name: 'MANTA', role: '광역 제압 전투기', color: '#c6a0ff' },
} as const;
export const ORDNANCE = ['missile-main', 'missile-option', 'spread-main', 'spread-option'] as const;
export type Ordnance = (typeof ORDNANCE)[number];
const models = new Map<string, T.Group>();
let pending: Promise<void> | undefined;
export function loadPlayerLoadout() {
  return (pending ??= Promise.all(
    ['missile-ship', 'spread-ship', ...ORDNANCE].map(async (name) => {
      const gltf = await new GLTFLoader().loadAsync(asset(`/models/player/${name}.glb`));
      models.set(name, gltf.scene);
    }),
  )
    .then(() => undefined)
    .catch((error: unknown) => {
      pending = undefined;
      throw error;
    }));
}

export function makePlayerCraft(weapon: Weapon): T.Group {
  if (weapon === 'LASER') return makeImportedShip();
  const source = models.get(weapon === 'MISSILE' ? 'missile-ship' : 'spread-ship');
  if (!source) throw new Error(`Player airframe not loaded: ${weapon}`);
  const root = new T.Group();
  root.name = PLAYER_CRAFT[weapon].name;
  root.userData.weapon = weapon;
  const airframe = source.clone(true);
  airframe.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    const original = object.material as T.MeshStandardMaterial;
    object.geometry = toCreasedNormals(object.geometry.clone(), T.MathUtils.degToRad(42));
    object.material = finishHull(new T.MeshStandardNodeMaterial({ map: original.map }), null);
    if (original.map) original.map.anisotropy = 8;
  });
  root.add(airframe);
  // A rigid airframe rig: the body and its motor share all bank/pitch transforms.
  const engines: T.Group[] = [];
  const bounds = new T.Box3().setFromObject(airframe);
  for (const side of [-1, 1]) {
    const engine = new T.Group();
    engine.name = 'exhaust';
    engine.position.set(bounds.min.x + 0.12, -0.04, side * (weapon === 'MISSILE' ? 0.22 : 0.43));
    engine.userData.phase = side * 1.8;
    for (let i = 0; i < 5; i++) {
      const length = 0.9 - i * 0.14;
      engine.add(
        new T.Mesh(
          new T.ConeGeometry(0.1 - i * 0.017, length, 16, 1, true)
            .rotateZ(Math.PI / 2)
            .translate(-length / 2, 0, 0),
          new T.MeshBasicNodeMaterial({
            color: i < 3 ? PLAYER_CRAFT[weapon].color : '#effaff',
            transparent: true,
            opacity: 0.16 + i * 0.11,
            blending: T.AdditiveBlending,
            depthWrite: false,
            side: T.DoubleSide,
            toneMapped: false,
          }),
        ),
      );
    }
    root.add(engine);
    engines.push(engine);
  }
  root.userData.exhausts = engines;
  return root;
}

/** Bake each downloaded projectile into one coloured primitive for instancing. */
export function makeOrdnance(kind: Ordnance, accentOverride?: string) {
  const source = models.get(kind);
  if (!source) throw new Error(`Ordnance not loaded: ${kind}`);
  const accent = new T.Color(
    accentOverride ??
      {
        'missile-main': '#f5a34e',
        'missile-option': '#6ee9d2',
        'spread-main': '#b595ff',
        'spread-option': '#f680af',
      }[kind],
  );
  const parts: T.BufferGeometry[] = [];
  source.updateMatrixWorld(true);
  source.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    const original = object.material as T.MeshStandardMaterial;
    let g = object.geometry.clone().applyMatrix4(object.matrixWorld);
    if (g.index) {
      const flat = g.toNonIndexed();
      g.dispose();
      g = flat;
    }
    const positions = g.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    const originalColors = g.getAttribute('color');
    const c = new T.Color();
    for (let i = 0; i < positions.count; i++) {
      // Dark ventral keel, ceramic nose and accent bands keep tiny rounds legible.
      const x = positions.getX(i);
      const band = (x > 0.85 && x < 1.25) || (x > -1.35 && x < -0.95);
      c.copy(band ? accent : original.color);
      if (originalColors && !band) c.multiply(new T.Color().fromBufferAttribute(originalColors, i));
      if (!band) c.lerp(accent, 0.35);
      if (positions.getY(i) < -0.05) c.multiplyScalar(0.65);
      c.toArray(colors, i * 3);
    }
    for (const name of Object.keys(g.attributes))
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    g.setAttribute('color', new T.BufferAttribute(colors, 3));
    parts.push(g);
  });
  const geometry = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  geometry.computeBoundingSphere();
  const material = new T.MeshStandardNodeMaterial({
    vertexColors: true,
    metalness: 0.4,
    roughness: 0.32,
    emissive: accent,
    emissiveIntensity: 0.15,
  });
  material.depthTest = false;
  return { geometry, material };
}
