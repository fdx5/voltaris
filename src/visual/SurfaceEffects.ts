import * as T from 'three/webgpu';
import {
  attribute,
  color,
  cos,
  float,
  fract,
  mix,
  mx_noise_float,
  normalMap,
  positionLocal,
  sin,
  smoothstep,
  texture,
  time,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { Random } from '../core/math/Random';
import type { Terrain } from '../core/math/Terrain';
import { asset } from '../core/assets';
import { map } from './TerrainMaterial';

/**
 * Atmosphere for the two surface sectors. Everything animates on the GPU from
 * per-instance seeds and the renderer clock, so none of it costs a draw-call
 * update or a matrix upload per frame.
 *
 * - Io: embers and ash rising off the lava fields, sulphur plumes - the
 *   umbrella eruptions Io is known for - standing on the far horizon, and a
 *   trio of active volcanoes further back that surge into full eruption on
 *   a slow cycle.
 * - Glacial vault: icicles hanging from the vault, ice glitter falling through
 *   the corridor, and cold mist rolling over the deck.
 */

/**
 * A drifting cloud of glowing motes. `rise` is world units a second, negative
 * to fall; `drift` slides the cloud to the left so it keeps pace with the
 * scrolling ground rather than hanging in place.
 */
function motes(
  count: number,
  box: { x: number; y: [number, number]; z: [number, number] },
  look: { hot: string; cool: string; size: [number, number]; rise: number; drift: number },
  seed: number,
) {
  const rng = new Random(seed);
  const geometry = new T.PlaneGeometry(1, 1);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) seeds[i] = rng.next();
  geometry.setAttribute('mote', new T.InstancedBufferAttribute(seeds, 4));
  const material = new T.MeshBasicNodeMaterial({
    transparent: true,
    blending: T.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const s = attribute<'vec4'>('mote', 'vec4');
  const height = box.y[1] - box.y[0];
  // Each mote cycles through the box on its own clock and speed.
  const cycle = fract(
    time
      .mul(s.w.mul(0.6).add(0.4))
      .mul(Math.abs(look.rise) / height)
      .add(s.y),
  );
  const y =
    look.rise > 0 ? cycle.mul(height).add(box.y[0]) : float(box.y[1]).sub(cycle.mul(height));
  const x = fract(s.x.sub(time.mul(look.drift / box.x)))
    .sub(0.5)
    .mul(box.x)
    .add(sin(time.mul(s.w.mul(1.7).add(0.6)).add(s.z.mul(40))).mul(0.35));
  const z = s.z.mul(box.z[1] - box.z[0]).add(box.z[0]);
  const size = s.w.mul(look.size[1] - look.size[0]).add(look.size[0]);
  material.positionNode = vec3(x, y, z).add(positionLocal.mul(size));
  // Soft round sprite that fades in low and out high, cooling as it goes.
  const r = uv().sub(0.5).length().mul(2);
  const life = smoothstep(0, 0.15, cycle).mul(float(1).sub(smoothstep(0.7, 1, cycle)));
  material.colorNode = mix(color(look.cool), color(look.hot), float(1).sub(cycle)).mul(2.2);
  material.opacityNode = float(1).sub(r).clamp(0, 1).pow(1.6).mul(life);
  const mesh = new T.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = 30;
  return mesh;
}

/** Io's sulphur plumes: tall additive fountains that bloom into an umbrella canopy. */
function plumes(terrain: Terrain, span: number, far: number) {
  const group = new T.Group();
  const material = new T.MeshBasicNodeMaterial({
    transparent: true,
    blending: T.AdditiveBlending,
    depthWrite: false,
    side: T.DoubleSide,
    toneMapped: false,
  });
  const p = uv();
  const column = float(1)
    .sub(p.x.sub(0.5).abs().mul(2).div(p.y.mul(0.9).add(0.12)))
    .clamp(0, 1);
  const canopy = float(1)
    .sub(vec2(p.x.sub(0.5).mul(1.1), p.y.sub(0.82).mul(3.2)).length().mul(1.6))
    .clamp(0, 1);
  const shimmer = sin(time.mul(0.7).add(p.y.mul(9)))
    .mul(0.12)
    .add(0.88);
  const shape = column
    .mul(float(1).sub(smoothstep(0.55, 0.85, p.y)))
    .max(canopy)
    .mul(shimmer);
  material.colorNode = mix(color('#ffe7a6'), color('#7fb8ff'), p.y.clamp(0, 1).pow(1.5)).mul(0.9);
  material.opacityNode = shape
    .pow(1.4)
    .mul(float(1).sub(smoothstep(0.92, 1, p.y)))
    .mul(0.5);
  const geometry = new T.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const rng = new Random(5117);
  // Three tiles of the scrolling strip, two eruptions a tile, so the wrap is seamless.
  for (let tile = -1; tile <= 1; tile++)
    for (const at of [0.23, 0.71]) {
      const x = (at + (rng.next() - 0.5) * 0.08) * span - span / 2 + tile * span;
      const z = far + 6 + rng.next() * 4;
      const plume = new T.Mesh(geometry, material);
      const height = 16 + rng.next() * 9;
      plume.scale.set(height * 0.75, height, 1);
      plume.position.set(x, terrain.height(x, z) - 0.5, z);
      group.add(plume);
    }
  return group;
}

/**
 * A trio of active volcanoes on the horizon: basalt cones laced with lava
 * veins that breathe with the eruption, a turbulent flame column at each
 * crater that surges into a full eruption on a slow shared cycle, molten
 * bombs flung out on ballistic arcs during the surge, and an ash plume
 * climbing off the flame into the sky.
 *
 * Every shape is built in normalised 0-1 (or -1..1) unit space and stretched
 * to size per instance with an ordinary mesh scale, so one shared material
 * per part serves every cone/flame/plume - the same trick `plumes` uses.
 * Only the bombs need world-scale math, done inside the shader in units of
 * the volcano's own height so a single mesh scale (by height) puts them at
 * the right reach; that only holds because radius is always a fixed
 * fraction of height, never randomised independently.
 */
function volcano(terrain: Terrain, span: number, far: number) {
  const RADIUS_RATIO = 0.66;
  const period = 6.4;
  // Sudden build, slower fiery decay, then a low simmer for the rest of the
  // cycle - reads as "explodes, then settles" rather than a steady breathing.
  const cyclePhase = fract(time.div(period));
  const surge = smoothstep(0, 0.09, cyclePhase).mul(
    float(1).sub(smoothstep(0.09, 0.5, cyclePhase)),
  );
  const energy = surge.add(0.22);

  // The cone wears the same photographed basalt scan the Io deck is built
  // from (fetched once, shared through TerrainMaterial's texture cache), so
  // its flanks carry real cliff detail instead of a flat procedural tint.
  // Two tilings blended by a broad mask - `TerrainMaterial`'s anti-repeat
  // trick - keep the scan from reading as one stretched decal up close.
  const coneGeo = new T.ConeGeometry(1, 1, 18, 7).translate(0, 0.5, 0);
  const coneMat = new T.MeshStandardNodeMaterial({ metalness: 0 });
  const ny = positionLocal.y.clamp(0, 1);
  const ROCK_TILE = 3.4;
  const fineRock = uv().mul(ROCK_TILE);
  const broadRock = uv().mul(ROCK_TILE * 0.31).add(vec2(0.42, 0.17));
  const rockBlend = texture(map('terrain/dark_rock_rough.jpg', false), uv().mul(ROCK_TILE * 0.12))
    .r.smoothstep(0.3, 0.7)
    .mul(0.35);
  const pickRock = (path: string, srgb: boolean) => {
    const tex = map(path, srgb);
    return mix(texture(tex, fineRock), texture(tex, broadRock), rockBlend);
  };
  const rockColor = pickRock('terrain/dark_rock_color.jpg', true).rgb;
  const rockNormal = pickRock('terrain/dark_rock_normal.jpg', false).rgb;
  const rockRough = pickRock('terrain/dark_rock_rough.jpg', false).r;
  const rockHeight = pickRock('terrain/dark_rock_height.jpg', false).r;
  // A little cooler and darker toward the base, warmer near the rim where
  // the rock has cooked - a tint over the scan, not a replacement for it.
  coneMat.colorNode = rockColor
    .mul(mix(color('#5f5049'), color('#a4826a'), ny.pow(1.6)))
    .mul(mx_noise_float(positionLocal.mul(3.2)).mul(0.08).add(0.96));
  coneMat.normalNode = normalMap(rockNormal, vec2(1.5));
  coneMat.roughnessNode = rockRough.clamp(0.2, 1);
  // Lava veins follow the scan's own crevices (its height map's low texels),
  // biased by a downhill streak from the crater so they read as flow rather
  // than scattered noise, and breathing with the eruption's energy. The scan
  // measures darkest around 0.16 and clusters between 0.55 and 0.85 (median
  // ~0.71), not the 0-1 spread a synthetic height map would have, so the
  // crack threshold is calibrated against that real distribution rather than
  // the middle of the nominal range.
  const realCrack = float(1).sub(smoothstep(0.4, 0.62, rockHeight)).clamp(0, 1);
  const flowBias = sin(
    uv()
      .x.mul(22)
      .add(mx_noise_float(vec3(uv().x.mul(4), uv().y.mul(3), 0)).mul(6)),
  )
    .mul(0.5)
    .add(0.5)
    .clamp(0, 1)
    .pow(2.5);
  const breathe = sin(time.mul(1.2).add(uv().x.mul(5))).mul(0.25).add(0.85);
  const vein = realCrack
    .mul(flowBias.mul(0.85).add(0.15))
    .mul(breathe)
    .mul(smoothstep(0.08, 0.95, ny));
  coneMat.emissiveNode = color('#ff4a10').mul(vein.mul(energy.mul(1.3).add(1.3)));

  const craterGeo = new T.CircleGeometry(1, 24);
  const craterMat = new T.MeshBasicNodeMaterial({
    transparent: true,
    blending: T.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const cr = uv().sub(0.5).length().mul(2);
  // The same rock scan, scrolled slowly, mottles the pool so it reads as
  // roiling melt instead of a flat radial gradient.
  const boil = texture(
    map('terrain/dark_rock_height.jpg', false),
    uv().mul(2.4).add(vec2(time.mul(0.05), time.mul(-0.035))),
  ).r;
  craterMat.colorNode = mix(
    color('#fff1b0'),
    color('#ff4a10'),
    // Centred on the scan's own median (0.71), not the nominal 0.5, so the
    // mottling actually swings both warmer and cooler instead of biasing hot.
    cr.add(boil.sub(0.71).mul(0.9)).clamp(0, 1),
  ).mul(2.4);
  craterMat.opacityNode = float(1).sub(cr).clamp(0, 1).pow(1.6).mul(energy.mul(0.8).add(0.4));

  // The camera never swings far around the deck, so - as with `plumes` - a
  // single plane facing it reads fine; crossing a pair would just double up
  // brightness along the shared seam and look like a blade, not fire.
  const flameGeo = new T.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const flameMat = new T.MeshBasicNodeMaterial({
    transparent: true,
    blending: T.AdditiveBlending,
    depthWrite: false,
    side: T.DoubleSide,
    toneMapped: false,
  });
  const fp = uv();
  // How far up its own plane the flame currently reaches, in 0-1: a low
  // simmer normally, reaching almost to the top of the plane on the surge.
  const reach = energy.mul(0.62).add(0.16).clamp(0.1, 1);
  // Three independently-wobbling tongues, unioned, so the silhouette breaks
  // up into licks of fire instead of one smooth triangular glow.
  const tongueAt = (center: number, seed: number, weight: number) => {
    const wobble = mx_noise_float(
      vec3(fp.x.mul(2.6).add(seed), fp.y.mul(4).sub(time.mul(2.6 + seed * 0.4)), seed),
    ).mul(0.15);
    const jag = mx_noise_float(
      vec3(fp.y.mul(11).sub(time.mul(4.5)).add(seed), seed * 1.7, fp.x.mul(2)),
    )
      .abs()
      .mul(0.05);
    const width = float(1)
      .sub(fp.y.div(reach).clamp(0, 1))
      .pow(0.7)
      .mul(0.24)
      .add(0.018)
      .add(jag);
    const cx = fp.x.sub(0.5).sub(center).add(wobble);
    return float(1).sub(cx.abs().div(width)).clamp(0, 1).mul(weight);
  };
  const tongue = tongueAt(0, 0, 1).max(tongueAt(-0.16, 3.1, 0.75)).max(tongueAt(0.17, 6.4, 0.75));
  // smoothstep is only defined for edge0 < edge1 - GLSL leaves a reversed
  // pair undefined (this backend just returns ~1 throughout), so the falling
  // ramp has to be built by inverting an ascending one, not by swapping args.
  const rise = float(1).sub(smoothstep(reach.mul(0.4), reach.mul(1.05), fp.y));
  // A real cracked-rock scan, fast-scrolled, layers in fine-grained flicker
  // that pure Perlin noise reads as too smooth at this scale.
  const grain = texture(
    map('terrain/sandstone_cracks_height.jpg', false),
    vec2(fp.x.mul(3).add(time.mul(0.6)), fp.y.mul(2).sub(time.mul(1.4))),
  ).r;
  const flicker = mx_noise_float(vec3(fp.x.mul(7), time.mul(10), fp.y.mul(2)))
    .mul(0.22)
    .add(0.88)
    .mul(grain.mul(0.3).add(0.85));
  // White only right at the crater mouth; orange through the body, deepening
  // to red near the tip - keeps bloom from washing the whole flame out white.
  const heat = fp.y.div(reach.max(0.05)).clamp(0, 1);
  flameMat.colorNode = mix(
    mix(color('#fff2c0'), color('#ff9a2e'), heat.pow(0.32)),
    color('#e02a10'),
    heat.pow(1.6),
  ).mul(1.7);
  // pow()'s base is clamped first: floating-point rounding in tongue*rise
  // can land a hair below 0, and an unclamped negative base turns pow() into
  // NaN, which spreads through the bloom pass - see the note in `mist` below.
  flameMat.opacityNode = tongue
    .mul(rise)
    .mul(flicker)
    .clamp(0, 1)
    .pow(1.1)
    .mul(energy.clamp(0.3, 1.3));

  // A soft, non-additive ash plume climbing off the flame. Kept warm and
  // light enough near the base to read against the void of space, cooling to
  // grey higher up rather than fading to near-black and vanishing.
  const smokeGeo = new T.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const smokeMat = new T.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
    toneMapped: false,
  });
  const sp = uv();
  // mx_noise_float is already centred on 0 (Perlin, not a 0-1 texture
  // lookup) - no re-centring needed, unlike the plain uv-texture noise used
  // elsewhere in this file.
  const drift = mx_noise_float(vec3(sp.x.mul(2.2), sp.y.mul(1.6).sub(time.mul(0.3)), 0)).mul(
    sp.y.mul(0.8),
  );
  const billow = mx_noise_float(vec3(sp.x.mul(4.5).add(time.mul(0.1)), sp.y.mul(2.6), 4))
    .mul(0.5)
    .add(0.5);
  const scx = sp.x.sub(0.5).add(drift);
  const body = float(1)
    .sub(scx.abs().mul(2).div(sp.y.mul(0.7).add(0.22)))
    .clamp(0, 1);
  const smokeShape = body
    .mul(billow.mul(0.6).add(0.4))
    .mul(smoothstep(0, 0.08, sp.y))
    .mul(float(1).sub(smoothstep(0.8, 1, sp.y)));
  // Warm right off the flame, cooling fast to a slate ash so it reads
  // against a bright backdrop (a planet's limb, not just black space).
  smokeMat.colorNode = mix(color('#e08a52'), color('#443f46'), sp.y.clamp(0, 1).pow(0.35));
  smokeMat.opacityNode = smokeShape.mul(energy.clamp(0.5, 1)).mul(0.75);

  const bombGeo = new T.IcosahedronGeometry(1, 0);
  const bombMat = new T.MeshBasicNodeMaterial({
    transparent: true,
    blending: T.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const s = attribute<'vec4'>('mote', 'vec4');
  // Each bomb launches once a cycle, in a short window right as the surge
  // hits, then arcs out and falls - all in units of the volcano's own height.
  const localCycle = fract(time.div(period).add(s.w.mul(0.08)));
  const flightT = localCycle.div(0.42).clamp(0, 1);
  const launched = smoothstep(0, 0.06, localCycle).mul(
    float(1).sub(smoothstep(0.06, 0.42, localCycle)),
  );
  const arc = flightT.mul(float(1).sub(flightT)).mul(4);
  const upY = arc.mul(1.3).add(s.z.mul(0.4));
  const ang = s.x.mul(6.2832);
  const dist = flightT.mul(RADIUS_RATIO).mul(s.y.mul(0.9).add(0.5));
  const bx = cos(ang).mul(dist);
  const bz = sin(ang).mul(dist);
  const size = s.z.mul(0.03).add(0.018);
  bombMat.positionNode = vec3(bx, float(0.95).add(upY), bz).add(positionLocal.mul(size));
  bombMat.colorNode = mix(color('#ffdd80'), color('#ff3a10'), flightT).mul(2.1);
  bombMat.opacityNode = launched
    .mul(smoothstep(0, 0.05, flightT))
    .mul(float(1).sub(smoothstep(0.85, 1, flightT)));

  // Vents on the flank, separate from the crater's fire: pale wisps of
  // vapour that never stop, unlike the flame's eruption cycle. Real cloud
  // photography (already on hand for the backdrop planet) drives their
  // wispy alpha - Perlin reads too regular at this scale to pass for steam.
  const steamGeo = new T.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const steamMat = new T.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
    toneMapped: false,
  });
  const vp = uv();
  const cloud = (u: ReturnType<typeof vec2>) => texture(map('planets/earth_clouds.png', true), u).a;
  const wisp = cloud(vec2(vp.x.mul(1.7).add(time.mul(0.05)), vp.y.mul(1.2).sub(time.mul(0.14))))
    .mul(0.6)
    .add(
      cloud(
        vec2(vp.x.mul(2.6).sub(time.mul(0.09)), vp.y.mul(1.8).sub(time.mul(0.07)).add(0.3)),
      ).mul(0.4),
    );
  const vcx = vp.x.sub(0.5);
  const vBody = float(1)
    .sub(vcx.abs().mul(2).div(vp.y.mul(0.9).add(0.2)))
    .clamp(0, 1);
  const steamShape = vBody
    .mul(wisp)
    .mul(smoothstep(0, 0.1, vp.y))
    .mul(float(1).sub(smoothstep(0.7, 1, vp.y)));
  steamMat.colorNode = mix(color('#eef4f6'), color('#c3cdd2'), vp.y.clamp(0, 1).pow(0.5));
  // Vents keep venting through the calm; the eruption only swells them a little.
  steamMat.opacityNode = steamShape.mul(energy.mul(0.25).add(0.75)).mul(1.4);

  const group = new T.Group();
  const siting = new Random(48117);
  for (let tile = -1; tile <= 1; tile++) {
    const x = span * 0.5 + (siting.next() - 0.5) * 8 + tile * span;
    const z = far - 14 - siting.next() * 10;
    const height = 15 + siting.next() * 5;
    const radius = height * RADIUS_RATIO;
    const one = new T.Group();
    one.position.set(x, terrain.height(x, z), z);

    const cone = new T.Mesh(coneGeo, coneMat);
    cone.scale.set(radius, height, radius);
    one.add(cone);

    const crater = new T.Mesh(craterGeo, craterMat);
    crater.scale.setScalar(radius * 0.4);
    crater.rotation.x = -Math.PI / 2;
    crater.position.y = height * 0.97;
    crater.renderOrder = 28;
    one.add(crater);

    const flameHeight = height * 1.7;
    const flame = new T.Mesh(flameGeo, flameMat);
    flame.scale.set(radius * 1.05, flameHeight, 1);
    flame.position.y = height * 0.92;
    flame.renderOrder = 31;
    one.add(flame);

    const smokeHeight = flameHeight * 1.3;
    const smoke = new T.Mesh(smokeGeo, smokeMat);
    smoke.scale.set(radius * 2.4, smokeHeight, 1);
    smoke.position.set(0, height * 0.9 + flameHeight * 0.3, radius * 0.5);
    smoke.renderOrder = 24;
    one.add(smoke);

    const count = 26;
    const bombs = new T.InstancedMesh(bombGeo.clone(), bombMat, count);
    const seeds = new Float32Array(count * 4);
    const rng = new Random(2300 + tile * 91);
    for (let i = 0; i < count * 4; i++) seeds[i] = rng.next();
    bombs.geometry.setAttribute('mote', new T.InstancedBufferAttribute(seeds, 4));
    bombs.scale.setScalar(height);
    bombs.position.y = 0;
    bombs.frustumCulled = false;
    bombs.renderOrder = 32;
    one.add(bombs);

    // Left unrotated, like the flame and smoke: the camera never swings far
    // around the deck, so a vent turned to its "true" outward angle would
    // often end up nearly edge-on and vanish instead of reading as steam.
    const ventRng = new Random(5500 + tile * 77);
    for (let v = 0; v < 3; v++) {
      const vSide = v === 1 ? 1 : -1;
      const vh = height * (0.32 + ventRng.next() * 0.4);
      const vx = vSide * radius * (1 - vh / height) * (0.35 + ventRng.next() * 0.4);
      const steamScale = height * (0.45 + ventRng.next() * 0.3);
      const steam = new T.Mesh(steamGeo, steamMat);
      steam.scale.set(steamScale * 0.5, steamScale, 1);
      steam.position.set(vx, vh, radius * 0.15 + ventRng.next() * radius * 0.1);
      steam.renderOrder = 26;
      one.add(steam);
    }

    group.add(one);
  }
  return group;
}

/** Icicles along the vault, seated on its actual height field and tapering down. */
function icicles(vault: Terrain, span: number, near: number, far: number) {
  const rng = new Random(90431);
  const count = 900;
  const geometry = new T.ConeGeometry(1, 1, 7, 1).rotateX(Math.PI).translate(0, -0.5, 0);
  const material = new T.MeshStandardNodeMaterial({
    color: '#bfe4f7',
    roughness: 0.12,
    metalness: 0.05,
    transparent: true,
    opacity: 0.9,
  });
  // Light caught inside the ice, brightest at the tips.
  material.emissiveNode = color('#3aa0e0')
    .mul(positionLocal.y.negate().add(0.1).clamp(0, 1))
    .mul(0.8);
  const mesh = new T.InstancedMesh(geometry, material, count);
  const dummy = new T.Object3D();
  let n = 0;
  for (let i = 0; i < count; i++) {
    const x = (rng.next() - 0.5) * span * 3;
    const z = far + rng.next() * (near - far) * 0.85;
    const length = 0.25 + Math.pow(rng.next(), 2.2) * 1.5;
    const width = length * (0.09 + rng.next() * 0.06);
    dummy.position.set(x, vault.height(x, z) + 0.05, z);
    dummy.scale.set(width, length, width);
    dummy.rotation.set((rng.next() - 0.5) * 0.12, rng.next() * 6.28, (rng.next() - 0.5) * 0.12);
    dummy.updateMatrix();
    mesh.setMatrixAt(n++, dummy.matrix);
  }
  mesh.count = n;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Cold mist: low sheets of drifting haze that thin out as they climb.
 *
 * Every pow() in this file clamps its base first: uv overshoots [0, 1] by a
 * hair at a plane's edge, a negative base makes pow() NaN, and one NaN pixel
 * is smeared across the whole frame by the bloom pass - the screen goes black.
 */
function mist(base: number, near: number) {
  const group = new T.Group();
  const noise = new T.TextureLoader().load(asset('/textures/terrain/snow_01_height.jpg'));
  noise.wrapS = noise.wrapT = T.RepeatWrapping;
  for (const [depth, lift, speed] of [
    [near - 12, 0.4, 0.018],
    [near - 26, 0.9, 0.011],
  ]) {
    const material = new T.MeshBasicNodeMaterial({
      transparent: true,
      blending: T.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const p = uv();
    const flow = texture(noise, vec2(p.x.mul(3).add(time.mul(speed)), p.y.mul(0.8))).r;
    const band = float(1)
      .sub(p.y)
      .clamp(0, 1)
      .pow(2.2)
      .mul(smoothstep(0, 0.12, p.y));
    material.colorNode = color('#7cc4ec');
    material.opacityNode = flow.smoothstep(0.35, 0.75).mul(band).mul(0.16);
    const sheet = new T.Mesh(new T.PlaneGeometry(160, 5), material);
    sheet.position.set(0, base + 2.5 + lift, depth);
    sheet.renderOrder = 25;
    group.add(sheet);
  }
  return group;
}

export type SurfaceEffects = {
  /** Scrolls with the deck. */
  deck: T.Object3D[];
  /** Scrolls with the vault. */
  vault: T.Object3D[];
  /** Stays in place; moves on its own. */
  still: T.Object3D[];
};

export function surfaceEffects(
  kind: 'lava' | 'ice',
  deck: Terrain,
  vault: Terrain | null,
  cfg: {
    span: number;
    near: number;
    far: number;
    base: number;
    roofNear?: number;
    roofFar?: number;
  },
): SurfaceEffects {
  if (kind === 'lava')
    return {
      deck: [plumes(deck, cfg.span, cfg.far), volcano(deck, cfg.span, cfg.far)],
      vault: [],
      still: [
        motes(
          260,
          { x: 44, y: [cfg.base - 1, cfg.base + 12], z: [-14, 6] },
          { hot: '#ffcf5a', cool: '#ff3a0a', size: [0.05, 0.16], rise: 1.6, drift: 3.5 },
          2203,
        ),
        motes(
          140,
          { x: 60, y: [cfg.base, cfg.base + 16], z: [-30, -12] },
          { hot: '#b39a86', cool: '#3d302a', size: [0.12, 0.35], rise: 0.7, drift: 2.2 },
          7741,
        ),
      ],
    };
  return {
    deck: [],
    vault: vault
      ? [icicles(vault, cfg.span, cfg.roofNear ?? cfg.near, cfg.roofFar ?? cfg.far)]
      : [],
    still: [
      motes(
        420,
        { x: 46, y: [cfg.base - 1, cfg.base + 15], z: [-12, 8] },
        { hot: '#ffffff', cool: '#9fd8ff', size: [0.03, 0.09], rise: -1.1, drift: 2.8 },
        3319,
      ),
      mist(cfg.base, cfg.near),
    ],
  };
}
