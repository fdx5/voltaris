import mounts from '../../data/enemies/ground-hardpoints.json';

/** Shared by simulation and rendering: gun axis is -X, footing stays fixed. */
export function groundMuzzle(type: number, angle: number, roof: boolean, recoil = 0) {
  const mount = mounts[type];
  const length = mount.length - recoil;
  return {
    x: mount.pivot[0] + Math.cos(angle) * length,
    y: mount.pivot[1] * (roof ? -1 : 1) + Math.sin(angle) * length,
    z: 0,
  };
}

export function turnGroundGun(current: number, target: number, dt: number) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + Math.max(-dt * 5, Math.min(dt * 5, delta));
}
