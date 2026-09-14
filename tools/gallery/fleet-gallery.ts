// Dev-only inspection sheet: every imported roster slot drawn with the game's
// hull material, lights and orientation. `vite` then open /tools/gallery/fleet-gallery.html
import * as T from 'three/webgpu';
import {
  loadImportedFleet,
  importedEnemyGeometry,
  importedGroundGeometry,
  makeImportedBoss,
  makeImportedShip,
  finishHull,
} from '../../src/visual/ImportedFleet';
import defs from '../../data/enemies/enemy-defs.json';
import groundDefs from '../../data/enemies/ground-defs.json';
import roster from '../../data/enemies/imported-fleet.json';

const params = new URLSearchParams(location.search);
const section = params.get('section') ?? 'enemies';
const cell = Number(params.get('cell') ?? 260);
await loadImportedFleet();
const host = document.getElementById('host')!;
type Entry = { object: T.Object3D; label: string; extent: number };
const entries: Entry[] = [];
const hull = (parts: ReturnType<typeof importedEnemyGeometry>) => {
  const material = new T.MeshStandardNodeMaterial({ vertexColors: true, map: parts.map ?? null });
  finishHull(material, parts.surface ?? null);
  const group = new T.Group();
  group.add(new T.Mesh(parts.hull!, material));
  return group;
};
if (section === 'enemies')
  defs.forEach((d, i) =>
    entries.push({
      object: hull(importedEnemyGeometry(i)),
      label: `${String(i).padStart(2, '0')} <b>${d.name}</b> ${d.sizeClass}<br>${roster.enemies[i].pack}/${roster.enemies[i].model} · ${roster.enemies[i].view}°`,
      extent: defs[i].radius * 1.6,
    }),
  );
if (section === 'ground')
  groundDefs.forEach((d, i) => {
    for (const roof of [false, true]) {
      const object = hull(importedGroundGeometry(i));
      if (roof) object.scale.set(1, -1, -1);
      object.position.y = roof ? groundDefs[i].radius * 0.6 : -groundDefs[i].radius * 0.6;
      entries.push({
        object,
        label: `${String(i).padStart(2, '0')} <b>${d.name}</b>${roof ? ' (roof)' : ''}<br>${roster.ground[i].pack}/${roster.ground[i].model}`,
        extent: groundDefs[i].radius * 1.4,
      });
    }
  });
if (section === 'bosses') {
  const ship = makeImportedShip();
  entries.push({ object: ship, label: `<b>PLAYER</b> ${roster.player.model}`, extent: 2 });
  for (const design of ['gatekeeper', 'ares', 'jove', 'nereid'] as const) {
    const boss = makeImportedBoss(design);
    entries.push({
      object: boss.root,
      label: `<b>${design.toUpperCase()}</b> ${roster.bosses[design].hull.model}`,
      extent: 6,
    });
    entries.push({
      object: boss.pods[0],
      label: `${design} pod · ${roster.bosses[design].pod.model}`,
      extent: 0.8,
    });
  }
}
const columns = Number(params.get('columns') ?? (section === 'bosses' ? 3 : 6));
const rows = Math.ceil(entries.length / columns);
const width = columns * cell,
  height = rows * (cell + 34);
const dpr = Number(params.get('dpr') ?? 1);
const renderer = new T.WebGPURenderer({ antialias: true, forceWebGL: true });
renderer.setPixelRatio(dpr);
renderer.setSize(cell, cell);
const sheet = document.createElement('canvas');
sheet.width = width * dpr;
sheet.height = height * dpr;
sheet.style.width = `${width}px`;
sheet.style.height = `${height}px`;
const ctx = sheet.getContext('2d')!;
ctx.fillStyle = '#03060c';
ctx.fillRect(0, 0, sheet.width, sheet.height);
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
host.appendChild(sheet);
await renderer.init();
const scene = new T.Scene();
scene.background = new T.Color('#03060c');
scene.add(new T.HemisphereLight('#b9d6eb', '#15161c', 2.1));
for (const [c, i, p] of [
  ['#e1eff2', 3.5, [-9, 13, 20]],
  ['#527991', 3, [4, -6, -10]],
  ['#8fc0e4', 2.6, [-3, -12, 7]],
  ['#4d7fa8', 1.2, [7, -9, -6]],
] as const) {
  const light = new T.DirectionalLight(c, i);
  light.position.set(...p);
  scene.add(light);
}
const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
camera.position.set(0, 0, 40);
for (const [index, entry] of entries.entries()) {
  for (const other of entries) other.object.visible = other === entry;
  if (!entry.object.parent) scene.add(entry.object);
  const x = (index % columns) * cell,
    y = Math.floor(index / columns) * (cell + 34);
  const e = entry.extent;
  camera.left = -e;
  camera.right = e;
  camera.top = e;
  camera.bottom = -e;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  ctx.drawImage(renderer.domElement, x * dpr, y * dpr);
  const label = document.createElement('div');
  label.className = 'label';
  label.style.left = `${x + cell / 2}px`;
  label.style.top = `${y + cell}px`;
  label.innerHTML = entry.label;
  host.appendChild(label);
}
host.style.width = `${width}px`;
host.style.height = `${height}px`;
document.body.dataset.ready = '1';
