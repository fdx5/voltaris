import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { compatibleThreeWGSL, threeWGSLCompatOptimizer } from '../../tools/three-wgsl-compat';

it('covers the shipped mipmap shader and the integer varying generator', async () => {
  for (const file of [
    'build/three.webgpu.js',
    'src/renderers/webgpu/utils/WebGPUTexturePassUtils.js',
    'src/renderers/webgpu/nodes/WGSLNodeBuilder.js',
  ]) {
    const source = await readFile(resolve('node_modules/three', file), 'utf8');
    expect(source).toContain('@interpolate(flat, either)');
    const output = compatibleThreeWGSL(source);
    expect(output).not.toContain('@interpolate(flat, either)');
    expect(output).toContain('@interpolate(flat)');
    expect(compatibleThreeWGSL(output)).toBe(output);
  }
});

it('preserves unrelated perspective and sample interpolation', () => {
  const source = '@interpolate(perspective, centroid) @interpolate(linear, sample)';
  expect(compatibleThreeWGSL(source)).toBe(source);
});

it('also fixes the dependency optimizer bundle used by the dev server', async () => {
  const result = await build({
    entryPoints: ['three/webgpu'],
    bundle: true,
    write: false,
    format: 'esm',
    plugins: [threeWGSLCompatOptimizer()],
  });
  const output = result.outputFiles[0].text;
  expect(output).toContain('@interpolate(flat)');
  expect(output).not.toMatch(/@interpolate\(\s*flat\s*,\s*either\s*\)/);
});
