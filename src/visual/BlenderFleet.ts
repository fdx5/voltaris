import * as T from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { color, float, mx_noise_float, positionLocal } from 'three/tsl';
import type { BossDesign, BossModel, EnemyHulls } from './SceneBuilder';

let fleet: T.Group | undefined;
let pending: Promise<void> | undefined;
const id = (n: number) => String(n).padStart(2, '0');

/** Load the actual Blender export before constructing any renderer instance. */
export function loadBlenderFleet(data?: ArrayBuffer): Promise<void> {
  const loader = new GLTFLoader();
  return (pending ??= (
    data
      ? loader.parseAsync(data, '')
      : loader.loadAsync('/models/voltaris-fleet.glb?revision=independent-1')
  )
    .then((gltf) => {
      fleet = gltf.scene;
      const required = [
        'player',
        ...Array.from({ length: 44 }, (_, i) => `enemy_${id(i)}`),
        ...Array.from({ length: 12 }, (_, i) => `ground_${id(i)}`),
        ...['gatekeeper', 'ares', 'jove', 'nereid'].flatMap((n) =>
          ['boss', 'core', 'ring', 'pod'].map((kind) => `${kind}_${n}`),
        ),
      ];
      for (const name of required) {
        if (!fleet.getObjectByName(name)) throw new Error(`Missing Blender fleet asset: ${name}`);
      }
    })
    .catch((error: unknown) => {
      pending = undefined;
      throw error;
    }));
}

function asset(name: string): T.Group {
  const source = fleet?.getObjectByName(name);
  if (!source) throw new Error(`Blender fleet has not loaded: ${name}`);
  const root = new T.Group();
  root.name = name;
  source.updateWorldMatrix(true, true);
  source.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    const sourceMaterial = object.material as T.MeshStandardMaterial;
    const mat = new T.MeshStandardNodeMaterial({
      color: sourceMaterial.color,
      metalness: sourceMaterial.metalness,
      roughness: sourceMaterial.roughness,
      emissive: sourceMaterial.emissive,
      emissiveIntensity: sourceMaterial.emissiveIntensity,
    });
    // Microscopic finish variation is confined to roughness, keeping paint
    // legible at combat scale without a large external texture dependency.
    if (sourceMaterial.emissive.getHex() === 0) {
      mat.colorNode = color(sourceMaterial.color).mul(
        mx_noise_float(positionLocal.mul(75)).mul(0.16).add(0.9),
      );
      mat.roughnessNode = float(sourceMaterial.roughness)
        .add(mx_noise_float(positionLocal.mul(95)).mul(0.065))
        .clamp(0.1, 0.85);
    }
    const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
    const mesh = new T.Mesh(geometry, mat);
    mesh.name = object.name;
    root.add(mesh);
  });
  return root;
}

/** Bake imported material colours into two instanced batches, retaining normals. */
function instanceGeometry(name: string): EnemyHulls {
  const root = asset(name);
  const parts: T.BufferGeometry[][] = [[], []];
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    const material = object.material as T.MeshStandardNodeMaterial;
    const lit = material.emissiveIntensity > 0 && material.emissive.getHex() !== 0;
    const geometry = object.geometry.index
      ? object.geometry.toNonIndexed()
      : object.geometry.clone();
    const count = geometry.getAttribute('position').count;
    const color = lit
      ? material.emissive.clone().multiplyScalar(material.emissiveIntensity)
      : material.color;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
    geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
    for (const key of Object.keys(geometry.attributes))
      if (!['position', 'normal', 'color'].includes(key)) geometry.deleteAttribute(key);
    parts[lit ? 1 : 0].push(geometry);
    object.geometry.dispose();
    material.dispose();
  });
  const merged = parts.map((list) => {
    const result = list.length ? mergeGeometries(list) : null;
    for (const geometry of list) geometry.dispose();
    result?.computeBoundingSphere();
    return result;
  });
  return { hull: merged[0], accent: merged[1] };
}

export const blenderEnemyGeometry = (type: number) => instanceGeometry(`enemy_${id(type)}`);
export const blenderGroundGeometry = (type: number) => instanceGeometry(`ground_${id(type)}`);

export function makeBlenderShip(): T.Group {
  const root = asset('player');
  root.userData.source = 'Blender / Peregrine Mk II';
  const engines: T.Group[] = [];
  for (const side of [0]) {
    const engine = new T.Group();
    engine.name = 'exhaust';
    engine.position.set(-1.28, 0.127, 0.079);
    engine.userData.phase = side * 1.8;
    for (let i = 0; i < 5; i++) {
      const length = 1.12 - i * 0.18;
      const mesh = new T.Mesh(
        new T.ConeGeometry(0.12 - i * 0.02, length, 16, 1, true)
          .rotateZ(Math.PI / 2)
          .translate(-length / 2, 0, 0),
        new T.MeshBasicNodeMaterial({
          color: i < 3 ? '#549ee8' : '#e1f7ff',
          transparent: true,
          opacity: 0.12 + i * 0.1,
          blending: T.AdditiveBlending,
          depthWrite: false,
          side: T.DoubleSide,
          toneMapped: false,
        }),
      );
      engine.add(mesh);
    }
    root.add(engine);
    engines.push(engine);
  }
  root.userData.exhausts = engines;
  return root;
}

export function makeBlenderBoss(design: BossDesign): BossModel {
  const root = asset(`boss_${design}`);
  const ring = asset(`ring_${design}`);
  const coreAsset = asset(`core_${design}`);
  const core = coreAsset.children[0] as T.Mesh;
  core.geometry.computeBoundingBox();
  const centre = core.geometry.boundingBox!.getCenter(new T.Vector3());
  core.geometry.translate(-centre.x, -centre.y, -centre.z);
  core.position.copy(centre);
  ring.position.copy(centre);
  for (const child of ring.children) {
    if (child instanceof T.Mesh) child.geometry.translate(-centre.x, -centre.y, -centre.z);
  }
  root.add(ring, core);
  const count = { gatekeeper: 4, ares: 6, jove: 8, nereid: 10 }[design];
  const pods = Array.from({ length: count }, () => asset(`pod_${design}`));
  return { root, ring, core, pods };
}
