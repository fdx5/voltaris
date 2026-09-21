import { sceneAssetManager } from './SceneAssets';
import * as T from 'three/webgpu';
import {
  attribute,
  color,
  float,
  mix,
  normalLocal,
  normalMap,
  normalView,
  positionViewDirection,
  sin,
  smoothstep,
  texture,
  time,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { asset } from '../core/assets';

/** One scanned material: colour, tangent normal, roughness and (optionally) height maps. */
export type TerrainLayer = {
  color: string;
  normal: string;
  rough: string;
  height?: string;
  /** Multiplies the scan's colour: pushes a neutral rock towards the sector's mineral. */
  tint: string;
};
/**
 * A photographic surface for a ground stage, from Poly Haven CC0 scans. The
 * deck blends two layers by slope and height - `rock` on cliffs and crests,
 * `crust` on the flats - and each is sampled at two scales mixed by a broad
 * mask, so no tile repeats visibly across the 360-unit strip.
 */
export type TerrainPbr = {
  rock: TerrainLayer;
  crust: TerrainLayer;
  /** World units per texture repeat at the fine scale. */
  tile: number;
  /**
   * Molten rock glowing in the crust's cracks, strongest in the valleys (Io).
   * Crack and seam thresholds suit Poly Haven height scans, which sit roughly
   * between 0.5 and 0.85 rather than spanning the full range.
   */
  lava?: string;
  /** Cold light scattering up out of the ice's low spots (glacial vault). */
  glow?: string;
  /** Glints on crust grains that catch the light (snow). */
  sparkle?: number;
};

const loader = new T.TextureLoader(sceneAssetManager);
const cache = new Map<string, T.Texture>();
/** Shared texture cache keyed by `/textures/` path, so scenery reusing a
 * ground scan (the volcano's basalt, say) does not upload it twice. */
export function map(path: string, srgb: boolean) {
  let tex = cache.get(path);
  if (!tex) {
    tex = loader.load(asset(`/textures/${path}`));
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.anisotropy = 16;
    if (srgb) tex.colorSpace = T.SRGBColorSpace;
    cache.set(path, tex);
  }
  return tex;
}

/**
 * `flip` builds the cave vault: seen from below, lit only by bounce, and never
 * carrying crust - snow does not lie on a ceiling.
 */
export function terrainMaterial(pbr: TerrainPbr, flip: boolean) {
  const material = new T.MeshStandardNodeMaterial({
    vertexColors: true,
    metalness: 0,
    side: flip ? T.DoubleSide : T.FrontSide,
  });
  // The strip's uv is world x/z over the stage's tile size; a second, broader
  // sampling at an odd ratio is blended in wherever a low-frequency mask says,
  // which breaks up the repeat without any seam at the scroll boundary.
  const fine = uv();
  const broad = uv().mul(0.53).add(vec2(0.37, 0.61));
  const pick = (path: string, srgb: boolean) => {
    const tex = map(path, srgb);
    const mask = texture(map(pbr.rock.rough, false), uv().mul(0.043)).r.smoothstep(0.3, 0.7);
    return mix(texture(tex, fine), texture(tex, broad), mask.mul(0.3));
  };
  const rockColor = pick(pbr.rock.color, true).rgb.mul(color(pbr.rock.tint));
  const crustColor = pick(pbr.crust.color, true).rgb.mul(color(pbr.crust.tint));
  const rockHeight = pbr.rock.height ? pick(pbr.rock.height, false).r : float(0.5);
  const crustHeight = pbr.crust.height ? pick(pbr.crust.height, false).r : float(0.5);
  // Flats take crust, slopes and cliffs show bare rock; `lift` (0 valley, 1
  // crest) thins the crust on exposed ridges. The two heightmaps decide the
  // exact border, so the crust fills the rock's hollows first.
  const lift = attribute<'float'>('lift', 'float');
  const flat = smoothstep(0.62, 0.9, normalLocal.y.abs());
  // Broad patches, tens of units across, decide where the crust has formed at
  // all, so the plain breaks into fields of crust and outcrops of bare rock.
  const patches = texture(map(pbr.crust.height ?? pbr.crust.rough, false), uv().mul(0.031))
    .r.add(texture(map(pbr.rock.rough, false), uv().mul(0.083).add(vec2(0.2, 0.7))).r.mul(0.6))
    .smoothstep(0.55, 1.05);
  const coverage = flip
    ? float(0)
    : flat.mul(float(1).sub(lift.mul(0.85))).mul(patches.mul(0.85).add(0.15));
  const crust = smoothstep(
    float(0),
    float(0.28),
    coverage.add(crustHeight.sub(rockHeight).mul(0.45)).sub(0.36),
  ).clamp(0, 1);
  material.colorNode = mix(rockColor, crustColor, crust);
  const rockNormal = pick(pbr.rock.normal, false).rgb;
  const crustNormal = pick(pbr.crust.normal, false).rgb;
  material.normalNode = normalMap(mix(rockNormal, crustNormal, crust), vec2(flip ? 1.3 : 1.9));
  material.roughnessNode = mix(
    pick(pbr.rock.rough, false).r,
    pick(pbr.crust.rough, false).r,
    crust,
  ).clamp(0.08, 1);
  let emissive: T.Node<'vec3'> = vec3(0, 0, 0);
  if (pbr.lava) {
    // Cracks are the crust's lowest texels; the glow pools in valleys and
    // breathes slowly, each stretch on its own phase along the strip.
    const cracks = float(1)
      .sub(smoothstep(0.46, 0.52, crustHeight))
      .mul(crust.mul(0.7).add(0.3));
    const seams = float(1)
      .sub(smoothstep(0.43, 0.47, rockHeight))
      .mul(float(1).sub(crust));
    const valley = float(1).sub(smoothstep(0.12, 0.45, lift));
    const breathe = sin(time.mul(1.3).add(uv().x.mul(2.1)))
      .mul(0.3)
      .add(0.85);
    emissive = emissive.add(
      color(pbr.lava).mul(cracks.add(seams.mul(0.35)).mul(valley).mul(breathe).mul(3.2)),
    );
  }
  if (pbr.glow) {
    const hollow = float(1).sub(rockHeight).clamp(0, 1).pow(2.2).mul(float(1).sub(crust));
    emissive = emissive.add(
      color(pbr.glow)
        .mul(hollow)
        .mul(flip ? 0.7 : 0.35),
    );
  }
  if (pbr.sparkle) {
    // Tiny grains only glint at a grazing view, so the field twinkles as it scrolls.
    const grain = texture(map(pbr.crust.height ?? pbr.crust.rough, false), uv().mul(7.3)).r;
    const facing = float(1).sub(normalView.dot(positionViewDirection).abs());
    emissive = emissive.add(
      vec3(1, 1, 1).mul(smoothstep(0.6, 0.68, grain).mul(crust).mul(facing).mul(pbr.sparkle)),
    );
  }
  material.emissiveNode = emissive;
  return material;
}
