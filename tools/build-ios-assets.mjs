// Reproducible iOS assets: reduce decoded memory before images reach Safari.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const parts = JSON.parse(await readFile('data/enemies/imported-fleet-parts.json', 'utf8'));
const bytes = Buffer.concat(
  await Promise.all(parts.parts.map((name) => readFile(`public/models/imported/${name}`))),
);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
});
const doc = await io.readBinary(new Uint8Array(bytes));
// Boss hulls and their pods (six pairs) carry a full 1024px texture each way
// more of them than the roster did when the 100 MiB decoded budget below was
// tuned, so their textures get a lower cap to make room; every other hull
// keeps the original 512px cap.
const bossTextures = new Set();
for (const node of doc.getRoot().listNodes()) {
  if (!/^(boss_|pod_)/.test(node.getName())) continue;
  for (const prim of node.getMesh()?.listPrimitives() ?? []) {
    const material = prim.getMaterial();
    for (const texture of [material?.getBaseColorTexture(), material?.getMetallicRoughnessTexture()])
      if (texture) bossTextures.add(texture);
  }
}
let before = 0,
  after = 0;
for (const texture of doc.getRoot().listTextures()) {
  const image = sharp(texture.getImage());
  const meta = await image.metadata();
  before += meta.width * meta.height * 4;
  const cap = bossTextures.has(texture) ? 384 : 512;
  const { data, info } = await image
    .resize({ width: cap, height: cap, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  after += info.width * info.height * 4;
  texture.setImage(new Uint8Array(data)).setMimeType('image/webp');
}
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
const mobile = await io.writeBinary(doc);
await writeFile('public/models/imported/voltaris-fleet-ios.glb', mobile);
await writeFile(
  'data/enemies/ios-fleet.json',
  JSON.stringify(
    {
      sha256: createHash('sha256').update(mobile).digest('hex'),
      size: mobile.length,
      textureBytes: after,
      sourceTextureBytes: before,
    },
    null,
    2,
  ) + '\n',
);
async function textures(dir = '') {
  for (const entry of await readdir(`public/textures/${dir}`, { withFileTypes: true })) {
    const name = `${dir}${entry.name}`;
    if (entry.isDirectory()) {
      await textures(`${name}/`);
      continue;
    }
    if (!/\.(jpg|png|webp)$/i.test(name)) continue;
    await mkdir(`public/textures-ios/${dir}`, { recursive: true });
    await sharp(`public/textures/${name}`)
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .toFile(`public/textures-ios/${name}`);
  }
}
await textures();
console.log(
  `Fleet texture memory: ${(before / 1048576).toFixed(1)} -> ${(after / 1048576).toFixed(1)} MiB; GLB ${mobile.length} bytes`,
);
