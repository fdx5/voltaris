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
let before = 0,
  after = 0;
for (const texture of doc.getRoot().listTextures()) {
  const image = sharp(texture.getImage());
  const meta = await image.metadata();
  before += meta.width * meta.height * 4;
  const { data, info } = await image
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
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
