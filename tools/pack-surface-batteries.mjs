// Downloaded, UV-authored emplacements. Sources in GROUND-CREDITS.md.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Document, NodeIO } from '@gltf-transform/core';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import sharp from 'sharp';
const dir = '.local/vendor/rotary';
const poly = `${dir}/polygon/Turret_final PolygonDan`;
const io = new NodeIO();
const rotary = await io.read(`${dir}/source/turret/turret.glb`);
const obj = new OBJLoader().parse(await readFile(`${poly}/turret.obj`, 'utf8')).children[0]
  .geometry;
const defs = JSON.parse(await readFile('data/enemies/ground-defs.json', 'utf8'));
const doc = new Document(),
  buffer = doc.createBuffer(),
  scene = doc.createScene('emplacements');
const hardpoints = [];
const variants = [0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0];
const lengths = [1, 1, 1.13, 0.86, 0.94, 1.08, 0.9, 1.12, 0.87, 1.03, 1.18, 1.08];
function emit(name, vertices) {
  const prim = doc.createPrimitive();
  for (const [key, size, field] of [
    ['POSITION', 3, 'p'],
    ['NORMAL', 3, 'n'],
    ['TEXCOORD_0', 2, 'uv'],
  ]) {
    prim.setAttribute(
      key,
      doc
        .createAccessor()
        .setType(size === 2 ? 'VEC2' : 'VEC3')
        .setArray(new Float32Array(vertices.flatMap((v) => v[field])))
        .setBuffer(buffer),
    );
  }
  scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
}
// Split the tripod by connected authored components, never by cutting triangles.
const pos = obj.attributes.position,
  ids = new Map(),
  parent = [];
function id(i) {
  const key = [pos.getX(i), pos.getY(i), pos.getZ(i)].map((v) => v.toFixed(4)).join(',');
  if (!ids.has(key)) {
    ids.set(key, parent.length);
    parent.push(parent.length);
  }
  return ids.get(key);
}
function root(i) {
  return parent[i] === i ? i : (parent[i] = root(parent[i]));
}
for (let i = 0; i < pos.count; i += 3)
  for (let j = 1; j < 3; j++) parent[root(id(i + j))] = root(id(i));
const minY = new Map();
for (let i = 0; i < pos.count; i++) {
  const k = root(id(i));
  minY.set(k, Math.min(minY.get(k) ?? Infinity, pos.getY(i)));
}
for (let type = 0; type < 12; type++) {
  const family = variants[type] ? 'sentinel' : 'rotary';
  const scale = (defs[type].radius * 2.5) / (family === 'rotary' ? 10.2536 : 7.14);
  const pivotY = (family === 'rotary' ? 0.403967 : 3.7982) * scale - 0.06;
  const barrelLength = (family === 'rotary' ? 8.815968 : 5.432863) * scale * lengths[type];
  const base = [],
    gun = [];
  if (family === 'rotary') {
    for (const node of rotary.getRoot().listNodes()) {
      const movable = node.getName() === 'gun';
      const prim = node.getMesh().listPrimitives()[0],
        idx = prim.getIndices();
      for (let j = 0; j < (idx?.getCount() ?? prim.getAttribute('POSITION').getCount()); j++) {
        const k = idx ? idx.getScalar(j) : j;
        const p = prim.getAttribute('POSITION').getElement(k, []),
          n = prim.getAttribute('NORMAL').getElement(k, []);
        (movable ? gun : base).push({
          p: [
            -p[2] * scale * (movable ? lengths[type] : 1),
            p[1] * scale + (movable ? 0 : -0.06),
            p[0] * scale,
          ],
          n: [-n[2], n[1], n[0]],
          uv: prim.getAttribute('TEXCOORD_0').getElement(k, []),
        });
      }
    }
  } else {
    for (let i = 0; i < pos.count; i++) {
      const movable = minY.get(root(id(i))) >= 3,
        n = obj.attributes.normal,
        uv = obj.attributes.uv;
      (movable ? gun : base).push({
        p: [
          -pos.getX(i) * scale * (movable ? lengths[type] : 1),
          (pos.getY(i) + 0.065355) * scale - 0.06 - (movable ? pivotY : 0),
          -pos.getZ(i) * scale,
        ],
        n: [-n.getX(i), n.getY(i), -n.getZ(i)],
        uv: [uv.getX(i), 1 - uv.getY(i)],
      });
    }
  }
  const slot = `ground_${String(type).padStart(2, '0')}`;
  emit(slot, base);
  emit(`${slot}_barrel`, gun);
  hardpoints.push({
    family,
    pivot: [0, pivotY, 0],
    muzzles: [[-barrelLength, pivotY, 0]],
    length: barrelLength,
  });
}
const glb = await io.writeBinary(doc);
await writeFile('public/models/imported/voltaris-ground-units.glb', glb);
await writeFile('data/enemies/ground-hardpoints.json', JSON.stringify(hardpoints, null, 2) + '\n');
await writeFile(
  'data/enemies/ground-units-pack.json',
  JSON.stringify(
    { size: glb.length, sha256: createHash('sha256').update(glb).digest('hex') },
    null,
    2,
  ) + '\n',
);
for (const family of ['rotary', 'sentinel']) {
  const sources =
    family === 'rotary'
      ? {
          color: `${dir}/source/turret/turret_albedo.png`,
          normal: `${dir}/source/turret/turret_normal.png`,
          orm: `${dir}/source/turret/turret_orm.png`,
        }
      : {
          color: `${poly}/PBR texture/Turret[AlbedoM].png`,
          normal: `${poly}/PBR texture/Turret[Normal].png`,
        };
  if (family === 'sentinel') {
    const r = await sharp(`${poly}/PBR texture/Turret[Roughness].png`)
      .extractChannel(0)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const m = await sharp(`${poly}/PBR texture/Turret[Metalness].png`)
      .extractChannel(0)
      .raw()
      .toBuffer();
    const rgb = Buffer.alloc(r.data.length * 3);
    for (let i = 0; i < r.data.length; i++) {
      rgb[i * 3] = 255;
      rgb[i * 3 + 1] = r.data[i];
      rgb[i * 3 + 2] = m[i];
    }
    sources.orm = await sharp(rgb, {
      raw: { width: r.info.width, height: r.info.height, channels: 3 },
    })
      .png()
      .toBuffer();
  }
  for (const [name, path] of Object.entries(sources))
    for (const [target, size] of [
      ['textures', 2048],
      ['textures-ios', 512],
    ]) {
      await mkdir(`public/${target}/emplacements`, { recursive: true });
      await writeFile(
        `public/${target}/emplacements/${family}_${name}.jpg`,
        await sharp(path).resize(size, size).jpeg({ quality: 95 }).toBuffer(),
      );
    }
}
console.log(
  `Surface batteries: ${(glb.length / 1024).toFixed(0)} KiB geometry, two shared PBR sets`,
);
