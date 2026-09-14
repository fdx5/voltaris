import * as T from 'three/webgpu';
import {
  attribute,
  bumpMap,
  color,
  float,
  mix,
  normalGeometry,
  normalView,
  positionGeometry,
  positionViewDirection,
  texture,
  triplanarTexture,
  vec3,
} from 'three/tsl';
import { asset } from '../core/assets';
import { HULL_MATERIALS } from './ImportedFleet';

/**
 * The finish on surface emplacements. The turret and tank models carry paint
 * roles instead of textures (see tools/pack-ground-units.mjs): red - light
 * plate, green - dark plate, blue - bare metal, none - rubber. Each sector
 * paints them its own way, and a scanned metal plate (Poly Haven, CC0) laid on
 * triplanar - the models have no UVs - supplies panel seams, wear, roughness
 * breakup and bump. Upward faces gather the sector's dust: sulphur on Io,
 * frost in the glacial vault.
 */
type Theme = {
  light: string;
  dark: string;
  metal: string;
  rubber: string;
  dust: string;
  rim: string;
};
const THEMES: Record<'io' | 'ice', Theme> = {
  io: {
    light: '#7d6548',
    dark: '#2b2926',
    metal: '#7b7f84',
    rubber: '#151413',
    dust: '#b8923a',
    rim: '#ffb070',
  },
  ice: {
    light: '#98a4ae',
    dark: '#34404d',
    metal: '#8a949c',
    rubber: '#16191d',
    dust: '#e6f2fa',
    rim: '#9fd8ff',
  },
};
/** Emplacement types flown over the ice; the rest stand on Io. */
const ICE_TYPES = new Set([4, 5, 6, 7, 8, 9, 10, 11]);

const loader = new T.TextureLoader();
const maps = new Map<string, T.Texture>();
function map(name: string, srgb: boolean) {
  let tex = maps.get(name);
  if (!tex) {
    tex = loader.load(asset(`/textures/materials/${name}`));
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.anisotropy = 8;
    if (srgb) tex.colorSpace = T.SRGBColorSpace;
    maps.set(name, tex);
  }
  return tex;
}

export function groundUnitMaterial(type: number) {
  const theme = THEMES[ICE_TYPES.has(type) ? 'ice' : 'io'];
  const material = new T.MeshStandardNodeMaterial({ vertexColors: true });
  // Raw model-space position and normal: instancing moves the unit, and the
  // grain has to stay painted on rather than swim across it.
  const tri = (tex: T.Texture) =>
    triplanarTexture(texture(tex), null, null, float(1.8), positionGeometry, normalGeometry);
  const paint = attribute<'vec3'>('paint', 'vec3');
  const rubber = float(1).sub(paint.r).sub(paint.g).sub(paint.b).clamp(0, 1);
  const base = color(theme.light)
    .mul(paint.r)
    .add(color(theme.dark).mul(paint.g))
    .add(color(theme.metal).mul(paint.b))
    .add(color(theme.rubber).mul(rubber));
  const grain = tri(map('metal_plate_02_color.jpg', true)).rgb;
  const luminance = grain.dot(vec3(0.299, 0.587, 0.114));
  const height = tri(map('metal_plate_02_height.jpg', false)).r;
  // The scan's value carries seams, chips and streaks into the paint.
  const worn = base.mul(mix(float(0.45), float(1.45), luminance.mul(2.2).clamp(0, 1)));
  // Soot and shadow: undersides and the skirt near the deck read darker, the
  // cheap stand-in for occlusion that keeps a flat-lit hull from looking painted on.
  const under = normalGeometry.y.negate().clamp(0, 1).mul(0.45);
  const skirt = float(1).sub(positionGeometry.y.div(0.35).clamp(0, 1)).mul(0.35);
  const grimed = worn.mul(float(1).sub(under).sub(skirt).clamp(0.3, 1));
  // Dust settles on what faces up, thickest in the plate's low spots.
  const upward = normalGeometry.y.clamp(0, 1).pow(2.5);
  const dust = upward.mul(float(1.15).sub(height)).mul(0.62).clamp(0, 0.85);
  material.colorNode = mix(grimed, color(theme.dust), dust);
  const rough = tri(map('metal_plate_02_rough.jpg', false)).r;
  material.roughnessNode = mix(float(0.62), float(0.34), paint.b)
    .mul(mix(float(0.75), float(1.25), rough))
    .add(dust.mul(0.3))
    .clamp(0.12, 1);
  material.metalnessNode = paint.b
    .mul(0.85)
    .add(paint.r.add(paint.g).mul(0.28))
    .mul(float(1).sub(dust));
  material.normalNode = bumpMap(height, float(0.35));
  // A cool or warm rim keeps the silhouette against the terrain behind it.
  const facing = normalView.dot(positionViewDirection).clamp(0, 1);
  material.emissiveNode = color(theme.rim).mul(float(1).sub(facing).pow(3)).mul(0.35);
  HULL_MATERIALS.add(material);
  return material;
}
