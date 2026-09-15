import * as T from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { color, float, normalView, positionViewDirection, texture, uniform } from 'three/tsl';
import type { BossDesign, BossModel, EnemyHulls } from './SceneBuilder';
import defs from '../../data/enemies/enemy-defs.json';
import groundDefs from '../../data/enemies/ground-defs.json';
import roster from '../../data/enemies/imported-fleet.json';
import fleetParts from '../../data/enemies/imported-fleet-parts.json';
import groundPack from '../../data/enemies/ground-units-pack.json';
import { asset } from '../core/assets';
import { isIOSDevice } from '../core/device';
import iosFleet from '../../data/enemies/ios-fleet.json';
import fleetHardpoints from '../../data/enemies/fleet-hardpoints.json';
import groundHardpoints from '../../data/enemies/ground-hardpoints.json';

/**
 * Every hostile family, boss hull and escort drone is a different downloaded CC0
 * spaceship; tools/pack-imported-fleet.mjs packs them into one GLB with one
 * textured primitive per roster slot (see data/enemies/imported-fleet.json).
 * Surface emplacements are turrets and tanks instead, packed on their own by
 * tools/pack-ground-units.mjs with paint roles in place of textures.
 */
export const FLEET_URLS = fleetParts.parts.map((name) =>
  asset(`/models/imported/${name}?v=${fleetParts.sha256.slice(0, 12)}`),
);
export const GROUND_URL = asset(
  `/models/imported/voltaris-ground-units.glb?v=${groundPack.sha256.slice(0, 12)}`,
);
const BOSSES = ['gatekeeper', 'ares', 'jove', 'nereid'] as const;
const pad = (n: number) => String(n).padStart(2, '0');
export const FLEET_SLOTS = [
  'player',
  ...defs.map((_, i) => `enemy_${pad(i)}`),
  ...BOSSES.flatMap((b) => [`boss_${b}`, `pod_${b}`]),
];
export const GROUND_SLOTS = groundDefs.map((_, i) => `ground_${pad(i)}`);

let fleet: T.Group | undefined;
let groundUnits: T.Group | undefined;
let pending: Promise<void> | undefined;

/** Downloads the fleet's parts side by side and joins them into one GLB. */
async function downloadFleet() {
  if (isIOSDevice()) {
    const response = await fetch(
      asset(`/models/imported/voltaris-fleet-ios.glb?v=${iosFleet.sha256.slice(0, 12)}`),
    );
    if (!response.ok) throw new Error(`Fleet download failed (${response.status})`);
    return response.arrayBuffer();
  }
  const chunks = await Promise.all(
    FLEET_URLS.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Fleet download failed (${response.status}): ${url}`);
      return new Uint8Array(await response.arrayBuffer());
    }),
  );
  const bytes = new Uint8Array(fleetParts.size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (offset !== fleetParts.size) throw new Error('Fleet download was incomplete');
  return bytes.buffer;
}

async function downloadGroundUnits() {
  const response = await fetch(GROUND_URL);
  if (!response.ok) throw new Error(`Ground units download failed (${response.status})`);
  return response.arrayBuffer();
}

/**
 * Loads the spaceship fleet and the surface emplacements. Tools and tests pass
 * both GLBs' bytes; the game downloads them.
 */
export function loadImportedFleet(data?: ArrayBuffer, groundData?: ArrayBuffer): Promise<void> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return (pending ??= Promise.all([
    (data ? Promise.resolve(data) : downloadFleet()).then((bytes) => loader.parseAsync(bytes, '')),
    (groundData ? Promise.resolve(groundData) : downloadGroundUnits()).then((bytes) =>
      loader.parseAsync(bytes, ''),
    ),
  ])
    .then(([gltf, ground]) => {
      for (const name of FLEET_SLOTS) {
        const node = gltf.scene.getObjectByName(name);
        if (!(node instanceof T.Mesh)) throw new Error(`Missing imported spaceship: ${name}`);
        if (!data && !(node.material as T.MeshStandardMaterial).map)
          throw new Error(`Spaceship texture failed to load: ${name}`);
      }
      for (const name of GROUND_SLOTS)
        if (!(ground.scene.getObjectByName(name) instanceof T.Mesh))
          throw new Error(`Missing ground unit: ${name}`);
      fleet = gltf.scene;
      groundUnits = ground.scene;
    })
    .catch((error: unknown) => {
      pending = undefined;
      throw error;
    }));
}

/** Faces meeting at less than this share a smoothed normal. */
const CREASE = T.MathUtils.degToRad(42);
/**
 * Every hull material, so the renderer can hand them a reflection environment
 * once its backend is up.
 */
export const HULL_MATERIALS = new Set<T.MeshStandardNodeMaterial>();

/** Meshopt quantises attributes; transforms below need plain float buffers. */
function floatGeometry(source: T.BufferGeometry) {
  const geometry = new T.BufferGeometry();
  // A ground unit's vertex colours are paint roles, not colours; they travel as
  // `paint` so the batch's own `color` attribute stays free for hit flashes.
  for (const [key, name] of [
    ['position', 'position'],
    ['normal', 'normal'],
    ['uv', 'uv'],
    ['color', 'paint'],
  ]) {
    const attribute = source.getAttribute(key);
    if (!attribute) continue;
    const size = key === 'color' ? 3 : attribute.itemSize;
    const array = new Float32Array(attribute.count * size);
    for (let i = 0; i < attribute.count; i++)
      for (let c = 0; c < size; c++) array[i * size + c] = attribute.getComponent(i, c);
    geometry.setAttribute(name, new T.BufferAttribute(array, size));
  }
  const index = source.getIndex();
  if (index) geometry.setIndex(new T.BufferAttribute(Uint32Array.from(index.array), 1));
  return geometry;
}

type Part = {
  geometry: T.BufferGeometry;
  map: T.Texture | null;
  surface: T.Texture | null;
};

/**
 * Artist files fly nose +Z with dorsal +Y; the camera looks down -Z. The nose is
 * turned to face along X and the dorsal is rolled `view` degrees toward the
 * camera, so each silhouette reads as a three-quarter plan rather than a sliver.
 */
function part(slot: string, reach: number, facing: 1 | -1, view: number): Part {
  const source = (slot.startsWith('ground_') ? groundUnits : fleet)?.getObjectByName(slot) as
    T.Mesh | undefined;
  if (!source) throw new Error(`Imported fleet has not loaded: ${slot}`);
  source.updateWorldMatrix(true, false);
  const geometry = floatGeometry(source.geometry).applyMatrix4(source.matrixWorld);
  geometry.applyMatrix4(new T.Matrix4().makeRotationY((facing * Math.PI) / 2));
  geometry.applyMatrix4(new T.Matrix4().makeRotationX(T.MathUtils.degToRad(view)));
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const centre = box.getCenter(new T.Vector3());
  const size = box.getSize(new T.Vector3());
  const scale = (reach * 2) / Math.max(size.x, size.y);
  geometry.translate(-centre.x, -centre.y, -centre.z).scale(scale, scale, scale);
  // The packs ship low-poly hulls with a hard normal on nearly every edge, so
  // curved plating read as a mesh of flat facets. Faces meeting at a shallow
  // angle now share a normal and shade as one smooth surface; genuine edges -
  // wing roots, fins, panel breaks - stay crisp.
  const smooth = toCreasedNormals(geometry, CREASE);
  if (smooth !== geometry) geometry.dispose();
  smooth.computeBoundingBox();
  smooth.computeBoundingSphere();
  const material = source.material as T.MeshStandardMaterial;
  for (const texture of [material.map, material.metalnessMap]) {
    if (!texture) continue;
    texture.anisotropy = 16;
    texture.generateMipmaps = true;
    texture.minFilter = T.LinearMipmapLinearFilter;
  }
  return { geometry: smooth, map: material.map, surface: material.metalnessMap };
}

/** The float uniform driving a boss's red damage glow. */
type DamageGlow = T.UniformNode<'float', number>;

/** Surface response shared by every imported hull. */
export function finishHull(
  material: T.MeshStandardNodeMaterial,
  surface: Part['surface'],
  /** 0..~2: how hot a red damage glow burns over the whole hull (bosses only). */
  damage?: DamageGlow,
) {
  if (surface) {
    // No environment probe lights the fleet, so full metal would read as black.
    material.metalnessMap = surface;
    material.roughnessMap = surface;
    // With a reflection environment the metal reads as polished plating
    // instead of falling to black, so the surface maps can speak up.
    material.metalness = 0.7;
    material.roughness = 0.72;
  } else {
    material.metalness = 0.45;
    material.roughness = 0.42;
  }
  HULL_MATERIALS.add(material);
  // Against a black sky a dark paint job vanishes. A cool fresnel rim traces
  // every silhouette, and a little of the paint glows so its colours survive
  // on the unlit side.
  const facing = normalView.dot(positionViewDirection).clamp(0, 1);
  const rim = color('#9fc6ff').mul(float(1).sub(facing).pow(2.6)).mul(0.55);
  const paint = material.map ? texture(material.map).rgb.mul(0.14).add(rim) : rim;
  // A damaged boss burns red from within: a floor of red emission plus a hot
  // fresnel edge, so the whole silhouette reads as glowing, not just tinted.
  material.emissiveNode = damage
    ? paint.add(
        color('#ff2a12')
          .mul(float(0.55).add(float(1).sub(facing).pow(1.5)))
          .mul(damage),
      )
    : paint;
  return material;
}

/** The charge lamp sits on the first fitted muzzle (tools/fit-imported-hardpoints.mjs). */
function instanceGeometry(
  slot: string,
  reach: number,
  view: number,
  muzzle: number[],
  lift = 0,
): EnemyHulls {
  const { geometry: hull, map, surface } = part(slot, reach, -1, view);
  if (lift) hull.translate(0, -hull.boundingBox!.min.y - lift, 0).computeBoundingBox();
  const colors = new Float32Array(hull.attributes.position.count * 3).fill(1);
  hull.setAttribute('color', new T.BufferAttribute(colors, 3));
  const accent = new T.SphereGeometry(Math.min(0.07, reach * 0.09), 8, 6).translate(
    muzzle[0],
    muzzle[1],
    muzzle[2],
  );
  const glow = new Float32Array(accent.attributes.position.count * 3);
  for (let i = 0; i < glow.length; i += 3) glow.set([2.3, 0.3, 0.08], i);
  accent.setAttribute('color', new T.BufferAttribute(glow, 3));
  return { hull, accent, map, surface };
}

export const enemyReach = (type: number) => defs[type].radius * 1.45;
export const groundReach = (type: number) => groundDefs[type].radius * 1.25;

export const importedEnemyModel = (type: number) => roster.enemies[type].model;
export const importedEnemyGeometry = (type: number) =>
  instanceGeometry(
    `enemy_${pad(type)}`,
    enemyReach(type),
    roster.enemies[type].view,
    fleetHardpoints[type].muzzles[0],
  );

/**
 * Emplacement craft rest on the surface: the hull's lowest point is the origin,
 * sunk a few centimetres, so a roof unit is the same batch turned over about X.
 */
export const importedGroundGeometry = (type: number) =>
  instanceGeometry(
    `ground_${pad(type)}`,
    groundReach(type),
    roster.ground[type].view,
    groundHardpoints[type].muzzles[0],
    0.06,
  );

function mesh(slot: string, reach: number, facing: 1 | -1, view: number, damage?: DamageGlow) {
  const { geometry, map, surface } = part(slot, reach, facing, view);
  const material = finishHull(new T.MeshStandardNodeMaterial({ map }), surface, damage);
  const object = new T.Mesh(geometry, material);
  object.name = slot;
  return object;
}

export function makeImportedShip(): T.Group {
  const root = new T.Group();
  root.name = 'player';
  root.userData.source = `${roster.player.pack} / ${roster.player.model}`;
  const hull = mesh('player', 1.6, 1, 0);
  root.add(hull);
  const bounds = hull.geometry.boundingBox!;
  const exhaust = new T.Group();
  exhaust.name = 'exhaust';
  exhaust.position.set(bounds.min.x + 0.09, 0, 0);
  exhaust.userData.phase = 0;
  for (let i = 0; i < 5; i++) {
    const length = 1.05 - i * 0.17;
    exhaust.add(
      new T.Mesh(
        new T.ConeGeometry(0.13 - i * 0.022, length, 16, 1, true)
          .rotateZ(Math.PI / 2)
          .translate(-length / 2, 0, 0),
        new T.MeshBasicNodeMaterial({
          color: i < 3 ? '#339dff' : '#e2faff',
          transparent: true,
          opacity: 0.15 + i * 0.11,
          blending: T.AdditiveBlending,
          depthWrite: false,
          side: T.DoubleSide,
          toneMapped: false,
        }),
      ),
    );
  }
  root.add(exhaust);
  root.userData.exhausts = [exhaust];
  return root;
}

const BOSS_SPEC: Record<BossDesign, { reach: number; pods: number; podReach: number }> = {
  gatekeeper: { reach: 4.6, pods: 4, podReach: 0.62 },
  ares: { reach: 5.0, pods: 6, podReach: 0.6 },
  jove: { reach: 5.3, pods: 8, podReach: 0.58 },
  nereid: { reach: 5.6, pods: 10, podReach: 0.56 },
};

export function makeImportedBoss(design: BossDesign): BossModel {
  const spec = BOSS_SPEC[design];
  const entry = roster.bosses[design];
  const root = new T.Group();
  root.name = `boss_${design}`;
  const damage = uniform(0);
  const hull = mesh(`boss_${design}`, spec.reach, -1, entry.hull.view, damage);
  root.add(hull);
  const core = new T.Mesh(
    new T.SphereGeometry(0.16, 20, 12),
    new T.MeshBasicNodeMaterial({ color: '#ff7744', toneMapped: false }),
  );
  // Vulnerable reactor matches the gameplay core centred on the boss origin.
  core.position.z = hull.geometry.boundingBox!.max.z + 0.02;
  const ring = new T.Group();
  root.add(core, ring);
  const drone = mesh(`pod_${design}`, spec.podReach, -1, entry.pod.view, damage);
  const pods = Array.from({ length: spec.pods }, (_, i) => {
    const pod = new T.Group();
    pod.add(i ? drone.clone() : drone);
    return pod;
  });
  return { root, ring, core, pods, damage };
}
