import { readFile } from 'node:fs/promises';
import type { Plugin as EsbuildPlugin } from 'esbuild';
import type { Plugin } from 'vite';

// Three r186 uses the newer optional flat sampling qualifier in both its
// texture-pass shader and generated integer varyings. Older Tint parsers
// reject "either". Bare flat is valid on both versions (first-vertex sampling),
// and these layer/instance indices are constant across a primitive.
// https://www.w3.org/TR/WGSL/#interpolation
export function compatibleThreeWGSL(source: string) {
  return source.replace(/@interpolate\(\s*flat\s*,\s*either\s*\)/g, '@interpolate(flat)');
}

function isThreeModule(id: string) {
  return /\/node_modules\/three\/(?:build|src)\/.*\.js$/.test(id.replaceAll('\\', '/'));
}

/** Production builds and modules outside Vite's dependency optimizer. */
export function threeWGSLCompat(): Plugin {
  return {
    name: 'voltaris-three-wgsl-compat',
    enforce: 'pre',
    transform(source, id) {
      if (!isThreeModule(id)) return null;
      const code = compatibleThreeWGSL(source);
      return code === source ? null : { code, map: null };
    },
  };
}

/** Vite prebundles Three with esbuild in development, before transform hooks. */
export function threeWGSLCompatOptimizer(): EsbuildPlugin {
  return {
    name: 'voltaris-three-wgsl-compat',
    setup(build) {
      build.onLoad({ filter: /[\\/]three[\\/](build|src)[\\/].*\.js$/ }, async ({ path }) => {
        if (!isThreeModule(path)) return;
        return { contents: compatibleThreeWGSL(await readFile(path, 'utf8')), loader: 'js' };
      });
    },
  };
}
