import { expect, it, vi } from 'vitest';
import * as T from 'three/webgpu';
import { DepthScenery } from '../../src/visual/DepthScenery';

const assets = vi.hoisted(() => ({ load: vi.fn(async (_stage: number) => {}), model: vi.fn() }));
vi.mock('../../src/visual/DepthAssets', () => ({
  loadDepthAssets: assets.load,
  depthModel: assets.model,
}));

it('loads and clones only the selected sector before flight, never in update', async () => {
  assets.model.mockImplementation(() => {
    const group = new T.Group();
    group.add(new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial()));
    return group;
  });
  const scenery = new DepthScenery();
  await scenery.prepareStage(1);
  expect(assets.load).toHaveBeenCalledExactlyOnceWith(1, undefined);
  expect(assets.model.mock.calls.map(([name]) => name)).toEqual(['cassini', 'juno']);
  const inactive = scenery.inactiveModels(1);
  expect(inactive).toHaveLength(8);
  expect(inactive.every((group) => group.children.length === 0)).toBe(true);
  for (let i = 0; i <= 180; i++)
    scenery.update(i, 1, 16, 9, 34, 0, 0, 0, 'HIGH', false, true, undefined, 0, i / 180);
  expect(assets.load).toHaveBeenCalledTimes(1);
  expect(assets.model).toHaveBeenCalledTimes(2);
  await scenery.prepareStage(1);
  expect(assets.model).toHaveBeenCalledTimes(2);
});
