import { build } from 'esbuild';
await build({
  entryPoints: ['server/replay.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'server/.generated/replay.mjs',
});
