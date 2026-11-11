/** Presets are complete: every one is listed, and every variable names the connection. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPresets } from '../src/presets.js';

const receivers = [{ n: 1, label: 'PRESENTER' }, { n: 2, label: 'GUEST' }];

test('every preset is in a section and every section entry exists', () => {
  const { structure, presets } = buildPresets(receivers, 'MICS');
  const listed = structure.flatMap((s) => s.definitions);
  assert.deepEqual(new Set(listed), new Set(Object.keys(presets)));
  for (const p of Object.values(presets)) assert.equal(p.type, 'simple');
});

test('variables are prefixed with the connection label, never the module id', () => {
  const { presets } = buildPresets(receivers, 'MICS');
  const text = JSON.stringify(presets);
  const refs = text.match(/\$\(([^:)]+):/g) ?? [];
  assert.ok(refs.length > 0);
  for (const r of refs) assert.equal(r, '$(MICS:');
});

test('one category per receiver, named by its label', () => {
  const { structure } = buildPresets(receivers, 'MICS');
  assert.deepEqual(structure.map((s) => s.id), ['rack', 'alerts', 'rx1', 'rx2']);
  assert.match(structure[2].name, /PRESENTER/);
});
