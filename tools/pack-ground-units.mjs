// Package the twelve surface emplacements - turrets, launchers and tanks from
// Quaternius' CC0 Turrets and Tanks packs - into one small runtime GLB, separate
// from the spaceship fleet.
//
//   node tools/pack-ground-units.mjs
//
// The packs ship as .blend files (downloaded to .local/vendor/packs/turrets and
// .local/vendor/packs/tanks). Each is exported to glTF with Blender once and
// cached in .local/vendor/ground/glb; set BLENDER to the executable if it is not
// at its default Windows location.
//
// The source models are untextured: their parts only carry material names
// (Light, Dark, Main, Main_Details, Wheels...). Those names become paint roles
// in COLOR_0 - red: light plate, green: dark plate, blue: bare metal, black:
// rubber - so the game can give every unit its sector's paint scheme and PBR
// finish. Each model is merged to a single primitive, stood on y = 0, centred
// on its footprint and turned so its gun points along +Z.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const OUT = 'public/models/imported/voltaris-ground-units.glb';
const CACHE = '.local/vendor/ground/glb';
const BLENDER =
  process.env.BLENDER ?? 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const roster = JSON.parse(await readFile('data/enemies/imported-fleet.json', 'utf8'));
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await MeshoptEncoder.ready;
const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );

/** Paint role for a source material name. */
function role(name) {
  if (/wheel/i.test(name)) return [0, 0, 0];
  if (/detail/i.test(name)) return [0, 0, 1];
  if (/dark/i.test(name)) return [0, 1, 0];
  return [1, 0, 0];
}

async function source(entry) {
  const glb = `${CACHE}/${entry.model}.glb`;
  if (!(await exists(glb))) {
    const blend = `.local/vendor/packs/${entry.pack === 'quaternius-tanks' ? 'tanks' : 'turrets'}/Blends__${entry.model}.blend`;
    await mkdir(CACHE, { recursive: true });
    execFileSync(BLENDER, [
      '-b',
      '--factory-startup',
      '-noaudio',
      '--python',
      'tools/blender/export-glb.py',
      '--',
      blend,
      glb,
    ]);
  }
  return io.read(glb);
}

const out = new Document();
const buffer = out.createBuffer();
const scene = out.createScene('ground');
const records = [];

for (const [i, entry] of roster.ground.entries()) {
  const slot = `ground_${String(i).padStart(2, '0')}`;
  const doc = await source(entry);
  const positions = [],
    normals = [],
    colors = [],
    indices = [];
  for (const s of doc.getRoot().listScenes())
    s.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      const m = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const base = positions.length / 3;
        const p = prim.getAttribute('POSITION'),
          n = prim.getAttribute('NORMAL');
        const paint = role(prim.getMaterial()?.getName() ?? '');
        const v = [],
          w = [];
        for (let k = 0; k < p.getCount(); k++) {
          p.getElement(k, v);
          positions.push(
            m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
            m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
            m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
          );
          n.getElement(k, w);
          const nx = m[0] * w[0] + m[4] * w[1] + m[8] * w[2],
            ny = m[1] * w[0] + m[5] * w[1] + m[9] * w[2],
            nz = m[2] * w[0] + m[6] * w[1] + m[10] * w[2];
          const len = Math.hypot(nx, ny, nz) || 1;
          normals.push(nx / len, ny / len, nz / len);
          colors.push(...paint);
        }
        const index = prim.getIndices();
        if (index)
          for (let k = 0; k < index.getCount(); k++) indices.push(base + index.getScalar(k));
        else for (let k = 0; k < p.getCount(); k++) indices.push(base + k);
      }
    });
  const count = positions.length / 3;
  // Stand the unit on y = 0, centred on its footprint (the lowest tenth).
  let minY = Infinity,
    maxY = -Infinity;
  for (let k = 0; k < count; k++) {
    minY = Math.min(minY, positions[k * 3 + 1]);
    maxY = Math.max(maxY, positions[k * 3 + 1]);
  }
  let fx = 0,
    fz = 0,
    fn = 0;
  for (let k = 0; k < count; k++)
    if (positions[k * 3 + 1] < minY + (maxY - minY) * 0.1) {
      fx += positions[k * 3];
      fz += positions[k * 3 + 2];
      fn++;
    }
  fx /= fn;
  fz /= fn;
  // The gun is whatever reaches furthest out horizontally in the upper half:
  // a barrel overhangs its mount, a tank's gun overhangs its glacis.
  let reach = 0,
    heading = 0;
  for (let k = 0; k < count; k++) {
    if (positions[k * 3 + 1] < minY + (maxY - minY) * 0.3) continue;
    const dx = positions[k * 3] - fx,
      dz = positions[k * 3 + 2] - fz,
      d = Math.hypot(dx, dz);
    if (d > reach) [reach, heading] = [d, Math.atan2(dx, dz)];
  }
  // Snap to the nearest axis so artist-square geometry stays square to the view.
  // Where a heavy mount outreaches the gun, the roster's `turn` (degrees) corrects it.
  const turn =
    -Math.round(heading / (Math.PI / 2)) * (Math.PI / 2) + ((entry.turn ?? 0) * Math.PI) / 180;
  const c = Math.cos(turn),
    s = Math.sin(turn);
  for (let k = 0; k < count; k++) {
    const x = positions[k * 3] - fx,
      z = positions[k * 3 + 2] - fz;
    positions[k * 3] = x * c + z * s;
    positions[k * 3 + 1] -= minY;
    positions[k * 3 + 2] = -x * s + z * c;
    const nx = normals[k * 3],
      nz = normals[k * 3 + 2];
    normals[k * 3] = nx * c + nz * s;
    normals[k * 3 + 2] = -nx * s + nz * c;
  }
  const prim = out
    .createPrimitive()
    .setAttribute(
      'POSITION',
      out.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer),
    )
    .setAttribute(
      'NORMAL',
      out.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer),
    )
    .setAttribute(
      'COLOR_0',
      out.createAccessor().setType('VEC3').setArray(new Float32Array(colors)).setBuffer(buffer),
    )
    .setIndices(
      out
        .createAccessor()
        .setType('SCALAR')
        .setArray(count > 65535 ? new Uint32Array(indices) : new Uint16Array(indices))
        .setBuffer(buffer),
    )
    .setMaterial(out.createMaterial(slot).setMetallicFactor(0.6).setRoughnessFactor(0.5));
  scene.addChild(out.createNode(slot).setMesh(out.createMesh(slot).addPrimitive(prim)));
  records.push({ slot, model: `${entry.pack}/${entry.model}`, triangles: indices.length / 3 });
}

await out.transform(weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
const glb = await io.writeBinary(out);
await writeFile(OUT, glb);
await writeFile(
  'data/enemies/ground-units-pack.json',
  JSON.stringify(
    { size: glb.length, sha256: createHash('sha256').update(glb).digest('hex') },
    null,
    2,
  ) + '\n',
);
console.log(records.map((r) => `${r.slot} ${r.model} ${r.triangles} tris`).join('\n'));
console.log(`${OUT}: ${(glb.length / 1024).toFixed(0)} KiB`);
