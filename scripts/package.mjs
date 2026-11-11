#!/usr/bin/env node

/**
 * Package the bundled module as a Companion-importable tarball.
 *
 * Companion 5 accepts a custom module through
 * `instances.modulesManager.installModuleTar`, which gunzips the upload and
 * extracts it with `strip: 1`. The archive must therefore be gzip-compressed
 * and wrap the module in exactly one top-level directory; a file sitting at the
 * archive root loses its only path segment and disappears.
 *
 * The wrapper holds:
 *
 *   sennheiser-ew-g3/companion/manifest.json   module metadata (schema-validated)
 *   sennheiser-ew-g3/companion/HELP.md         surfaced in the connection editor
 *   sennheiser-ew-g3/dist/main.js              the self-contained bundle
 *   sennheiser-ew-g3/package.json              name/version/main, for the loader
 *   sennheiser-ew-g3/node_modules/@companion-module/base/package.json
 *
 * That last file is a stub, and it is the only reason `node_modules` exists in
 * the archive at all. Companion's host process reads the module API version
 * from it *before* launching the child process; the runtime bundle inlines the
 * real package, so nothing else in the tree is needed. Without the stub the
 * module fails to load with "Cannot find module
 * '@companion-module/base/package.json'".
 *
 * The tar is written here rather than shelled out to the platform `tar`, so the
 * archive is byte-identical wherever the build runs and does not depend on
 * GNU-versus-BSD flag differences. Fixed mtime and ownership keep it
 * reproducible: the same sources produce the same tarball.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');

const manifest = JSON.parse(readFileSync(join(PKG_ROOT, 'companion/manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));

// The manifest version is what Companion installs under
// <config>/modules/<id>-<version>/ and what an operator sees in the version
// picker. A package.json that has drifted from it would silently ship a
// mislabelled artefact, so refuse rather than guess which one is intended.
if (manifest.version !== pkg.version) {
  throw new Error(
    `version mismatch: companion/manifest.json is ${manifest.version}, package.json is ${pkg.version}`,
  );
}

const baseVersion = JSON.parse(
  readFileSync(join(PKG_ROOT, 'node_modules/@companion-module/base/package.json'), 'utf8'),
).version;

const declaredApi = manifest.runtime?.apiVersion;
if (declaredApi && baseVersion !== declaredApi) {
  throw new Error(
    `manifest.runtime.apiVersion is ${declaredApi} but the installed @companion-module/base is ${baseVersion}`,
  );
}

const ROOT = manifest.id;
const bundle = readFileSync(join(PKG_ROOT, 'dist/main.js'));

const files = [
  [`${ROOT}/companion/manifest.json`, readFileSync(join(PKG_ROOT, 'companion/manifest.json'))],
  [`${ROOT}/companion/HELP.md`, readFileSync(join(PKG_ROOT, 'companion/HELP.md'))],
  [`${ROOT}/LICENSE`, readFileSync(join(PKG_ROOT, 'LICENSE'))],
  [`${ROOT}/dist/main.js`, bundle],
  [
    `${ROOT}/package.json`,
    Buffer.from(
      `${JSON.stringify(
        {
          name: manifest.id,
          version: manifest.version,
          type: 'module',
          main: 'dist/main.js',
          license: manifest.license,
        },
        null,
        2,
      )}\n`,
    ),
  ],
  [
    `${ROOT}/node_modules/@companion-module/base/package.json`,
    Buffer.from(`${JSON.stringify({ name: '@companion-module/base', version: baseVersion }, null, 2)}\n`),
  ],
];

// ------------------------------------------------------------------ tar (ustar)
// A tar entry is a 512-byte header followed by the data padded to 512 bytes.
// Long paths would need the ustar prefix split; the module's paths are far
// short of 100 characters, so the check below is a guard, not a code path.
const BLOCK = 512;
const MTIME = 0; // fixed epoch — the artefact is reproducible, not timestamped

function header(name, size, type) {
  if (Buffer.byteLength(name) > 100) throw new Error(`path too long for a ustar header: ${name}`);
  const buf = Buffer.alloc(BLOCK);
  const write = (value, offset, length) => buf.write(value.padEnd(length, '\0'), offset, length, 'utf8');
  const octal = (value, length) => `${value.toString(8).padStart(length - 1, '0')}\0`;

  write(name, 0, 100);
  write(octal(type === '5' ? 0o755 : 0o644, 8), 100, 8); // mode
  write(octal(0, 8), 108, 8); // uid
  write(octal(0, 8), 116, 8); // gid
  write(octal(size, 12), 124, 12);
  write(octal(MTIME, 12), 136, 12);
  buf.write('        ', 148, 8, 'utf8'); // checksum field is spaces while summing
  buf.write(type, 156, 1, 'utf8');
  write('ustar\0', 257, 6);
  write('00', 263, 2);

  const checksum = buf.reduce((sum, byte) => sum + byte, 0);
  buf.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf8');
  return buf;
}

function pad(size) {
  const remainder = size % BLOCK;
  return remainder === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK - remainder);
}

const chunks = [];

// Directory entries first, parents before children, so an extractor that does
// not create intermediate directories on its own still lands every file.
const directories = new Set();
for (const [path] of files) {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i += 1) directories.add(`${parts.slice(0, i).join('/')}/`);
}
for (const dir of [...directories].sort()) chunks.push(header(dir, 0, '5'));

for (const [path, data] of files) {
  chunks.push(header(path, data.length, '0'), data, pad(data.length));
}

chunks.push(Buffer.alloc(BLOCK * 2)); // two zero blocks end the archive

const tarball = gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 });

const outDir = join(PKG_ROOT, 'dist');
const outFile = join(outDir, `${ROOT}-${manifest.version}.tgz`);
rmSync(outFile, { force: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, tarball);

const digest = createHash('sha256').update(tarball).digest('hex');
process.stdout.write(
  [
    `[package] ${outFile}`,
    `[package] module ${manifest.id} ${manifest.version}, api ${baseVersion}, ${files.length} files`,
    `[package] bundle ${(bundle.length / 1024).toFixed(1)} kB, archive ${(tarball.length / 1024).toFixed(1)} kB`,
    `[package] sha256 ${digest}`,
    '',
  ].join('\n'),
);
