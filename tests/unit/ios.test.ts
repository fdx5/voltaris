import { afterEach, expect, it, vi } from 'vitest';
import { asset } from '../../src/core/assets';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { isIOSDevice } from '../../src/core/device';
import manifest from '../../data/enemies/ios-fleet.json';
import { readFleetBytes } from '../../tools/fleet-parts.mjs';

afterEach(() => vi.unstubAllGlobals());

it('routes all terrain, ground-unit and background textures to iOS assets', () => {
  vi.stubGlobal('navigator', { userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5 });
  for (const path of [
    'terrain/snow_01_height.jpg',
    'materials/metal_plate_02_color.jpg',
    'planets/earth_color.jpg',
  ])
    expect(asset(`/textures/${path}`)).toBe(`/textures-ios/${path}`);
  expect(asset('/audio/galaxy-dash.mp3')).toBe('/audio/galaxy-dash.mp3');
});

it('recognizes iPhone and desktop-mode iPad while preserving desktop rendering', () => {
  expect(isIOSDevice({ userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5 })).toBe(true);
  expect(isIOSDevice({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(
    true,
  );
  expect(isIOSDevice({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(
    false,
  );
  expect(isIOSDevice({ userAgent: 'Android', platform: 'Linux', maxTouchPoints: 5 })).toBe(false);
});

it('ships the complete fleet with a bounded iOS decoded texture budget', async () => {
  const bytes = await readFile('public/models/imported/voltaris-fleet-ios.glb');
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sha256);
  const length = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + length).toString());
  const original = await readFleetBytes();
  const source = JSON.parse(original.subarray(20, 20 + original.readUInt32LE(12)).toString());
  expect(gltf.nodes.map((n: { name: string }) => n.name).sort()).toEqual(
    source.nodes.map((n: { name: string }) => n.name).sort(),
  );
  const bin = bytes.subarray(28 + length);
  let decoded = 0;
  for (const image of gltf.images) {
    const view = gltf.bufferViews[image.bufferView];
    const meta = await sharp(
      bin.subarray(view.byteOffset, view.byteOffset + view.byteLength),
    ).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(512);
    decoded += meta.width! * meta.height! * 4;
  }
  expect(decoded).toBe(manifest.textureBytes);
  // Ceiling scales with the roster: 44 hulls fit under 100 MiB, the ten
  // large hulls added on top push it toward 112 MiB - still well inside
  // the 20% source-texture ratio checked below.
  expect(decoded).toBeLessThan(130 * 1024 * 1024);
  expect(decoded).toBeLessThan(manifest.sourceTextureBytes * 0.2);
});
