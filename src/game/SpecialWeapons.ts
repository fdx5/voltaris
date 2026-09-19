import weapons from '../../data/weapons/weapon-levels.json';
export type SpecialWeapon = 'PLASMA' | 'CRESCENT' | null;
export const SPECIAL_NAMES = { PLASMA: 'PLASMA WHIP', CRESCENT: 'CRESCENT BEAM' };
export const WHIP_SEGMENTS = 48;
export function whipPoint(
  x: number,
  y: number,
  time: number,
  t: number,
  targetX = x + 17.7,
  targetY = y,
) {
  const wave = Math.sin(t * 10 - time * 11) * Math.sin(t * Math.PI) * 1.8;
  return {
    x: x + 0.7 + t * (targetX - x - 0.7),
    y: y + (targetY - y) * t * t * (3 - 2 * t) + wave,
  };
}
export function specialStats(weapon: keyof typeof weapons, level: number) {
  const w = weapons[weapon][7];
  const divisor = weapon === 'MISSILE' ? 3 : weapon === 'SPREAD' ? 2 : 1;
  // Twice the fully upgraded main gun's sustained damage at special level 8.
  const dps = (w.rate / divisor) * w.count * w.damage * 2 * (0.35 + (1.65 * (level - 1)) / 7);
  return {
    dps,
    width: 0.09 + (level - 1) * 0.035,
    radius: 0.38 + (level - 1) * 0.11,
    count: 1 + Math.floor(((level - 1) * 3) / 7),
  };
}
