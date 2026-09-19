import { expect, it } from 'vitest';
import { PlasmaWhip } from '../../src/visual/PlasmaWhip';
import { whipPoint, WHIP_SEGMENTS } from '../../src/game/SpecialWeapons';
import { Mesh, InstancedMesh } from 'three/webgpu';
it('renders continuous indexed ribbons with visible wrapping electric strands and reusable buffers', () => {
  const visual = new PlasmaWhip();
  const xs = new Float32Array(WHIP_SEGMENTS + 1),
    ys = new Float32Array(xs.length);
  for (let i = 0; i < xs.length; i++) {
    const p = whipPoint(-7, 0, 1.1, i / WHIP_SEGMENTS, 4, 3);
    xs[i] = p.x;
    ys[i] = p.y;
  }
  visual.update(xs, ys, 0.67, 1.1, true);
  expect(visual.root.visible).toBe(true);
  expect(visual.root.children).toHaveLength(8);
  const buffers = visual.root.children.slice(0, 7).map((child) => {
    const mesh = child as Mesh;
    expect(mesh.geometry.index!.count).toBe(WHIP_SEGMENTS * 6);
    const buffer = mesh.geometry.attributes.position.array;
    expect(Array.from(buffer).every(Number.isFinite)).toBe(true);
    return buffer;
  });
  const electric = visual.root.children[5] as Mesh;
  expect(electric.geometry.attributes.color).toBeDefined();
  const position = electric.geometry.attributes.position.array;
  const i = 90 * 6;
  expect(Math.hypot(position[i + 3] - position[i], position[i + 4] - position[i + 1])).toBeCloseTo(
    0.045 + 0.67 * 0.1,
  );
  const body = (visual.root.children[2] as Mesh).geometry.attributes.position.array;
  expect(Math.hypot(body[i + 3] - body[i], body[i + 4] - body[i + 1])).toBeCloseTo(0.67 * 2);
  const sparks = visual.root.children[7] as InstancedMesh;
  expect(sparks.count).toBeGreaterThan(0);
  expect(sparks.count).toBeLessThanOrEqual(48);
  expect(Array.from(sparks.instanceMatrix.array).every(Number.isFinite)).toBe(true);
  const before = Array.from(electric.geometry.attributes.position.array);
  visual.update(xs, ys, 0.67, 1.2, true);
  expect(Array.from(electric.geometry.attributes.position.array)).not.toEqual(before);
  visual.root.children
    .slice(0, 7)
    .forEach((child, i) =>
      expect((child as Mesh).geometry.attributes.position.array).toBe(buffers[i]),
    );
  visual.update(xs, ys, 0.67, 1.3, false);
  expect(visual.root.visible).toBe(false);
});
