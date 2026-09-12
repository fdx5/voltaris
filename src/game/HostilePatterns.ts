import { Shot as S } from './entities/BulletPool';

export type SalvoShot = {
  mount: number;
  angle: number;
  speed: number;
  kind: number;
  delay: number;
  dx: number;
  dy: number;
};
const PI = Math.PI,
  TAU = PI * 2;
export const enemyRotation = (type: number, age: number, time: number) =>
  type === 5 ? time * 2.6 : type === 29 ? time * 0.9 : Math.sin(age) * 0.12;

/** Each recipe matches a separately authored weapon architecture in fleet-designs.json.
 * Speed is relative; delay is simulation time. No random sources affect replay.
 */
export function enemySalvo(type: number, aim: number, cycle: number): SalvoShot[] {
  const out: SalvoShot[] = [];
  const add = (
    mount: number,
    angle: number,
    kind: number = S.ORB,
    delay = 0,
    speed = 1,
    dx = 0,
    dy = 0,
  ) => out.push({ mount, angle, kind, delay, speed, dx, dy });
  const fan = (
    m: number,
    n: number,
    a: number,
    step: number,
    kind: number,
    delay = 0,
    speed = 1,
  ) => {
    for (let j = 0; j < n; j++) add(m, a + (j - (n - 1) / 2) * step, kind, delay, speed);
  };
  const c = cycle % 2 ? 1 : -1;
  switch (type) {
    case 0: // The two crescent tips cross, then separate.
      for (let k = 0; k < 2; k++) {
        add(0, aim + 0.16 - k * 0.22, S.ORB, k * 0.22);
        add(1, aim - 0.16 + k * 0.22, S.ORB, k * 0.22);
      }
      break;
    case 1: // A telegraphed accelerating train along one rail.
      for (let k = 0; k < 5; k++) add(0, aim, S.NEEDLE, k * 0.11, 0.8 + k * 0.15);
      break;
    case 2: // Each hangar bay releases a separate diagonal packet.
      for (let k = 0; k < 4; k++)
        add(k, PI + (k - 1.5) * 0.18, k % 2 ? S.SHARD : S.ORB, k * 0.16, 0.9);
      break;
    case 3: // Shutters walk a safe slot through two shield-height curtains.
      for (let pass = 0; pass < 3; pass++)
        for (let m = 0; m < 6; m++) {
          if (m === (cycle + pass) % 6) continue;
          add(
            m,
            PI + c * pass * 0.045,
            pass === 2 ? S.PULSE : S.NEEDLE,
            pass * 0.24,
            0.9 + pass * 0.08,
          );
        }
      break;
    case 4: // Stinger weaves two short threads around its aim.
      for (let j = 0; j < 5; j++) add(0, aim + Math.sin(j * 1.8) * 0.13, S.WAVE, j * 0.09, 0.85);
      break;
    case 5: // Actual four rotor centres emit a staggered pinwheel.
      for (let m = 0; m < 4; m++) {
        add(m, (m * PI) / 2 + cycle * 0.39, S.ORB);
        add(m, (m * PI) / 2 + cycle * 0.39 + 0.3, S.SHARD, 0.28, 0.75);
      }
      break;
    case 6: // Four slow ballistic shells, each thrown at a different elevation.
      for (let j = 0; j < 4; j++) add(0, PI - 0.62 + j * 0.21, S.ACCEL, j * 0.2, 0.42 + j * 0.05);
      break;
    case 7:
      fan(0, 3, aim, 0.24, S.SHARD, 0, 1.24);
      add(0, aim, S.NEEDLE, 0.35, 1.4);
      break;
    case 8: // The binocular drums alternate high/low intersections.
      for (let j = 0; j < 3; j++) {
        add(0, aim + 0.22, S.NEEDLE, j * 0.18);
        add(1, aim - 0.22, S.NEEDLE, 0.09 + j * 0.18);
      }
      break;
    case 9: // Feathers peel away from the wing in a widening V.
      for (let j = 0; j < 3; j++) {
        add(0, PI - 0.14 - j * 0.12, S.SHARD, j * 0.08);
        add(1, PI + 0.14 + j * 0.12, S.SHARD, j * 0.08);
      }
      break;
    case 10: // Three necks converge, then sweep apart; centre spits a splitter.
      for (let beat = 0; beat < 3; beat++)
        for (let m = 0; m < 3; m++)
          fan(m, 2, aim + (m - 1) * (0.22 - beat * 0.19), 0.08, S.NEEDLE, beat * 0.24, 1.08);
      add(1, aim, S.SPLIT, 0.78, 0.74);
      break;
    case 11: // Alternating teeth in a double comb, with a centre passage.
      for (let beat = 0; beat < 3; beat++)
        for (let m = 0; m < 7; m++)
          if (m !== 3 && (m + beat) % 2 === 0) {
            add(m, PI, S.PULSE, beat * 0.22, 0.75);
            add(m, PI + c * 0.14, S.ORB, 0.11 + beat * 0.22);
          }
      break;
    case 12:
      add(0, aim, S.HOMING, 0, 0.75);
      fan(0, 3, aim, 0.32, S.ORB, 0.4, 1.15);
      break;
    case 13: // Scythes close on a point, then fire outward along their blades.
      add(0, aim + 0.35, S.SHARD);
      add(1, aim - 0.35, S.SHARD);
      add(0, aim - 0.23, S.SHARD, 0.3);
      add(1, aim + 0.23, S.SHARD, 0.3);
      break;
    case 14:
      for (let j = 0; j < 7; j++)
        add(0, aim + Math.sin(j * 1.05) * 0.25, S.NEEDLE, j * 0.08, 0.78 + j * 0.04);
      break;
    case 15: // Five tower runes lay a moving window, followed by diagonal seams.
      for (let pass = 0; pass < 3; pass++)
        for (let m = 0; m < 5; m++)
          if (m !== (cycle + pass) % 5)
            add(
              m,
              PI + (pass === 2 ? (m - 2) * 0.16 : 0),
              pass === 2 ? S.SHARD : S.PULSE,
              pass * 0.28,
              0.82,
            );
      fan(2, 4, aim, 0.24, S.NEEDLE, 0.85);
      break;
    case 16:
      for (let m = 0; m < 3; m++) fan(m, 2, aim + (m - 1) * 0.3, 0.085, S.ORB, m * 0.12, 0.9);
      break;
    case 17: // Balance pans counter-sweep; central counterweight fires late.
      for (let j = 0; j < 5; j++) {
        add(0, PI - 0.5 + j * 0.18, S.WAVE, j * 0.1, 0.8);
        add(1, PI + 0.5 - j * 0.18, S.ORB, j * 0.1, 1);
      }
      fan(2, 5, aim, 0.15, S.ACCEL, 0.68, 0.55);
      break;
    case 18: // Port claws distract while the offset tail hooks around them.
      for (let j = 0; j < 3; j++) {
        fan(0, 2, aim - 0.2, 0.11, S.NEEDLE, j * 0.18);
        fan(1, 2, aim + 0.2, 0.11, S.NEEDLE, j * 0.18);
      }
      fan(2, 3, aim + c * 0.5, 0.21, S.HOMING, 0.48, 0.68);
      break;
    case 19:
      for (let j = 0; j < 6; j++) add(0, PI - 0.55 + j * 0.19, S.SHARD, j * 0.075, 1.15);
      break;
    case 20:
      for (let m = 0; m < 3; m++) {
        add(m, aim + (m - 1) * 0.29, S.ACCEL, 0, 0.45);
        add(m, aim - (m - 1) * 0.34, S.ORB, 0.37, 0.7);
      }
      break;
    case 21:
      for (let m = 0; m < 3; m++) {
        add(m, aim + (m - 1) * 0.13, S.NEEDLE);
        add(m, aim + (m - 1) * 0.32, S.SHARD, 0.25, 0.85);
      }
      break;
    case 22:
      fan(0, 3, aim - 0.31, 0.17, S.SHARD);
      fan(1, 2, aim + 0.23, 0.28, S.ORB, 0.27, 0.75);
      break;
    case 23:
      for (let j = 0; j < 3; j++) {
        add(0, aim + 0.2, S.WAVE, j * 0.17, 0.8);
        add(1, aim - 0.2, S.PULSE, 0.1 + j * 0.17, 1.05);
      }
      break;
    case 24: // Six flank batteries ripple backward; rear shells split in transit.
      for (let m = 0; m < 6; m++)
        fan(m, 2, PI + ((m % 3) - 1) * 0.16, 0.1, S.SHARD, (m % 3) * 0.18);
      for (const m of [2, 5]) fan(m, 3, aim, 0.26, S.SPLIT, 0.6, 0.65);
      break;
    case 25:
      for (let j = 0; j < 5; j++)
        add(0, aim + c * j * 0.055, j === 0 ? S.PLASMA : S.NEEDLE, j * 0.12, 1.2 - j * 0.11);
      break;
    case 26:
      for (let m = 0; m < 5; m++)
        add(m, aim + (m - 2) * 0.12, m === cycle % 5 ? S.HOMING : S.ORB, m * 0.09, 0.9);
      break;
    case 27: // Hammer presses three squared ranks with deliberately alternating gaps.
      for (let beat = 0; beat < 3; beat++)
        for (let m = 0; m < 4; m++) {
          add(m, PI + (m < 2 ? 0.1 : -0.1), S.PULSE, beat * 0.27, 0.78);
          if (beat === 2) add(m, aim, S.ACCEL, 0.83, 0.52);
        }
      break;
    case 28:
      for (let j = 0; j < 3; j++) {
        add(0, PI - 0.08 - j * 0.07, S.WAVE, j * 0.16);
        add(1, PI + 0.08 + j * 0.07, S.WAVE, 0.08 + j * 0.16);
      }
      break;
    case 29:
      for (let m = 0; m < 3; m++) {
        add(m, cycle * 0.61 + (m * TAU) / 3, S.PLASMA, 0, 0.7);
        add(m, -cycle * 0.61 + (m * TAU) / 3, S.SHARD, 0.36, 1.05);
      }
      break;
    case 30: // Mechanical rail and organic lobe have entirely different rhythms.
      for (let m = 0; m < 2; m++)
        for (let j = 0; j < 4; j++) add(m, aim + (m - 0.5) * 0.16, S.NEEDLE, j * 0.1, 1.15);
      fan(2, 5, aim, 0.24, S.WAVE, 0.18, 0.7);
      fan(2, 3, aim + c * 0.22, 0.27, S.SPLIT, 0.7, 0.6);
      break;
    case 31:
      for (let m = 0; m < 4; m++) {
        fan(m, 3, PI + (m - 1.5) * 0.16, 0.16, S.SHARD, m * 0.15, 0.95);
        add(m, aim, S.PULSE, 0.65 + m * 0.05, 0.65);
      }
      break;
    case 32:
      for (let m = 0; m < 5; m++) add(m, (m * TAU) / 5 + cycle * 0.27, S.PULSE, m * 0.06, 0.9);
      add(0, aim, S.SPLIT, 0.42, 0.75);
      break;
    case 33: // Vertebrae fire a travelling sine wave from eight real flanks.
      for (let beat = 0; beat < 2; beat++)
        for (let m = 0; m < 8; m++)
          add(
            m,
            aim + Math.sin(m * 0.9 + beat * PI) * 0.34,
            m % 2 ? S.SHARD : S.WAVE,
            m * 0.07 + beat * 0.47,
            0.95,
          );
      fan(0, 3, aim, 0.19, S.HOMING, 0.95, 0.65);
      break;
    case 34:
      for (let m = 0; m < 3; m++) {
        add(m, PI + (m - 1) * 0.17, S.NEEDLE, m * 0.06);
        add(m, aim, S.SHARD, 0.35 + m * 0.06, 0.85);
      }
      break;
    case 35:
      fan(0, 3, aim - 0.26, 0.22, S.PLASMA, 0, 0.72);
      fan(1, 3, aim + 0.26, 0.22, S.SHARD, 0.36, 1);
      break;
    case 36:
      for (let j = 0; j < 6; j++) add(j % 3, PI + (j % 2 ? 0.3 : -0.3), S.NEEDLE, j * 0.1, 1.05);
      break;
    case 37:
      fan(0, 3, PI - 0.32, 0.14, S.BOUNCE, 0, 0.75);
      fan(1, 3, PI + 0.32, 0.14, S.SHARD, 0.25, 0.9);
      break;
    case 38:
      for (let m = 0; m < 3; m++) {
        add(m, aim - 0.14, S.PULSE, m * 0.18, 0.75);
        add(m, aim + 0.14, S.ORB, m * 0.18, 1.1);
      }
      break;
    case 39:
      for (let m = 0; m < 4; m++) add(m, aim + (m - 1.5) * 0.31, S.SPLIT, m * 0.08, 0.7);
      break;
    case 40:
      for (let m = 0; m < 3; m++) fan(m, 2, PI + (m - 1) * 0.48, 0.16, S.SHARD, m * 0.14, 0.9);
      break;
    case 41:
      for (let pass = 0; pass < 3; pass++)
        for (let m = 0; m < 5; m++)
          add(
            m,
            PI - 0.48 + m * 0.16,
            pass === 2 ? S.SPLIT : S.ACCEL,
            pass * 0.3 + m * 0.06,
            0.46 + pass * 0.07,
          );
      break;
    case 42:
      for (let j = 0; j < 7; j++)
        add(0, cycle * 0.43 + (j * TAU) / 7, j % 2 ? S.SHARD : S.PULSE, j * 0.04, 0.8);
      break;
    case 43: // Icebreaking teeth carve an alternating three-layer moving gate.
      for (let pass = 0; pass < 3; pass++)
        for (let m = 0; m < 6; m++)
          if (m !== (cycle + pass) % 6)
            add(m, PI + (pass - 1) * 0.1, pass === 1 ? S.BOUNCE : S.NEEDLE, pass * 0.32, 0.88);
      fan(2, 4, aim, 0.2, S.PLASMA, 1.02, 0.62);
      break;
    default:
      throw new Error(`Unmapped hostile design ${type}`);
  }
  return out;
}

/** New capital-ship attacks. Offsets describe emitter locations in the play plane. */
export function bossSalvo(stage: number, phase: number, cycle: number, aim: number): SalvoShot[] {
  const out: SalvoShot[] = [];
  const add = (x: number, y: number, a: number, kind: number, delay = 0, speed = 1) =>
    out.push({ mount: 0, dx: x, dy: y, angle: a, kind, delay, speed });
  const sign = cycle % 2 ? 1 : -1;
  if (stage === 0) {
    // Portal jaws: zipper / opposed diagonals / alternating iris bars.
    for (let row = 0; row < 6; row++)
      for (const side of [-1, 1]) {
        const y = side * (1.0 + row * 0.32);
        if (phase === 1) {
          add(-1.2, y, PI + side * (0.08 + row * 0.018), S.NEEDLE, row * 0.085);
          add(-1.2, y, PI - side * 0.13, S.ORB, 0.65 + row * 0.06, 0.8);
        }
        if (phase === 2)
          for (let k = 0; k < 3; k++)
            add(-1.2, y, PI + side * (0.28 - k * 0.17), S.SHARD, k * 0.23 + row * 0.025, 0.92);
        if (phase === 3 && row !== cycle % 6)
          for (let k = 0; k < 3; k++)
            add(
              -1.2,
              y,
              PI + sign * (k - 1) * 0.06,
              k === 1 ? S.PULSE : S.NEEDLE,
              k * 0.25,
              0.9 + k * 0.07,
            );
      }
  } else if (stage === 1) {
    // Siege rail: charge-and-train / magazine ladder / rail-and-shrapnel alternation.
    if (phase === 1) {
      for (let j = 0; j < 9; j++)
        for (const y of [-0.33, 0.33]) add(-3.7, y, aim, S.NEEDLE, j * 0.065, 1.0 + j * 0.035);
      for (let j = 0; j < 7; j++)
        add(0.6, -1.1, PI - 0.55 + j * 0.17, S.ACCEL, 0.4 + j * 0.04, 0.43);
    } else if (phase === 2) {
      for (let rung = 0; rung < 7; rung++)
        for (let j = 0; j < 4; j++)
          add(0.3, -1.1 + rung * 0.24, PI + (j - 1.5) * 0.2, S.SPLIT, rung * 0.1, 0.6);
    } else {
      for (let j = 0; j < 8; j++)
        for (const y of [-0.4, 0.4]) add(-3.7, y, aim + sign * 0.13, S.NEEDLE, j * 0.055, 1.25);
      for (let j = 0; j < 13; j++) add(0.6, -1.1, PI - 0.95 + j * 0.155, S.SHARD, 0.65, 0.85);
    }
  } else if (stage === 2) {
    // Three-arm station: triangular waves / counterspiral triplets / orbital petals.
    for (let arm = 0; arm < 3; arm++) {
      const a = (arm * TAU) / 3,
        x = Math.cos(a) * 2.6,
        y = Math.sin(a) * 2.6;
      if (phase === 1)
        for (let j = 0; j < 7; j++) add(x, y, a + PI + (j - 3) * 0.18, S.WAVE, arm * 0.17, 0.76);
      else if (phase === 2)
        for (let beat = 0; beat < 4; beat++)
          for (const direction of [-1, 1])
            add(
              x,
              y,
              a + cycle * 0.38 + direction * beat * 0.35,
              direction > 0 ? S.PLASMA : S.SHARD,
              beat * 0.15,
              0.85,
            );
      else
        for (let j = 0; j < 9; j++)
          add(
            x,
            y,
            a + cycle * 0.19 + (j - 4) * 0.26,
            j % 3 === 0 ? S.HOMING : S.PULSE,
            (j % 3) * 0.22,
            j % 3 === 0 ? 0.65 : 0.9,
          );
    }
  } else {
    // Articulated leviathan: spine ripple / jaw scissor / shed scales.
    if (phase === 1)
      for (let m = 0; m < 8; m++)
        for (const side of [-1, 1]) {
          const x = -2 + m * 0.63,
            y = side * 0.67;
          add(x, y, aim + side * (0.15 + Math.sin(m * 0.7) * 0.18), S.WAVE, m * 0.075, 0.9);
          add(x, y, PI + side * 0.37, S.SHARD, 0.65 + m * 0.04, 0.78);
        }
    else if (phase === 2)
      for (let beat = 0; beat < 4; beat++)
        for (let j = 0; j < 5; j++)
          for (const side of [-1, 1])
            add(
              -3,
              side * 0.72,
              PI + side * (0.6 - beat * 0.21 + j * 0.075),
              S.SHARD,
              beat * 0.18,
              0.87,
            );
    else
      for (let m = 0; m < 8; m++)
        for (const side of [-1, 1]) {
          add(-2 + m * 0.63, side * 0.75, PI + side * (0.18 + m * 0.07), S.SPLIT, m * 0.09, 0.6);
          add(-2 + m * 0.63, side * 0.75, aim + side * 0.1, S.ACCEL, 0.85 + m * 0.03, 0.52);
        }
  }
  return out;
}

export function groundSalvo(type: number, aim: number, cycle: number): SalvoShot[] {
  // Surface machinery has its own recipes rather than borrowing an aircraft's.
  const out: SalvoShot[] = [];
  const add = (a: number, kind: number, delay = 0, speed = 1, dx = 0, dy = 0) =>
    out.push({ mount: 0, angle: a, kind, delay, speed, dx, dy });
  switch (type) {
    case 0:
      for (let j = 0; j < 4; j++) {
        add(aim - 0.11, S.NEEDLE, j * 0.15);
        add(aim + 0.11, S.NEEDLE, 0.075 + j * 0.15);
      }
      break;
    case 1:
      for (let j = 0; j < 7; j++) add(aim - 0.65 + j * 0.21, S.WAVE, j * 0.055, 0.8);
      break;
    case 2:
      for (let j = 0; j < 3; j++) add(aim + (j - 1) * 0.3, S.ACCEL, j * 0.24, 0.45, (j - 1) * 0.38);
      break;
    case 3:
      for (let j = 0; j < 6; j++) add(aim + (j - 2.5) * 0.15, S.SPLIT, j * 0.07, 0.7);
      break;
    case 4:
      for (let j = 0; j < 8; j++) add(aim + Math.sin(j * 0.8 + cycle) * 0.6, S.SHARD, j * 0.06);
      break;
    case 5:
      for (let j = 0; j < 3; j++) {
        add(aim, S.PLASMA, j * 0.3, 0.7);
        add(aim - 0.32, S.ORB, j * 0.3);
        add(aim + 0.32, S.ORB, j * 0.3);
      }
      break;
    case 6:
      for (let j = 0; j < 4; j++) add(aim - 0.35 + j * 0.23, S.ACCEL, j * 0.22, 0.4 + j * 0.08);
      break;
    case 7:
      for (let j = 0; j < 5; j++) add(aim + (j - 2) * 0.27, S.BOUNCE, j * 0.12, 0.8);
      break;
    case 8:
      for (let j = 0; j < 3; j++)
        for (const x of [-0.3, 0, 0.3]) add(aim, S.NEEDLE, j * 0.2, 0.9, x);
      break;
    case 9:
      add(aim, S.HOMING, 0, 0.65);
      for (let j = 0; j < 6; j++) add(aim + (j - 2.5) * 0.2, S.PULSE, 0.4, 0.8);
      break;
    case 10:
      for (let j = 0; j < 5; j++) add(aim + Math.sin(cycle + j) * 0.4, S.SPLIT, j * 0.17, 0.6);
      break;
    case 11:
      for (let j = 0; j < 5; j++) {
        add(aim + (j - 2) * 0.14, S.SHARD, j * 0.09, 0.85, (j - 2) * 0.26);
        add(aim - (j - 2) * 0.2, S.WAVE, 0.6 + j * 0.06, 0.7, (j - 2) * 0.26);
      }
      break;
  }
  return out;
}
