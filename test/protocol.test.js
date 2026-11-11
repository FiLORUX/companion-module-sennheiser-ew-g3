/**
 * The decoder against datagrams captured from four EM 500 G3 (07/09/2026),
 * and the client against a receiver simulated on loopback.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { afToDb, emptyState, McpClient, MCP_PORT, parseDatagram, rfToDbuv } from '../src/protocol.js';

// Verbatim from the receivers, CR-separated.
const CONFIG_REPLY = 'Push 0 0 1\rName ew500 G3\rFrequency 572400 21 1\rSquelch 5\rAfOut 18\rEqualizer 0\rMute 0\r';
const CYCLIC = 'RF1 14 16 1\rRF2 0 0 0\rStates 5 0\rRF 16 1 0\rAF 0 0 5\rBat ?\rMsg RF_Mute\rConfig 9\r';

test('config reply: identity, and the command echo is dropped by name', () => {
  const s = emptyState();
  const unknown = parseDatagram(Buffer.from(CONFIG_REPLY, 'ascii'), s);
  assert.deepEqual(unknown, []);
  assert.equal(s.name, 'ew500 G3');
  assert.equal(s.frequency, 572400);
  assert.deepEqual(s.frequencyExtra, ['21', '1']);
  assert.equal(s.squelch, 5);
  assert.equal(s.afOut, 18);
  assert.equal(s.mute, false);
});

test('cyclic reply: three-field RF with the active-antenna flag, AF, battery unknown, warnings', () => {
  const s = emptyState();
  assert.deepEqual(parseDatagram(Buffer.from(CYCLIC, 'ascii'), s), []);
  assert.equal(s.rf1, 14); assert.equal(s.rf1Peak, 16); assert.equal(s.rf1Active, true);
  assert.equal(s.rf2, 0); assert.equal(s.rf2Active, false);
  assert.equal(s.af, 0); assert.deepEqual(s.afExtra, ['5']);
  assert.equal(s.battery, '?', '"?" is its own state, never coerced to a number');
  assert.deepEqual(s.messages, ['RF_Mute']);
  assert.equal(s.config, '9');
  assert.deepEqual(s.rfSummary, ['16', '1', '0']);
  assert.equal(s.online, true);
});

test('battery steps stay strings', () => {
  for (const step of ['100', '70', '30', '0']) {
    const s = emptyState();
    parseDatagram(Buffer.from(`Bat ${step}\r`, 'ascii'), s);
    assert.equal(s.battery, step);
  }
});

test('a record nobody has seen yet is returned, not dropped', () => {
  const s = emptyState();
  assert.deepEqual(parseDatagram(Buffer.from('Bat 70\rPilot 1\r', 'ascii'), s), ['Pilot 1']);
  assert.equal(s.battery, '70');
});

test('unit conversions', () => {
  assert.equal(rfToDbuv(100), 40);
  assert.equal(rfToDbuv(50), 20);
  assert.equal(afToDb(5), -50);
  assert.equal(afToDb(85), 0);
  assert.equal(afToDb(35), -15, 'halfway between the 25 and 45 fixed points');
  assert.equal(afToDb(0), -50, 'below the lowest fixed point');
  assert.equal(afToDb(120), 0, 'above peak');
});

// A receiver on 127.0.0.2 pushing to the client the way a real one does: from
// its own port 53212 to the client's port 53212. Linux routes the whole of
// 127/8 to loopback; elsewhere the address may not exist, so the test skips.
test('client: a receiver is online while it pushes and silent once it stops', async (t) => {
  const rx = createSocket({ type: 'udp4', reuseAddr: true });
  try {
    await new Promise((resolve, reject) => { rx.once('error', reject); rx.bind(MCP_PORT, '127.0.0.2', resolve); });
  } catch (err) {
    t.skip(`cannot bind 127.0.0.2:${MCP_PORT} here (${err.code})`);
    return;
  }
  const received = [];
  rx.on('message', (m) => received.push(m.toString('ascii')));

  const presence = [];
  const client = new McpClient({
    targets: ['127.0.0.2'], updateRateMs: 100, staleMs: 1200,
    onUpdate: () => {}, onPresence: (addr, up) => presence.push([addr, up]), onLog: () => {},
  });
  try {
    await client.open();
  } catch (err) {
    rx.close();
    t.skip(`cannot bind udp/${MCP_PORT} here (${err.code})`);
    return;
  }
  try {
    const push = (text) => new Promise((r) => rx.send(Buffer.from(text, 'ascii'), MCP_PORT, '127.0.0.1', r));
    await push(CONFIG_REPLY);
    await push('RF1 60 62 0\rRF2 72 75 1\rAF 45 50 5\rBat 30\rMsg\rConfig 9\r');
    await new Promise((r) => setTimeout(r, 300));

    const s = client.states.get('127.0.0.2');
    assert.equal(s.online, true);
    assert.equal(s.name, 'ew500 G3');
    assert.equal(s.battery, '30');
    assert.equal(s.rf2Active, true);
    assert.deepEqual(presence[0], ['127.0.0.2', true]);
    assert.ok(received.some((m) => m.startsWith('Push 1 100 0')), 'the client subscribes');
    assert.ok(received.some((m) => m.startsWith('Push 0 0 1')), 'the client asks for the configuration');

    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(client.states.get('127.0.0.2').online, false, 'silence past staleMs means offline');
    assert.deepEqual(presence.at(-1), ['127.0.0.2', false]);
  } finally {
    client.close();
    rx.close();
  }
});
