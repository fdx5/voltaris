import { expect, it } from 'vitest';
import * as T from 'three/webgpu';
import { prepareVisibility } from '../../src/core/renderer/prepareVisibility';
import { sceneAssetManager, waitForSceneAssets } from '../../src/visual/SceneAssets';

it.each([false, true])(
  'restores hidden pools and scenery after preparation (failure=%s)',
  async (fail) => {
    const root = new T.Group();
    const hidden = new T.Group();
    hidden.visible = false;
    const pool = new T.InstancedMesh(new T.BoxGeometry(), new T.MeshBasicMaterial(), 8);
    pool.visible = false;
    pool.count = 0;
    hidden.add(pool);
    const otherSector = new T.Group();
    const unused = pool.clone();
    unused.count = 4;
    otherSector.add(unused);
    root.add(hidden, otherSector);
    const run = prepareVisibility(root, new Set([otherSector]), async () => {
      expect(hidden.visible).toBe(true);
      expect(pool.visible).toBe(true);
      expect(pool.frustumCulled).toBe(false);
      expect(pool.count).toBe(1);
      expect(otherSector.visible).toBe(false);
      expect(unused.count).toBe(4);
      await Promise.resolve();
      if (fail) throw new Error('GPU failure');
    });
    if (fail) await expect(run).rejects.toThrow('GPU failure');
    else await run;
    expect(hidden.visible).toBe(false);
    expect(pool.visible).toBe(false);
    expect(pool.frustumCulled).toBe(true);
    expect(pool.count).toBe(0);
    expect(otherSector.visible).toBe(true);
    expect(unused.count).toBe(4);
  },
);

it('waits for all outstanding decoded textures, including a later sector', async () => {
  sceneAssetManager.itemStart('planet');
  sceneAssetManager.itemStart('terrain');
  let ready = false;
  const waiting = waitForSceneAssets().then(() => {
    ready = true;
  });
  sceneAssetManager.itemEnd('planet');
  await Promise.resolve();
  expect(ready).toBe(false);
  sceneAssetManager.itemEnd('terrain');
  await waiting;
  expect(ready).toBe(true);
  sceneAssetManager.itemStart('next-sector');
  ready = false;
  const next = waitForSceneAssets().then(() => {
    ready = true;
  });
  await Promise.resolve();
  expect(ready).toBe(false);
  sceneAssetManager.itemEnd('next-sector');
  await next;
  expect(ready).toBe(true);
});
