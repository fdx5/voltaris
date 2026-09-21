import * as T from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { asset } from '../core/assets';

import { SCENERY_SCHEDULE, type SceneryModel } from './ScenerySchedule';
const models = new Map<SceneryModel, T.Group>();
const pending = new Map<SceneryModel, Promise<void>>();
/** Load only this sector's curated models, retaining cache across retries and sectors. */
export function loadDepthAssets(stage = 0, onProgress?: (fraction: number) => void) {
  const names = [...new Set(SCENERY_SCHEDULE[stage].map((pass) => pass.model))];
  if (names.length === 0) {
    onProgress?.(1);
    return Promise.resolve();
  }
  let loaded = 0;
  return Promise.all(
    names.map((name) =>
      loadModel(name).then(() => {
        loaded++;
        onProgress?.(loaded / names.length);
      }),
    ),
  ).then(() => undefined);
}
function loadModel(name: SceneryModel): Promise<void> {
  if (models.has(name)) return Promise.resolve();
  const cached = pending.get(name);
  if (cached) return cached;
  const promise = (async () => {
    const gltf = await new GLTFLoader().loadAsync(asset(`/models/scenery/${name}.glb`));
    const box = new T.Box3().setFromObject(gltf.scene);
    const center = box.getCenter(new T.Vector3());
    const size = box.getSize(new T.Vector3());
    const scale = 2 / Math.max(size.x, size.y, size.z);
    gltf.scene.position.copy(center).multiplyScalar(-scale);
    gltf.scene.scale.setScalar(scale);
    gltf.scene.traverse((object) => {
      if (!(object as T.Mesh).isMesh) return;
      const mesh = object as T.Mesh<
        T.BufferGeometry,
        T.MeshStandardMaterial | T.MeshStandardMaterial[]
      >;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        material.envMapIntensity = 0.55;
        material.roughness = Math.max(0.35, material.roughness);
        for (const map of [material.map, material.normalMap, material.roughnessMap])
          if (map) map.anisotropy = 4;
      }
    });
    const root = new T.Group();
    root.add(gltf.scene);
    models.set(name, root);
  })().catch((error) => {
    pending.delete(name);
    throw error;
  });
  pending.set(name, promise);
  return promise;
}
export function depthModel(name: SceneryModel) {
  const source = models.get(name);
  return source?.clone(true);
}
