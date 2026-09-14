import { build } from 'esbuild';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { readFleetGeometry, readGroundGeometry } from './read-fleet-geometry.mjs';
import { fitEngines } from './fit-engines.mjs';
const roster = JSON.parse(await readFile('data/enemies/imported-fleet.json', 'utf8'));
const temp = new URL('./.imported-hardpoints.mjs', import.meta.url);
await build({
  entryPoints: ['src/visual/ImportedFleet.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: temp.pathname.replace(/^\/([A-Z]:)/, '$1'),
});
try {
  const fleet = await import(temp.href);
  await fleet.loadImportedFleet(await readFleetGeometry(), await readGroundGeometry());
  for (const kind of ['fleet', 'ground']) {
    const path = `data/enemies/${kind}-hardpoints.json`;
    const records = JSON.parse(await readFile(path, 'utf8'));
    for (const [i, record] of records.entries()) {
      const parts =
        kind === 'fleet' ? fleet.importedEnemyGeometry(i) : fleet.importedGroundGeometry(i);
      const g = parts.hull;
      g.computeBoundingBox();
      const box = g.boundingBox,
        p = g.attributes.position;
      let y = 0,
        z = 0,
        n = 0;
      for (let j = 0; j < p.count; j++)
        if (p.getX(j) < box.min.x + (box.max.x - box.min.x) * 0.025) {
          y += p.getY(j);
          z += p.getZ(j);
          n++;
        }
      const entry = (kind === 'fleet' ? roster.enemies : roster.ground)[i];
      // Projectiles leave the nose: the mean of the forward-most 2.5% of vertices.
      // Vertical launchers and towers (roster `muzzle: "top"`) fire from their crown.
      let muzzle = [box.min.x, y / n, z / n];
      if (entry.muzzle === 'top') {
        let tx = 0,
          tz = 0,
          tn = 0;
        for (let j = 0; j < p.count; j++)
          if (p.getY(j) > box.max.y - (box.max.y - box.min.y) * 0.04) {
            tx += p.getX(j);
            tz += p.getZ(j);
            tn++;
          }
        muzzle = [tx / tn, box.max.y, tz / tn];
      }
      record.viewDegrees = entry.view;
      record.muzzles = record.muzzles.map(() => muzzle);
      // Exhaust bells, as [x, y, z, radius] in the drawn hull's space; flames trail toward +X.
      if (kind === 'fleet') record.engines = fitEngines(g);
      record.source = `${roster.packs[entry.pack].artist} / ${roster.packs[entry.pack].title}`;
      record.model = entry.model;
      parts.hull.dispose();
      parts.accent.dispose();
    }
    await writeFile(path, JSON.stringify(records, null, 2) + '\n');
  }
} finally {
  await unlink(temp);
}
