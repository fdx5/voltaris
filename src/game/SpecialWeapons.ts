import weapons from '../../data/weapons/weapon-levels.json';
export type SpecialWeapon = 'PLASMA' | 'CRESCENT' | null;
export const SPECIAL_NAMES = { PLASMA: 'PLASMA WHIP', CRESCENT: 'CRESCENT BEAM' };
export const WHIP_SEGMENTS = 192;
export const WHIP_PATTERN_SECONDS = 0.9;
// Crossfaded in a scrambled order: sweep, double S, snap, coil, reverse curl,
// rolling wave, flutter and broad lash. No simulation RNG is consumed by VFX.
const PATTERNS = [
  [1.2, 0.35, 2.1, 0.2],
  [2.4, 0.5, 3.7, 1.4],
  [0.8, 0.7, 4.8, 2.7],
  [3.1, 0.45, 5.2, 0.8],
  [1.6, -0.6, 3.4, 3.5],
  [2.0, 0.65, 2.9, 4.8],
  [3.6, 0.3, 6.3, 2.0],
  [0.6, -0.75, 2.3, 5.6],
];
const ORDER = [0, 5, 2, 7, 4, 1, 6, 3];
const smooth = (v: number) => v * v * (3 - 2 * v);
function pattern(index: number, t: number, time: number) {
  const [frequency, secondary, speed, phase] = PATTERNS[ORDER[index % 8]];
  return (
    Math.sin(t * Math.PI * 2 * frequency - time * speed + phase) +
    secondary * Math.sin(t * 17 + time * (speed * 0.71) + phase)
  );
}
/** A smooth full-screen path pinned to the muzzle and the tracked target.
 * Beyond the target the same beam continues to the screen edge.
 * With no target, tracking fades to zero and the beam becomes straight.
 */
export function whipPoint(
  x: number,
  y: number,
  time: number,
  t: number,
  targetX = x + 17.7,
  targetY = y,
  endX = 23,
  tracking = 1,
) {
  const start = x + 0.7,
    span = Math.max(1, endX - start);
  const targetT = Math.max(0.025, Math.min(0.96, (targetX - start) / span));
  const before = t <= targetT;
  const local = before ? t / targetT : (t - targetT) / (1 - targetT);
  const bend = before ? smooth(local) : 1 - 0.3 * smooth(local);
  // Zero displacement and derivative at the target keep hits reliable during
  // even the wildest lashes; the tail can writhe without abandoning the lock.
  const envelope = Math.sin(Math.PI * local) ** 2;
  const cycle = time / WHIP_PATTERN_SECONDS,
    index = Math.floor(cycle);
  const mix = smooth(cycle - index);
  const wave = pattern(index, t, time) * (1 - mix) + pattern(index + 1, t, time) * mix;
  return { x: start + span * t, y: y + tracking * ((targetY - y) * bend + envelope * wave * 2.1) };
}
export function specialStats(weapon: keyof typeof weapons, level: number) {
  const w = weapons[weapon][7];
  const divisor = weapon === 'MISSILE' ? 3 : weapon === 'SPREAD' ? 2 : 1;
  const dps = (w.rate / divisor) * w.count * w.damage * 2 * (0.35 + (1.65 * (level - 1)) / 7);
  return {
    dps,
    width: 0.18 + (level - 1) * 0.07,
    radius: 0.55 + (level - 1) * 0.12,
    count: 1 + Math.floor((level - 1) / 2),
    rate: 16 + (level - 1) * 0.6,
    spread: (level - 1) * 0.035,
  };
}
