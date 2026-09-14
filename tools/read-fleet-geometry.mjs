// Offline geometry inspection has no DOM image decoder. Keep material factors
// and exact mesh buffers, omitting texture references only for this reader.
import { readFile } from 'node:fs/promises';
import { readFleetBytes } from './fleet-parts.mjs';
/** The surface emplacements' GLB carries no textures, so it is read as it is. */
export async function readGroundGeometry() {
  const bytes = await readFile('public/models/imported/voltaris-ground-units.glb');
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
export async function readFleetGeometry() {
  const bytes = await readFleetBytes();
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString());
  const bin = bytes.subarray(28 + length);
  for (const mat of json.materials) {
    delete mat.pbrMetallicRoughness.baseColorTexture;
    delete mat.pbrMetallicRoughness.metallicRoughnessTexture;
  }
  delete json.images;
  delete json.textures;
  delete json.samplers;
  const strip = (list) => list?.filter((name) => name !== 'EXT_texture_webp');
  json.extensionsUsed = strip(json.extensionsUsed);
  json.extensionsRequired = strip(json.extensionsRequired);
  const encoded = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32);
  encoded.copy(padded);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + padded.length + bin.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length);
  binHeader.writeUInt32LE(0x004e4942, 4);
  const result = Buffer.concat([header, padded, binHeader, bin]);
  return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
}
