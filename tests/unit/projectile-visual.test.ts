import { expect, it } from 'vitest';
import {
  projectileGeometry,
  hostileGlowMaterial,
  hostileShellMaterial,
} from '../../src/visual/HostileProjectiles';
import { SHOT_KINDS } from '../../src/game/entities/BulletPool';

it('gives all hostile kinds a finite centred solid silhouette and bounded optical layers', () => {
  for (let kind = 0; kind < SHOT_KINDS; kind++) {
    const geometry = projectileGeometry(kind);
    expect([...geometry.attributes.position.array].every(Number.isFinite)).toBe(true);
    geometry.computeBoundingSphere();
    expect(geometry.boundingSphere!.radius).toBeGreaterThan(0.7);
    expect(geometry.boundingSphere!.radius).toBeLessThan(2);
    geometry.dispose();
  }
  const body = hostileShellMaterial();
  expect(body.transparent).toBe(false);
  for (const trail of [true, false]) {
    const glow = hostileGlowMaterial(trail);
    expect(glow.depthWrite).toBe(false);
    expect(glow.opacityNode).toBeDefined();
    glow.dispose();
  }
  body.dispose();
});
