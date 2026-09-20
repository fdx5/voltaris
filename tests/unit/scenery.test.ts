import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { SCENERY_SCHEDULE, SCENERY_MODELS, sceneryPass } from '../../src/visual/ScenerySchedule';

it('shows the first-stage station twice and every other model once across a run', () => {
  const encounters: string[] = [];
  for (let stage = 0; stage < 5; stage++) {
    let previous: string | undefined;
    for (let tick = 0; tick <= 10000; tick++) {
      const current = sceneryPass(stage, tick / 10000)?.model;
      if (current && current !== previous) encounters.push(current);
      previous = current;
    }
    expect(sceneryPass(stage, 1.1)).toBeUndefined();
    for (let i = 1; i < SCENERY_SCHEDULE[stage].length; i++)
      expect(
        SCENERY_SCHEDULE[stage][i].start - SCENERY_SCHEDULE[stage][i - 1].end,
      ).toBeGreaterThanOrEqual(0.15);
  }
  for (const name of SCENERY_MODELS)
    expect(encounters.filter((value) => value === name)).toHaveLength(
      name === 'orbital-station' ? 2 : 1,
    );
});

it('ships self-contained textured GLBs for every scheduled encounter', async () => {
  for (const name of SCENERY_MODELS) {
    const file = await readFile(`public/models/scenery/${name}.glb`);
    expect(file.subarray(0, 4).toString()).toBe('glTF');
    const gltf = JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString());
    expect(gltf.textures.length).toBeGreaterThan(0);
    expect(
      gltf.images.every((image: { bufferView?: number }) => image.bufferView !== undefined),
    ).toBe(true);
  }
});
