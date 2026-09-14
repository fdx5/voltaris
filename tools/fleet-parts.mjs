// The packed fleet is published in parts: the GitHub CDN (jsDelivr) that serves
// production assets refuses any single file over 20 MB. The client downloads the
// parts in parallel and joins them back into the one GLB.
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';

export const FLEET_DIR = 'public/models/imported';
export const PARTS_MANIFEST = 'data/enemies/imported-fleet-parts.json';
const CHUNK = 18 * 1024 * 1024;

export async function writeFleetParts(glb) {
  const bytes = Buffer.from(glb);
  for (const name of await readdir(FLEET_DIR))
    if (/^voltaris-imported-fleet(\.glb|\.\d+\.bin)$/.test(name))
      await unlink(`${FLEET_DIR}/${name}`);
  const parts = [];
  for (let offset = 0, n = 0; offset < bytes.length; offset += CHUNK, n++) {
    const name = `voltaris-imported-fleet.${n}.bin`;
    await writeFile(`${FLEET_DIR}/${name}`, bytes.subarray(offset, offset + CHUNK));
    parts.push(name);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(
    PARTS_MANIFEST,
    JSON.stringify({ size: bytes.length, sha256, parts }, null, 2) + '\n',
  );
  return parts;
}

export async function readFleetBytes() {
  const manifest = JSON.parse(await readFile(PARTS_MANIFEST, 'utf8'));
  const bytes = Buffer.concat(
    await Promise.all(manifest.parts.map((name) => readFile(`${FLEET_DIR}/${name}`))),
  );
  if (bytes.length !== manifest.size) throw new Error('Fleet parts do not match their manifest');
  return bytes;
}
