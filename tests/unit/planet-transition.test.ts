import { afterAll, expect, it, vi } from 'vitest';
import * as T from 'three/webgpu';
import { buildBackdrop } from '../../src/visual/SceneBuilder';

// Exercise the real scene graph without a browser image loader.
const textures = vi
  .spyOn(T.TextureLoader.prototype, 'load')
  .mockImplementation(() => new T.Texture());
afterAll(() => textures.mockRestore());

it.each([390, 900, 1080])('hands Mars off to a 10px Jupiter at viewport height %i', (height) => {
  const backdrop = buildBackdrop(new T.Scene(), 'mars');
  const mars = backdrop.planet;
  const jupiter = backdrop.root.getObjectByName('planets/jupiter_color.jpg')!;
  const cameraZ = 60;
  const diameter = (body: T.Object3D, radius: number) =>
    (radius * body.scale.x * height) / ((cameraZ - body.position.z) * Math.tan(Math.PI / 12));
  const advance = (progress: number) =>
    backdrop.update(180 * progress, 1, 0, 0, cameraZ, progress, height);
  advance(0);
  const initialMars = diameter(mars, 26);
  expect(mars.visible).toBe(true);
  expect(jupiter.visible).toBe(false);
  let previous = initialMars;
  for (let i = 1; i < 50; i++) {
    advance(i / 100);
    expect(diameter(mars, 26)).toBeLessThan(previous);
    expect(jupiter.visible).toBe(false);
    previous = diameter(mars, 26);
  }
  advance(0.5);
  expect(mars.visible).toBe(false);
  expect(jupiter.visible).toBe(true);
  expect(diameter(jupiter, 46)).toBeCloseTo(10, 6);
  previous = diameter(jupiter, 46);
  for (let i = 51; i <= 100; i++) {
    advance(i / 100);
    expect(mars.visible).toBe(false);
    expect(diameter(jupiter, 46)).toBeGreaterThan(previous);
    previous = diameter(jupiter, 46);
  }
  expect(previous).toBeCloseTo(initialMars, 6);
  advance(1.5);
  expect(diameter(jupiter, 46)).toBeCloseTo(initialMars, 6);
  expect(mars.visible).toBe(false);
  advance(0);
  expect(mars.visible).toBe(true);
  expect(jupiter.visible).toBe(false);
  expect(diameter(mars, 26)).toBeCloseTo(initialMars, 6);
});

it('preserves Earth recession over the whole first stage', () => {
  const backdrop = buildBackdrop(new T.Scene(), 'earth');
  backdrop.update(0, 1, 0, 0, 33.6, 0);
  expect(backdrop.planet.scale.x).toBe(1);
  backdrop.update(180, 1, 0, 0, 33.6, 1);
  expect(backdrop.planet.visible).toBe(true);
  expect(backdrop.planet.scale.x).toBeCloseTo(0.39);
  expect(backdrop.planet.position.toArray()).toEqual([6, -10, -140]);
});
