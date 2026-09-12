import fs from 'node:fs';

// Each row is an independently authored silhouette and weapon concept.
const concepts = [
  ['CRESCENT COURIER', '#efb944', '#233b64', 'crescent-pair'],
  ['MONO RAIL NEEDLE', '#cf334b', '#e0d5b4', 'rail-train'],
  ['OFFSET HANGAR BARGE', '#477aad', '#ec8e35', 'bay-stagger'],
  ['OCTAGONAL BULWARK', '#228d79', '#f1d574', 'shield-slots'],
  ['SEGMENTED STINGER', '#dfa31e', '#473967', 'sting-braid'],
  ['QUAD ROTOR DRONE', '#a947a8', '#9fe6ca', 'rotor-pinwheel'],
  ['SUSPENDED HOWITZER', '#ac633a', '#91cad8', 'mortar-stair'],
  ['TRIHEDRAL SPLINTER', '#7fc3e5', '#742f53', 'shard-triplet'],
  ['BINOCULAR GUN PLATFORM', '#d77392', '#293a54', 'binocular-cross'],
  ['BLACK KITE', '#334052', '#c5a15a', 'raven-feather'],
  ['THREE NECK GUNSHIP', '#a1bd38', '#432535', 'hydra-converge'],
  ['ARMOURED TRAVERSE', '#d49b69', '#36596b', 'bunker-comb'],
  ['GIMBAL EYE', '#44ada9', '#f0e5ca', 'seeker-comet'],
  ['TWIN SCYTHE', '#699b39', '#c6a3d9', 'mantis-pincer'],
  ['HELICAL BORER', '#bcc4c7', '#d66b24', 'drill-corkscrew'],
  ['SPLIT OBSIDIAN TOWER', '#423258', '#f0ba35', 'monolith-window'],
  ['TRI POD KNOT', '#e16856', '#d9cfa0', 'swarm-cluster'],
  ['BALANCE ARRAY', '#eee4b5', '#3e71a5', 'arbiter-balance'],
  ['ASYMMETRIC SCORPION', '#81344a', '#5ed1c5', 'scourge-hook'],
  ['POLEAXE DRONE', '#456ebd', '#ecae83', 'halberd-cut'],
  ['OPEN FURNACE CAGE', '#d15123', '#453b32', 'cinder-embers'],
  ['THREE TALON CAGE', '#26a5bf', '#eda659', 'talon-rake'],
  ['BROKEN WING SALVAGER', '#a99d69', '#903e42', 'vulture-scatter'],
  ['RESONANCE FORK', '#9f74cb', '#e7d3e8', 'siren-duet'],
  ['REPTILE SIEGE DECK', '#397759', '#d7cb73', 'basilisk-scales'],
  ['TEARDROP ENGINE', '#e79647', '#51437c', 'comet-tail'],
  ['FIVE EYE FAN', '#c5537b', '#d4ddb1', 'gorgon-gaze'],
  ['HAMMERHEAD FREIGHTER', '#617c97', '#f1b73f', 'anvil-press'],
  ['HOLLOW SPECTRE', '#4e7582', '#72e5bc', 'wraith-aperture'],
  ['COUNTER ROTATING GYRO', '#7378d5', '#dfccb1', 'tempest-vortex'],
  ['UNBALANCED HYBRID', '#bb8553', '#56c9bd', 'chimera-duality'],
  ['TILTED PYRAMID', '#d4c5a1', '#aa4053', 'obelisk-runes'],
  ['FIVE PETAL CHARGE', '#de8bb7', '#472f58', 'nova-bloom'],
  ['ARTICULATED LEVIATHAN', '#285978', '#eaa676', 'leviathan-spine'],
  ['THREE PRONG ICE PICK', '#a3d5ea', '#be426a', 'sleet-fork'],
  ['FACETED LANTERN', '#8bd4a7', '#b46db5', 'glimmer-prism'],
  ['ZIGZAG RESONATOR', '#6786d0', '#efc665', 'shiver-zigzag'],
  ['HORSESHOE RADIATOR', '#d8dce5', '#496baa', 'rime-arch'],
  ['LINKED RAFT PLATFORM', '#63a5bb', '#dfa489', 'floe-offset'],
  ['HEX CRYSTAL CLUSTER', '#acb5ed', '#3d667b', 'crystal-refraction'],
  ['BRANCHING ANTENNA', '#b9c9b4', '#55786f', 'hoarfrost-branches'],
  ['FALLING BLOCK CARRIER', '#537da5', '#d4deef', 'calving-cascade'],
  ['MINERAL HARVEST ORB', '#8d8176', '#e3bc5f', 'moraine-orbit'],
  ['STEPPED ICEBREAKER', '#749eac', '#edf0ca', 'glacier-rampart'],
];
const medium = new Set([3, 10, 11, 15, 17, 18, 24, 27, 30, 31, 33, 41, 43]);
const defs = JSON.parse(fs.readFileSync('data/enemies/enemy-defs.json', 'utf8'));
const catalog = concepts.map(([design, primary, secondary, pattern], i) => ({
  id: i,
  name: defs[i].name,
  design,
  size: medium.has(i) ? 'medium' : 'small',
  palette: [primary, secondary, i % 2 ? '#e2ded2' : '#a9b4bb', secondary],
  pattern,
}));
fs.writeFileSync('data/enemies/fleet-designs.json', JSON.stringify(catalog, null, 2) + '\n');
for (const d of catalog) {
  const unit = defs[d.id];
  unit.sizeClass = d.size;
  unit.radius = d.size === 'medium' ? 1.04 + (d.id % 4) * 0.08 : 0.43 + (d.id % 5) * 0.035;
  unit.hp = d.size === 'medium' ? 68 + (d.id % 6) * 12 : 4 + (d.id % 4) * 3;
  unit.score = d.size === 'medium' ? 1400 + (d.id % 6) * 160 : 120 + (d.id % 5) * 70;
  unit.period = d.size === 'medium' ? 2.5 + (d.id % 3) * 0.22 : 1.7 + (d.id % 4) * 0.18;
  unit.fire.pattern = d.pattern;
}
fs.writeFileSync('data/enemies/enemy-defs.json', JSON.stringify(defs, null, 2) + '\n');

function allocate(waves, total) {
  const weight = waves.reduce((n, w) => n + w.count, 0);
  const fractions = waves
    .map((w, i) => {
      const exact = (total * w.count) / weight;
      w.count = Math.max(1, Math.floor(exact));
      return { i, remainder: exact - Math.floor(exact) };
    })
    .sort((a, b) => b.remainder - a.remainder);
  let delta = total - waves.reduce((n, w) => n + w.count, 0);
  for (let k = 0; delta !== 0; k++) {
    const wave = waves[fractions[k % fractions.length].i];
    if (delta > 0) {
      wave.count++;
      delta--;
    } else if (wave.count > 1) {
      wave.count--;
      delta++;
    }
  }
}
for (let i = 1; i <= 4; i++) {
  const path = `data/stages/stage-0${i}.json`;
  const stage = JSON.parse(fs.readFileSync(path, 'utf8'));
  const total = stage.spawns.reduce((n, w) => n + w.count, 0);
  const mid = Math.round(total * 0.3);
  allocate(
    stage.spawns.filter((w) => medium.has(w.type)),
    mid,
  );
  allocate(
    stage.spawns.filter((w) => !medium.has(w.type)),
    total - mid,
  );
  fs.writeFileSync(path, JSON.stringify(stage, null, 2) + '\n');
  console.log(`Stage ${i}: ${mid}/${total} medium (${((100 * mid) / total).toFixed(1)}%)`);
}
