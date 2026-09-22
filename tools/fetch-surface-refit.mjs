// Authored CC0 Poly Haven scans, fetched once and served locally (no runtime API).
import { mkdir, writeFile, access } from 'node:fs/promises';
import sharp from 'sharp';
const slugs = ['dark_rock_02', 'rock_boulder_cracked', 'snow_03', 'cracked_red_ground'];
for (const slug of slugs) {
  const response = await fetch(`https://api.polyhaven.com/files/${slug}`);
  if (!response.ok) throw new Error(`${slug}: ${response.status}`);
  const files = await response.json();
  for (const [channel, name] of [
    ['Diffuse', 'color'],
    ['nor_gl', 'normal'],
    ['Rough', 'rough'],
    ['Displacement', 'height'],
    ['AO', 'ao'],
  ]) {
    const file = `terrain/${slug}_${name}.jpg`;
    if (
      await access(`public/textures/${file}`).then(
        () => true,
        () => false,
      )
    )
      continue;
    const source = files[channel]['2k'].jpg ?? files[channel]['2k'].png;
    const res = await fetch(source.url);
    if (!res.ok) throw new Error(`${source.url}: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    for (const [dir, size] of [
      ['textures', 2048],
      ['textures-ios', 512],
    ]) {
      await mkdir(`public/${dir}/terrain`, { recursive: true });
      await writeFile(
        `public/${dir}/${file}`,
        await sharp(bytes)
          .resize(size, size)
          .jpeg({ quality: name === 'normal' ? 95 : 89 })
          .toBuffer(),
      );
    }
    console.log(file);
  }
}
await writeFile(
  'public/textures/terrain/REFIT-CREDITS.md',
  '# Surface refit\n\nPhotographic PBR scans by Poly Haven, CC0. Downloaded and JPEG compressed at 2K (512px for iOS).\n\n' +
    slugs.map((s) => `- https://polyhaven.com/a/${s}`).join('\n') +
    '\n\nPowered by Poly Haven (asset preparation API). No live API is used by the game.\n',
);
