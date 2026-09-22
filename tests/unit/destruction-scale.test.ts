import { expect, it } from 'vitest';
import { GameState } from '../../src/game/GameState';
import { DestructionEffects } from '../../src/visual/DestructionEffects';
import { ThreeBackend } from '../../src/core/renderer/ThreeBackend';
import { BufferGeometry, InstancedMesh } from 'three/webgpu';
import defs from '../../data/enemies/enemy-defs.json';
import fleet from '../../data/enemies/fleet-hardpoints.json';

it('scales every hull explosion by actual class and size, regardless of particle count', () => {
  const sizes: Record<string, number[]> = { small: [], medium: [], large: [] };
  for (let type = 0; type < defs.length; type++) {
    const g = new GameState();
    g.start('LASER', 3);
    const i = g.enemies.acquire(0, 0, 0, 0, type, 20, defs[type].radius, 1);
    g.damageEnemy(i, 10);
    const event = g.destruction.active.findIndex(Boolean);
    expect(event).toBeGreaterThanOrEqual(0);
    const hull = fleet[type].size;
    expect(g.destruction.type[event]).toBe(hull === 'large' ? 1 : hull === 'medium' ? 0 : 5);
    sizes[hull].push(g.destruction.radius[event]);
    expect(g.destruction.aux[event]).toBeLessThan(3);
  }
  expect(Math.min(...sizes.medium)).toBeGreaterThan(Math.max(...sizes.small));
  expect(Math.min(...sizes.large)).toBeGreaterThan(Math.max(...sizes.medium) * 1.7);
});

it('varies rupture silhouettes and gives capital ships more persistent debris', () => {
  const g = new GameState();
  const visual = new DestructionEffects();
  const event = g.destruction.acquire(0, 0, 0, 0, 1, 4.2, 2.6);
  g.destruction.age[event] = 0.7;
  visual.update(g.destruction, 1, false, false);
  const before = visual.root.children.map((child) =>
    Array.from((child as InstancedMesh).instanceMatrix.array),
  );
  g.destruction.aux[event] = 2;
  visual.update(g.destruction, 1, false, false);
  expect(
    visual.root.children.map((child) => Array.from((child as InstancedMesh).instanceMatrix.array)),
  ).not.toEqual(before);
  g.destruction.age[event] = 3.1;
  visual.update(g.destruction, 3.1, true, true);
  expect(visual.root.children.some((child) => (child as InstancedMesh).count > 0)).toBe(true);
  for (const child of visual.root.children) {
    const batch = child as InstancedMesh;
    expect(batch.count).toBeLessThanOrEqual(batch.instanceMatrix.count);
    expect(Array.from(batch.instanceMatrix.array).every(Number.isFinite)).toBe(true);
  }
});

it('retains the thin crescent bevel with emerald and full-upgrade yellow palettes', () => {
  const geometry = (
    ThreeBackend as unknown as { crescentGeometry(): BufferGeometry }
  ).crescentGeometry();
  geometry.computeBoundingBox();
  expect(geometry.boundingBox!.max.x).toBeCloseTo(1);
  expect(geometry.boundingBox!.max.y).toBeCloseTo(1);
  expect(geometry.boundingBox!.min.y).toBeCloseTo(-1);
  expect(geometry.boundingBox!.max.z - geometry.boundingBox!.min.z).toBeGreaterThan(0.27);
  const p = geometry.attributes.position;
  const c = geometry.attributes.color;
  const full = geometry.attributes.fullColor;
  const edge = geometry.attributes.bladeEdge;
  for (let i = 0; i < c.count; i++) {
    expect(c.getY(i)).toBeGreaterThan(c.getX(i) * 2);
    expect(c.getY(i)).toBeGreaterThan(c.getZ(i) * 2);
    expect(full.getX(i)).toBeGreaterThan(full.getZ(i) * 3);
    expect(full.getY(i)).toBeGreaterThan(full.getZ(i) * 3);
  }
  // Inspect the crown of the blade, where width is measured at y=0.
  const crown: number[] = [],
    cuttingEdge: number[] = [];
  for (let i = 0; i < p.count / 2; i++)
    if (Math.abs(p.getY(i)) < 0.001) {
      crown.push(p.getX(i));
      if (edge.getX(i) === 1) cuttingEdge.push(p.getX(i));
    }
  expect(Math.max(...crown) - Math.min(...crown)).toBeCloseTo(0.165);
  expect(cuttingEdge.length).toBe(4);
  expect(Math.max(...cuttingEdge) - cuttingEdge[1]).toBeGreaterThan(0.018);
  geometry.dispose();
});
