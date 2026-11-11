#!/usr/bin/env node

/**
 * esbuild bundle for the Sennheiser ew G3/G4 Companion module.
 *
 * Companion launches `runtime.entrypoint` from `companion/manifest.json` as a
 * child Node process and speaks IPC over it. The path is resolved relative to
 * the manifest's own directory, so the declared `../dist/main.js` climbs back
 * to the module root — exactly where this script writes.
 *
 * The bundle must be self-contained. Companion 5 runs each module under Node's
 * permission model (`node --permission --allow-fs-read=<module-dir>`), so any
 * import that resolves outside the module directory dies with
 * ERR_ACCESS_DENIED at load. `@companion-module/base` is therefore inlined
 * rather than left external: shipping it as a symlinked `node_modules` tree
 * would put the real files outside the sandbox.
 *
 * No source map: it can be larger than the code, and Companion caps the
 * unpacked size of a module archive. Stack traces are read against the tagged
 * sources instead.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, context } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: [join(PKG_ROOT, 'src/main.js')],
  outfile: join(PKG_ROOT, 'dist/main.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  // Nothing is external — see the header comment.
  banner: {
    js: [
      '// Sennheiser ew G3/G4 receivers -- Bitfocus Companion module, bundled with esbuild.',
      '// Sources: https://github.com/FiLORUX/companion-module-sennheiser-ew-g3',
      "import { createRequire as __bundleCreateRequire } from 'node:module';",
      'const require = __bundleCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  logLevel: 'info',
  metafile: true,
  legalComments: 'none',
};

if (watch) {
  const ctx = await context(buildOptions);
  await ctx.watch();
  process.stdout.write('[bundle] watching…\n');
} else {
  const result = await build(buildOptions);
  const bytes = Object.values(result.metafile.outputs).reduce((sum, out) => sum + out.bytes, 0);
  process.stdout.write(`[bundle] dist/main.js — ${(bytes / 1024).toFixed(1)} kB\n`);
}
