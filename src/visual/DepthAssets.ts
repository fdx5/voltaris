import * as T from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { asset } from '../core/assets';

/** Original downloaded Kenney CC0 models; provenance and checksums ship beside the GLBs. */
export const SCENERY_MODELS = [
  'satelliteDish_detailed',
  'satelliteDish_large',
  'gate_complex',
  'hangar_roundA',
  'structure_detailed',
  'rock_crystalsLargeA',
  'rock_largeA',
  'meteor_detailed',
  'machine_generatorLarge',
] as const;
export type SceneryModel = (typeof SCENERY_MODELS)[number];
const geometry = new Map<SceneryModel, T.BufferGeometry>();
let station: T.Group;
let pending: Promise<void> | undefined;

export function loadDepthAssets() {
  return (pending ??= Promise.all([
    loadStation(),
    ...SCENERY_MODELS.map(async (name) => {
      const gltf = await new GLTFLoader().loadAsync(asset(`/models/scenery/${name}.glb`));
      gltf.scene.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(gltf.scene);
      const centre = box.getCenter(new T.Vector3()),
        size = box.getSize(new T.Vector3());
      const scale = 2 / Math.max(size.x, size.y, size.z);
      const pieces: T.BufferGeometry[] = [];
      gltf.scene.traverse((object) => {
        if (!(object as T.Mesh).isMesh) return;
        const mesh = object as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
        // These original GLBs use flat-colour primitives, with no external textures.
        // Bake their colours and transforms for one instanced draw per authored model.
        const piece = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        piece
          .applyMatrix4(mesh.matrixWorld)
          .translate(-centre.x, -centre.y, -centre.z)
          .scale(scale, scale, scale);
        for (const attribute of Object.keys(piece.attributes))
          if (attribute !== 'position' && attribute !== 'normal') piece.deleteAttribute(attribute);
        const tint = mesh.material.color;
        const colors = new Float32Array(piece.attributes.position.count * 3);
        for (let i = 0; i < colors.length; i += 3) colors.set([tint.r, tint.g, tint.b], i);
        piece.setAttribute('color', new T.BufferAttribute(colors, 3));
        pieces.push(piece);
        mesh.geometry.dispose();
        mesh.material.dispose();
      });
      const merged = mergeGeometries(pieces);
      merged.computeBoundingSphere();
      geometry.set(name, merged);
      pieces.forEach((piece) => piece.dispose());
    }),
  ])
    .then(() => undefined)
    .catch((error) => {
      pending = undefined;
      throw error;
    }));
}

export function depthGeometry(name: SceneryModel) {
  const source = geometry.get(name);
  if (!source) throw new Error(`Scenery not loaded: ${name}`);
  return source.clone();
}

async function loadStation() {
  const gltf = await new GLTFLoader().loadAsync(asset('/models/scenery/orbital-station.glb'));
  const box = new T.Box3().setFromObject(gltf.scene);
  const center = box.getCenter(new T.Vector3());
  const size = box.getSize(new T.Vector3());
  const scale = 2 / Math.max(size.x, size.y, size.z);
  gltf.scene.position.copy(center).multiplyScalar(-scale);
  gltf.scene.scale.setScalar(scale);
  gltf.scene.traverse((object) => {
    if (!(object as T.Mesh).isMesh) return;
    const mesh = object as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
    const material = mesh.material;
    material.envMapIntensity = 0.55;
    material.roughness = Math.max(0.35, material.roughness);
    if (material.map) material.map.anisotropy = 4;
  });
  station = new T.Group();
  station.add(gltf.scene);
}

export function depthStation() {
  if (!station) throw new Error('Orbital station not loaded');
  return station.clone(true);
}
