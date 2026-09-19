import { expect, it } from 'vitest';
import { PlasmaWhip } from '../../src/visual/PlasmaWhip';
import { whipPoint, WHIP_SEGMENTS } from '../../src/game/SpecialWeapons';
import { Mesh } from 'three/webgpu';
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
  expect(visual.root.children).toHaveLength(7);
  const buffers = visual.root.children.map((child) => {
    const mesh = child as Mesh;
    expect(mesh.geometry.index!.count).toBe(WHIP_SEGMENTS * 6);
    const buffer = mesh.geometry.attributes.position.array;
    expect(Array.from(buffer).every(Number.isFinite)).toBe(true);
    return buffer;
  });
  const electric = visual.root.children[5] as Mesh;
  expect(electric.geometry.attributes.color).toBeDefined();
  const before = Array.from(electric.geometry.attributes.position.array);
  visual.update(xs, ys, 0.67, 1.2, true);
  expect(Array.from(electric.geometry.attributes.position.array)).not.toEqual(before);
  visual.root.children.forEach((child, i) =>
    expect((child as Mesh).geometry.attributes.position.array).toBe(buffers[i]),
  );
  visual.update(xs, ys, 0.67, 1.3, false);
  expect(visual.root.visible).toBe(false);
});
