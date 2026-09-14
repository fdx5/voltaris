// Offline geometry preview: no game, browser, or production debug route required.
import { build } from 'esbuild';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { Mesh, Vector3 } from 'three/webgpu';
import { readFleetGeometry, readGroundGeometry } from './read-fleet-geometry.mjs';
const temporary = new URL('./.fleet-models.mjs', import.meta.url);
await build({
  entryPoints: ['src/visual/SceneBuilder.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: temporary.pathname.replace(/^\/([A-Z]:)/, '$1'),
});
try {
  const {
    loadImportedFleet,
    enemyGeometry,
    groundGeometry,
    makeBoss,
    makeShip,
    FLEET_STYLE,
    GROUND_TYPES,
  } = await import(temporary.href);
  await loadImportedFleet(await readFleetGeometry(), await readGroundGeometry());
  const records = [];
  function meshData(geometry, material, matrix) {
    const p = geometry.attributes.position,
      c = geometry.attributes.color,
      n = geometry.attributes.normal;
    const points = [],
      colors = [],
      normals = [];
    const vertex = new Vector3();
    for (let i = 0; i < p.count; i++) {
      vertex.fromBufferAttribute(p, i);
      if (matrix) vertex.applyMatrix4(matrix);
      points.push(...vertex.toArray());
      if (c) colors.push(c.getX(i), c.getY(i), c.getZ(i));
      else colors.push(...(material?.color?.toArray() ?? [0.5, 0.5, 0.5]));
      if (n) {
        vertex.fromBufferAttribute(n, i);
        if (matrix) vertex.transformDirection(matrix);
        normals.push(...vertex.toArray());
      }
    }
    return {
      points,
      colors,
      normals,
      index: geometry.index ? [...geometry.index.array] : null,
      emissive: material?.isMeshBasicNodeMaterial ?? false,
    };
  }
  for (let i = 0; i < FLEET_STYLE.length; i++) {
    const g = enemyGeometry(i);
    records.push({
      name: FLEET_STYLE[i][0],
      palette: FLEET_STYLE[i].slice(1, 4),
      parts: [meshData(g.hull), { ...meshData(g.accent), emissive: true }],
    });
  }
  for (let i = 0; i < GROUND_TYPES; i++) {
    const g = groundGeometry(i);
    records.push({
      name: `EMPLACEMENT ${String(i + 1).padStart(2, '0')}`,
      parts: [meshData(g.hull), { ...meshData(g.accent), emissive: true }],
    });
  }
  function addRoot(name, root) {
    root.updateMatrixWorld(true);
    const parts = [];
    root.traverse((o) => {
      if (o instanceof Mesh) parts.push(meshData(o.geometry, o.material, o.matrixWorld));
    });
    records.push({ name, parts });
  }
  for (const design of ['gatekeeper', 'ares', 'jove', 'nereid']) {
    const boss = makeBoss(design);
    boss.pods.forEach((p, i) => {
      const a = (i / boss.pods.length) * Math.PI * 2;
      p.position.set(Math.cos(a) * 5, Math.sin(a) * 5, 0);
      p.rotation.z = a;
      boss.root.add(p);
    });
    addRoot(design.toUpperCase(), boss.root);
  }
  addRoot('PLAYER / VOLTARIS', makeShip());
  await mkdir('doc/validation', { recursive: true });
  await writeFile('doc/validation/fleet-preview.json', JSON.stringify(records));
} finally {
  await unlink(temporary);
}
