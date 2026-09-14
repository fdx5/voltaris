// Repackage the downloaded CC0 spaceships (tools/import-space-assets.mjs) into one
// runtime GLB. Every roster slot in data/enemies/imported-fleet.json becomes one
// node with a single primitive and a single material, so the renderer can draw a
// whole enemy family as one instanced batch.
//
// - Geometry is baked to world space; artist topology, normals and UVs are kept.
//   Boss hulls use the full-detail meshes, simplified to a fixed budget.
// - Textures stay at their native resolution (2048 px Quaternius, 1024 px Polyy).
//   A model with several materials gets an atlas: each textured material keeps its
//   own pixel-exact cell, flat-colour materials become swatches in a strip.
// - Base colour and metallic-roughness are WebP; geometry is meshopt-compressed.
import { writeFleetParts } from './fleet-parts.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { mergeDocuments, meshopt, simplify, unpartition, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const VENDOR = '.local/vendor';
const roster = JSON.parse(await readFile('data/enemies/imported-fleet.json', 'utf8'));
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;

const BOSS_TRIANGLES = 60000;
const SWATCH = 64;

function sourcePath({ pack, model, detail }) {
  if (pack === 'quaternius') return `${VENDOR}/${model}.gltf`;
  if (pack === 'polyy1') return `${VENDOR}/packs/p1/${model}.glb`;
  if (pack === 'polyy2')
    return detail === 'full'
      ? `${VENDOR}/packs/p2/3D_spaceships_pack_2/models/${model}.glb`
      : `${VENDOR}/packs/p2low/3D_spaceships_pack_2_low/models/${model}_low.glb`;
  throw new Error(`Unknown pack ${pack}`);
}

async function rgba(bytes, width, height) {
  let image = sharp(bytes).ensureAlpha();
  if (width) image = image.resize(width, height, { fit: 'fill' });
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Collect every primitive of a source scene with its world matrix. */
function primitives(doc) {
  const out = [];
  for (const scene of doc.getRoot().listScenes())
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      const matrix = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) out.push({ prim, matrix });
    });
  return out;
}

const transformPoint = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

async function buildModel(slot, spec) {
  const source = await io.read(sourcePath(spec));
  const parts = primitives(source);
  // One atlas cell per distinct (image, colour factor); one swatch per flat material.
  const cells = new Map();
  const swatches = new Map();
  let externalBase = null;
  if (spec.pack === 'quaternius') {
    const file = `${VENDOR}/${spec.model}_${spec.finish}.png`;
    externalBase = await readFile(file);
  }
  for (const { prim } of parts) {
    const mat = prim.getMaterial();
    const base = externalBase ? { image: externalBase } : mat?.getBaseColorTexture()?.getImage();
    const factor = mat?.getBaseColorFactor() ?? [1, 1, 1, 1];
    const mr = externalBase ? null : (mat?.getMetallicRoughnessTexture()?.getImage() ?? null);
    const metal = externalBase ? 0.35 : (mat?.getMetallicFactor() ?? 1);
    const rough = externalBase ? 0.56 : (mat?.getRoughnessFactor() ?? 1);
    if (base) {
      const bytes = externalBase ?? base;
      const key = `${cells.size}`;
      let found = [...cells.values()].find(
        (c) => c.bytes === bytes && c.mr === mr && c.factor.join() === factor.join(),
      );
      if (!found) {
        found = { key, bytes, factor, mr, metal, rough };
        cells.set(key, found);
      }
      prim.setExtras({ cell: found });
    } else {
      const key = [...factor, metal, rough].join();
      if (!swatches.has(key)) swatches.set(key, { index: swatches.size, factor, metal, rough });
      prim.setExtras({ swatch: swatches.get(key) });
    }
  }
  // Decode cells at a common width, the largest native one.
  const decoded = [];
  for (const cell of cells.values()) {
    const meta = await sharp(cell.bytes).metadata();
    decoded.push({ cell, width: meta.width, height: meta.height });
  }
  const W = Math.max(512, ...decoded.map((d) => d.width));
  let y = 0;
  for (const d of decoded) {
    d.height = Math.round((d.height * W) / d.width);
    d.width = W;
    d.y = y;
    y += d.height;
  }
  const perRow = W / SWATCH;
  const stripRows = Math.ceil(swatches.size / perRow);
  const H = y + stripRows * SWATCH;
  const colour = Buffer.alloc(W * H * 4, 255);
  const surface = Buffer.alloc(W * H * 4, 255);
  const hasMR = !externalBase;
  for (const d of decoded) {
    const img = await rgba(d.cell.bytes, d.width, d.height);
    const f = d.cell.factor;
    for (let i = 0; i < d.width * d.height; i++) {
      const o = d.y * W * 4 + i * 4;
      colour[o] = Math.round(img.data[i * 4] * f[0]);
      colour[o + 1] = Math.round(img.data[i * 4 + 1] * f[1]);
      colour[o + 2] = Math.round(img.data[i * 4 + 2] * f[2]);
      colour[o + 3] = 255;
    }
    const mr = d.cell.mr ? await rgba(d.cell.mr, d.width, d.height) : null;
    for (let i = 0; i < d.width * d.height; i++) {
      const o = d.y * W * 4 + i * 4;
      surface[o] = 255;
      surface[o + 1] = Math.round((mr ? mr.data[i * 4 + 1] : 255) * d.cell.rough);
      surface[o + 2] = Math.round((mr ? mr.data[i * 4 + 2] : 255) * d.cell.metal);
    }
  }
  for (const s of swatches.values()) {
    const sx = (s.index % perRow) * SWATCH,
      sy = y + Math.floor(s.index / perRow) * SWATCH;
    for (let py = 0; py < SWATCH; py++)
      for (let px = 0; px < SWATCH; px++) {
        const o = ((sy + py) * W + sx + px) * 4;
        colour[o] = Math.round(Math.min(1, s.factor[0]) ** (1 / 2.2) * 255);
        colour[o + 1] = Math.round(Math.min(1, s.factor[1]) ** (1 / 2.2) * 255);
        colour[o + 2] = Math.round(Math.min(1, s.factor[2]) ** (1 / 2.2) * 255);
        surface[o + 1] = Math.round(s.rough * 255);
        surface[o + 2] = Math.round(s.metal * 255);
      }
    s.u = (sx + SWATCH / 2) / W;
    s.v = (sy + SWATCH / 2) / H;
  }

  // Merge geometry into one primitive with remapped UVs.
  const pos = [],
    nor = [],
    uv = [],
    idx = [];
  let clamped = 0;
  for (const { prim, matrix } of parts) {
    const p = prim.getAttribute('POSITION'),
      n = prim.getAttribute('NORMAL'),
      t = prim.getAttribute('TEXCOORD_0');
    const { cell, swatch } = prim.getExtras();
    const d = cell && decoded.find((x) => x.cell === cell);
    const offset = pos.length / 3;
    const a = [0, 0, 0],
      b = [0, 0, 0],
      c = [0, 0];
    // Normal matrix: the source nodes only carry rotation and uniform scale.
    const m = matrix;
    for (let i = 0; i < p.getCount(); i++) {
      p.getElement(i, a);
      pos.push(...transformPoint(m, a[0], a[1], a[2]));
      n.getElement(i, b);
      const nx = m[0] * b[0] + m[4] * b[1] + m[8] * b[2],
        ny = m[1] * b[0] + m[5] * b[1] + m[9] * b[2],
        nz = m[2] * b[0] + m[6] * b[1] + m[10] * b[2];
      const len = Math.hypot(nx, ny, nz) || 1;
      nor.push(nx / len, ny / len, nz / len);
      if (d) {
        t.getElement(i, c);
        if (c[0] < -0.001 || c[0] > 1.001 || c[1] < -0.001 || c[1] > 1.001) clamped++;
        const u = Math.min(1, Math.max(0, c[0])),
          v = Math.min(1, Math.max(0, c[1]));
        uv.push(u, (d.y + v * d.height) / H);
      } else uv.push(swatch.u, swatch.v);
    }
    const indices = prim.getIndices();
    if (indices)
      for (let i = 0; i < indices.getCount(); i++) idx.push(offset + indices.getScalar(i));
    else for (let i = 0; i < p.getCount(); i++) idx.push(offset + i);
  }
  if (clamped) console.warn(`${slot}: ${clamped} UVs outside 0-1 clamped`);

  const doc = new Document();
  const buffer = doc.createBuffer();
  const accessor = (array, type) =>
    doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', accessor(new Float32Array(pos), 'VEC3'))
    .setAttribute('NORMAL', accessor(new Float32Array(nor), 'VEC3'))
    .setAttribute('TEXCOORD_0', accessor(new Float32Array(uv), 'VEC2'))
    .setIndices(accessor(new Uint32Array(idx), 'SCALAR'));
  const webp = (raw, quality) =>
    sharp(raw, { raw: { width: W, height: H, channels: 4 } })
      .removeAlpha()
      .webp({ quality, effort: 6 })
      .toBuffer();
  const material = doc
    .createMaterial(slot)
    .setBaseColorTexture(
      doc
        .createTexture(`${slot}_color`)
        .setImage(await webp(colour, 92))
        .setMimeType('image/webp'),
    )
    .setMetallicFactor(hasMR ? 1 : 0.35)
    .setRoughnessFactor(hasMR ? 1 : 0.56);
  if (hasMR)
    material.setMetallicRoughnessTexture(
      doc
        .createTexture(`${slot}_surface`)
        .setImage(await webp(surface, 88))
        .setMimeType('image/webp'),
    );
  prim.setMaterial(material);
  const node = doc.createNode(slot).setMesh(doc.createMesh(slot).addPrimitive(prim));
  doc.createScene().addChild(node);
  await doc.transform(weld());
  const before = idx.length / 3;
  if (spec.detail === 'full' && before > BOSS_TRIANGLES)
    await doc.transform(
      simplify({ simplifier: MeshoptSimplifier, ratio: BOSS_TRIANGLES / before, error: 0.002 }),
    );
  const after =
    doc
      .getRoot()
      .listAccessors()
      .find((x) => x.getType() === 'SCALAR')
      .getCount() / 3;
  return {
    doc,
    record: {
      slot,
      pack: spec.pack,
      model: spec.model + (spec.finish ? ` (${spec.finish})` : ''),
      sourceTriangles: before,
      triangles: after,
      texture: `${W}x${H}`,
      materials: cells.size + swatches.size,
    },
  };
}

const slots = [
  ['player', roster.player],
  ...roster.enemies.map((e, i) => [`enemy_${String(i).padStart(2, '0')}`, e]),
  ...roster.ground.map((e, i) => [`ground_${String(i).padStart(2, '0')}`, e]),
  ...Object.entries(roster.bosses).flatMap(([name, b]) => [
    [`boss_${name}`, b.hull],
    [`pod_${name}`, b.pod],
  ]),
];
const used = new Map();
for (const [slot, spec] of slots) {
  const key = `${spec.pack}/${spec.model}`;
  if (used.has(key)) throw new Error(`${slot} reuses ${key} from ${used.get(key)}`);
  used.set(key, slot);
}

const out = new Document();
out.createBuffer();
const records = [];
for (const [slot, spec] of slots) {
  const { doc, record } = await buildModel(slot, spec);
  mergeDocuments(out, doc);
  records.push(record);
  console.log(
    slot.padEnd(16),
    record.model.padEnd(28),
    `${record.sourceTriangles}→${record.triangles} tris`,
    record.texture,
  );
}
// One scene holding every node, one buffer.
const [scene, ...extra] = out.getRoot().listScenes();
for (const s of extra) {
  for (const child of s.listChildren()) scene.addChild(child);
  s.dispose();
}
out.createExtension(EXTTextureWebP).setRequired(true);
await out.transform(unpartition(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await mkdir('public/models/imported', { recursive: true });
const glb = await io.writeBinary(out);
// Published as sub-20 MB parts for the CDN; see tools/fleet-parts.mjs.
await writeFleetParts(glb);
await writeFile(
  'public/models/imported/manifest.json',
  JSON.stringify({ packs: roster.packs, models: records }, null, 2) + '\n',
);
console.log(`${records.length} models, ${(glb.length / 1048576).toFixed(2)} MiB`);
