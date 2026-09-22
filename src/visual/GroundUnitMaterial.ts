import { sceneAssetManager } from './SceneAssets';
import * as T from 'three/webgpu';
import { color, float, normalView, positionViewDirection, texture } from 'three/tsl';
import { asset } from '../core/assets';
import { HULL_MATERIALS } from './ImportedFleet';
import mounts from '../../data/enemies/ground-hardpoints.json';
const loader = new T.TextureLoader(sceneAssetManager);
const cache = new Map<string, T.Texture>();
function map(path: string, srgb = false) {
  if (!cache.has(path)) {
    const tex = loader.load(asset(`/textures/emplacements/${path}.jpg`));
    tex.flipY = false;
    tex.anisotropy = 8;
    if (srgb) tex.colorSpace = T.SRGBColorSpace;
    cache.set(path, tex);
  }
  return cache.get(path)!;
}
/** Preserve the artist's UV paint, bolts, panel wear, normal and ORM maps. */
export function groundUnitMaterial(type: number) {
  const family = mounts[type].family;
  const ice = type >= 4;
  const albedo = map(`${family}_color`, true),
    orm = map(`${family}_orm`);
  const material = new T.MeshStandardNodeMaterial({
    vertexColors: true,
    map: albedo,
    normalMap: map(`${family}_normal`),
    roughnessMap: orm,
    metalnessMap: orm,
    aoMap: orm,
    color: ice ? '#c1e4f3' : '#dbb88d',
    metalness: 0.78,
    roughness: 0.85,
    aoMapIntensity: 0.85,
    normalScale: new T.Vector2(0.9, family === 'sentinel' ? -0.9 : 0.9),
  });
  const rim = float(1).sub(normalView.dot(positionViewDirection).clamp(0, 1)).pow(3);
  material.emissiveNode = texture(albedo)
    .rgb.mul(0.045)
    .add(
      color(ice ? '#64b9df' : '#e59151')
        .mul(rim)
        .mul(0.15),
    );
  HULL_MATERIALS.add(material);
  return material;
}
