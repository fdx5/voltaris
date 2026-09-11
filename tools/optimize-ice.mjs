import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';

// Offline asset preparation, not a build-time network dependency.
for (const kind of ['color', 'normal', 'roughness']) {
  const path = `public/textures/surfaces/ice_${kind}.jpg`;
  const input = await readFile(path);
  const output = await sharp(input)
    .resize(2048, 2048, { withoutEnlargement: true })
    .jpeg({ quality: kind === 'normal' ? 94 : 90, chromaSubsampling: '4:4:4' })
    .toBuffer();
  await writeFile(path, output);
  console.log(`${kind}: ${input.length} → ${output.length} bytes`);
}
