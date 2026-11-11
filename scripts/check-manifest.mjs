#!/usr/bin/env node

/**
 * Validate companion/manifest.json against the schema shipped with the
 * @companion-module/base this module is built on, and check that the manifest
 * agrees with package.json.
 *
 * Companion validates a manifest when it loads a module, and a module whose
 * manifest is wrong simply does not appear -- the user sees nothing to
 * diagnose. This catches the same faults at build time. It is a deliberately
 * small validator (required keys, types, enums, unknown keys) rather than a
 * full JSON Schema engine, so the build needs no extra dependency.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const manifest = read('companion/manifest.json');
const pkg = read('package.json');
const schema = read('node_modules/@companion-module/base/assets/manifest.schema.json');
const base = read('node_modules/@companion-module/base/package.json');

const problems = [];

function check(value, rule, path) {
  if (rule.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return problems.push(`${path}: expected an object`);
    for (const key of rule.required ?? []) if (!(key in value)) problems.push(`${path}.${key}: required`);
    for (const [key, v] of Object.entries(value)) {
      if (key === '$schema') continue;
      const sub = rule.properties?.[key];
      if (!sub) { if (rule.additionalProperties === false) problems.push(`${path}.${key}: not allowed by the schema`); continue; }
      check(v, sub, `${path}.${key}`);
    }
  } else if (rule.type === 'array') {
    if (!Array.isArray(value)) return problems.push(`${path}: expected an array`);
    if (rule.minItems && value.length < rule.minItems) problems.push(`${path}: needs at least ${rule.minItems} item(s)`);
    if (rule.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) problems.push(`${path}: items must be unique`);
    value.forEach((v, i) => rule.items && check(v, rule.items, `${path}[${i}]`));
  } else if (rule.type === 'string') {
    if (typeof value !== 'string') return problems.push(`${path}: expected a string`);
    if (rule.enum && !rule.enum.includes(value)) problems.push(`${path}: "${value}" is not one of ${rule.enum.join(', ')}`);
  } else if (rule.type === 'boolean' && typeof value !== 'boolean') {
    problems.push(`${path}: expected true or false`);
  }
}

check(manifest, schema, 'manifest');

// Agreement the schema cannot express.
if (manifest.version !== pkg.version) problems.push(`version: manifest ${manifest.version}, package.json ${pkg.version}`);
if (manifest.license !== pkg.license) problems.push(`license: manifest ${manifest.license}, package.json ${pkg.license}`);
if (manifest.runtime?.apiVersion !== base.version) problems.push(`runtime.apiVersion ${manifest.runtime?.apiVersion}, installed @companion-module/base ${base.version}`);
if (!/^[a-z0-9-]+$/.test(manifest.id)) problems.push(`id "${manifest.id}": lower case, digits and hyphens only`);
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(manifest.version)) problems.push(`version "${manifest.version}" is not semver`);

if (problems.length) {
  process.stderr.write(`manifest check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`[check] manifest ${manifest.id} ${manifest.version} valid against @companion-module/base ${base.version}\n`);
