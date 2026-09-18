// Download original artist models, repaint the two ships, and retain four
// distinct ordnance meshes. Rebuild: node tools/import-player-loadout.mjs
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { Document, NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, mergeDocuments, unpartition } from '@gltf-transform/functions';
import sharp from 'sharp';

const cache = '.local/vendor/player-loadout';
const output = 'public/models/player';
await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });
async function download(url, name) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  let bytes = Buffer.from(await response.arrayBuffer());
  if (name.endsWith('.glb') && bytes.toString('ascii', 0, 4) !== 'glTF')
    bytes = brotliDecompressSync(bytes);
  await writeFile(`${cache}/${name}`, bytes);
  return bytes;
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
function orient(doc, axis, length) {
  const scene = doc.getRoot().listScenes()[0];
  const pivot = doc.createNode('airframe');
  for (const child of scene.listChildren()) pivot.addChild(child);
  scene.addChild(pivot);
  const h = Math.SQRT1_2;
  pivot.setRotation(axis === 'z' ? [0, h, 0, h] : axis === 'y' ? [0, 0, -h, h] : [0, 0, 0, 1]);
  const { min, max } = getBounds(scene);
  const scale = length / (max[0] - min[0]);
  pivot.setScale([scale, scale, scale]);
  pivot.setTranslation(min.map((v, i) => -(v + max[i]) * 0.5 * scale));
}
for (const [name, model, id, paintMod] of [
  ['missile-ship', 'Executioner', '1DaCoRPG1Q54SFBOPMrhTOZNaNETsuRB1', { hue: 0, saturation: 1.15, brightness: 0.9 }],
  ['spread-ship', 'Spitfire', '190E7T13jvAH8rVzD3dd484gPfN5fV8X3', { hue: 275 }],
]) {
  await download(
    `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`,
    `${model}.gltf`,
  );
  const texture = await download(
    `https://raw.githubusercontent.com/Malcolmnixon/Quaternius-Ultimate-Spaceships-Pack/main/addons/quaternius-ultimate-spaceships-pack/meshes/${model.toLowerCase()}/textures/${model}_Red.png`,
    `${model}.png`,
  );
  const doc = await io.read(`${cache}/${model}.gltf`);
  const paint = doc
    .createTexture(`${name}-paint`)
    .setMimeType('image/png')
    .setImage(await sharp(texture).modulate(paintMod).png().toBuffer());
  for (const m of doc.getRoot().listMaterials())
    m.setBaseColorTexture(paint)
      .setBaseColorFactor([1, 1, 1, 1])
      .setMetallicFactor(0.48)
      .setRoughnessFactor(0.34);
  orient(doc, 'z', 3.2);
  await doc.transform(prune(), dedup());
  await io.write(`${output}/${name}.glb`, doc);
  console.log(name, model);
}
for (const [name, id] of [
  ['missile-main', 'bae77cff-57c6-4cb4-8ccf-7bc61a9b1d20'],
  ['missile-option', '908a29de-a70c-467a-ad90-0348e0a5e1cb'],
  ['spread-main', '244c027c-40f0-45ca-a707-0f8e855c9831'],
]) {
  await download(`https://static.poly.pizza/${id}.glb`, `${name}.glb`);
  const doc = await io.read(`${cache}/${name}.glb`);
  // Remove the rocket artist's baked flame; the game supplies a live motor.
  for (const mesh of doc.getRoot().listMeshes())
    for (const p of mesh.listPrimitives())
      if (p.getMaterial()?.getName() === 'fire') mesh.removePrimitive(p);
  orient(doc, name === 'missile-option' ? 'x' : 'y', 4);
  await doc.transform(prune(), dedup());
  await io.write(`${output}/${name}.glb`, doc);
  console.log(name, (await readFile(`${output}/${name}.glb`)).length);
}
// Kenney's different nose, body and fin models form the fourth small missile.
await download(
  'https://kenney.nl/media/pages/assets/space-kit/20874c75ac-1677698978/kenney_space-kit.zip',
  'space.zip',
);
const pieces = ['rocket_finsB', 'rocket_fuelA', 'rocket_topA'];
execFileSync('tar', [
  '-xf',
  `${cache}/space.zip`,
  '-C',
  cache,
  ...pieces.map((n) => `Models/GLTF format/${n}.glb`),
]);
const assembled = new Document();
const assembly = assembled.createScene();
for (const [index, name] of pieces.entries()) {
  const part = await io.read(`${cache}/Models/GLTF format/${name}.glb`);
  const map = mergeDocuments(assembled, part);
  const imported = map.get(part.getRoot().listScenes()[0]);
  const pivot = assembled.createNode(name).setTranslation([-2, [0, 0.6, 1.1][index], -1.5]);
  for (const child of imported.listChildren()) pivot.addChild(child);
  assembly.addChild(pivot);
  imported.dispose();
}
orient(assembled, 'y', 4);
await assembled.transform(prune(), dedup(), unpartition());
await io.write(`${output}/spread-option.glb`, assembled);
// Existing LASER model, normalized identically, only for thumbnail rendering.
const laser = await io.read('.local/vendor/Striker.gltf');
const blue = laser
  .createTexture()
  .setMimeType('image/png')
  .setImage(await readFile('.local/vendor/Striker_Blue.png'));
for (const m of laser.getRoot().listMaterials()) m.setBaseColorTexture(blue);
orient(laser, 'z', 3.2);
await mkdir('.local/player-review', { recursive: true });
await io.write('.local/player-review/laser.glb', laser);
