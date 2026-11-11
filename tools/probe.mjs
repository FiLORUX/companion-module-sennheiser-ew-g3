#!/usr/bin/env node
// probe.mjs -- talk to Sennheiser ew G3/G4 receivers without Companion.
//
//   node tools/probe.mjs discover [--iface <ip>] [--seconds N]
//   node tools/probe.mjs read <ip> [<ip> ...] [--seconds N] [--raw]
//
// `discover` sends Sennheiser's multicast service command and lists every
// receiver that reveals itself: model, serial and address. `read` subscribes to
// the cyclic attributes of one or more receivers and prints the decoded
// telemetry -- RF per antenna, AF, battery, squelch, name, frequency. `--raw`
// also prints every datagram verbatim, which is what to attach to an issue when
// a receiver model is not yet confirmed.
//
// Run it on the machine that will run Companion, with Companion's connection
// disabled: both need UDP 53212 and only one process per machine can hold it.
//
// No dependencies beyond the module's own decoder. Node >= 22.

import { createSocket } from 'node:dgram';
// The module's own decoder: what this prints is exactly what the module sees.
import { afToDb, emptyState, parseDatagram, rfToDbuv } from '../src/protocol.js';

// Both directions use the same port. The receiver answers to 53212, not to the
// sender's ephemeral port, so a client MUST bind 53212 to hear anything -- and
// only one process per host can. That single fact decides the shape of any
// Companion module: one connection serving every receiver, never one connection
// per receiver.
const MCP_PORT = 53212;

// Discovery is a separate service on its own port, and replies arrive from that
// same port. It is link-local multicast, so it crosses an L2 segment even when
// the receivers sit on a different IP subnet from the host: four EM 500 G3 were
// once found this way on a subnet the host had no address on, and then did not
// answer a single unicast read. Discovery working proves nothing about
// reachability.
const DISCOVERY_PORT = 8133;
const DISCOVERY_GROUP = '224.0.0.251';

// The service command that makes receivers announce themselves. The padding is
// not decoration: the devices ignore a short datagram, so the whole 1035 bytes
// go on the wire.
function discoveryPacket() {
  const head = Buffer.from([0x12, 0x07, 0x06, 0x20, 0x00, 0x00, 0x19, 0x00]);
  const body = Buffer.from('[servicecommand]devinfo\r\n', 'ascii');
  const pad = Buffer.alloc(999, 0x00);
  const tail = Buffer.from([0x01, 0x01, 0x01]);
  const packet = Buffer.concat([head, body, pad, tail]);
  if (packet.length !== 1035) throw new Error(`discovery packet is ${packet.length} bytes, expected 1035`);
  return packet;
}

// ---------------------------------------------------------------- decoding

// Battery is a four-step gauge reported as a string, not a percentage. "?" is
// its own state -- no battery status available -- and must never be drawn as
// empty, which would read as "flat" to an operator glancing at the panel.
const BATTERY = { '100': 'full', '70': 'good', '30': 'low', '0': 'empty', '?': 'unknown' };

const fmt = (v, unit = '', digits = 1) => (v === undefined ? '—' : `${v.toFixed(digits)}${unit}`);

function renderState(addr, s) {
  const bat = s.battery === undefined ? '—' : `${BATTERY[s.battery] ?? s.battery} (${s.battery})`;
  const rf1 = s.rf1 === undefined ? '—' : `${fmt(rfToDbuv(s.rf1))} dBµV`;
  const rf2 = s.rf2 === undefined ? '—' : `${fmt(rfToDbuv(s.rf2))} dBµV`;
  const af = s.af === undefined ? '—' : `${fmt(afToDb(s.af))} dB`;
  // The receiver reports kHz; broadcast usage is MHz to three decimals.
  const mhz = s.frequency === undefined ? '—' : `${(s.frequency / 1000).toFixed(3)} MHz`;
  const ant = (active) => (active === undefined ? ' ' : active ? '*' : ' ');
  return [
    `${addr.padEnd(15)} ${String(s.name ?? '—').padEnd(12)} ${mhz.padEnd(12)} ${s.mute === undefined ? '' : s.mute ? 'MUTED' : ''}`,
    `  battery ${bat}`,
    `  RF A${ant(s.rf1Active)} ${rf1}   RF B${ant(s.rf2Active)} ${rf2}   squelch ${s.squelch ?? '—'}`,
    `  AF ${af}   messages ${s.messages.length ? s.messages.join(' ') : '—'}`,
  ].join('\n');
}

// ---------------------------------------------------------------- discover

async function cmdDiscover({ seconds, iface }) {
  const packet = discoveryPacket();
  const socket = createSocket({ type: 'udp4', reuseAddr: true });
  const found = new Map();

  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(DISCOVERY_PORT, () => resolve());
  });
  socket.setBroadcast(true);
  try { socket.setMulticastTTL(1); } catch { /* not fatal on every stack */ }
  if (iface) { try { socket.setMulticastInterface(iface); } catch (e) { console.error(`  warning: could not pin multicast to ${iface}: ${e.message}`); } }

  socket.on('message', (msg, rinfo) => {
    // Receivers answer from the discovery port itself; anything else on this
    // socket is our own traffic or another service, and is not a device.
    if (rinfo.port !== DISCOVERY_PORT || found.has(rinfo.address)) return;
    const text = msg.toString('ascii');
    const field = (n) => (text.match(new RegExp(`${n}=([^\\s\\x00]+)`)) ?? [])[1];
    found.set(rinfo.address, { model: field('Model'), id: field('ID'), ip: field('IPA') ?? rinfo.address });
  });

  console.log(`discovery: ${packet.length} bytes to ${DISCOVERY_GROUP}:${DISCOVERY_PORT}, listening ${seconds} s`);
  for (let i = 0; i < 3; i++) {
    socket.send(packet, DISCOVERY_PORT, DISCOVERY_GROUP);
    await new Promise((r) => setTimeout(r, 300));
  }
  await new Promise((r) => setTimeout(r, seconds * 1000));
  socket.close();

  if (!found.size) {
    console.log('no receiver revealed itself.');
    console.log('discovery is link-local multicast: silence means nothing on this segment answered,');
    console.log('not that a receiver elsewhere is absent. Run it on the host that will do the polling.');
    process.exitCode = 1;
    return;
  }
  console.log(`\n${found.size} receiver(s):\n`);
  for (const [addr, d] of found) console.log(`  ${addr.padEnd(15)} ${String(d.model ?? '?').padEnd(12)} ${d.id ?? ''}`);
  console.log('\nDiscovery crossing an L2 segment says nothing about IP reachability.');
  console.log('Confirm with `read` from the host that will run the module.');
}

// ---------------------------------------------------------------- read

async function cmdRead(targets, { seconds, raw }) {
  const socket = createSocket({ type: 'udp4', reuseAddr: true });
  const states = new Map(targets.map((t) => [t, emptyState()]));
  const unknownSeen = new Set();
  let datagrams = 0;

  await new Promise((resolve, reject) => {
    socket.once('error', (e) => reject(new Error(
      e.code === 'EADDRINUSE'
        ? `udp/${MCP_PORT} is already bound on this host -- the receivers answer to that exact port, so whatever holds it must be stopped first`
        : e.message)));
    socket.bind(MCP_PORT, () => resolve());
  });

  socket.on('message', (msg, rinfo) => {
    const state = states.get(rinfo.address);
    // A device message always begins with an uppercase ASCII letter; our own
    // echoed commands and anything else are ignored rather than half-parsed.
    if (!state || msg.length === 0 || msg[0] < 0x41 || msg[0] > 0x5a) return;
    datagrams++;
    if (raw) console.log(`  raw ${rinfo.address}: ${JSON.stringify(msg.toString('ascii'))}`);
    for (const u of parseDatagram(msg, state)) if (!unknownSeen.has(u)) { unknownSeen.add(u); console.error(`  unhandled record from ${rinfo.address}: ${u}`); }
  });

  const send = (cmd) => { for (const t of targets) socket.send(Buffer.from(`${cmd}\r`, 'ascii'), MCP_PORT, t); };

  // Flag 1 asks for the static configuration once; flag 0 starts the cyclic
  // push. The subscription lapses, so it is re-sent every interval -- exactly
  // what the reference implementation does.
  const sendOne = (cmd, target) => socket.send(Buffer.from(`${cmd}\r`, 'ascii'), MCP_PORT, target);
  send('Push 0 0 1');
  send('Push 1 100 0');
  // The cyclic push carries no identity, and a single config reply can be lost
  // or overtaken by the cyclic subscription that follows it. `Config` is a
  // generation counter, so ask again while a receiver's name is still unknown
  // and whenever its generation moves -- which is also how a change made on the
  // front panel reaches the panel.
  const keepalive = setInterval(() => {
    send('Push 1 100 0');
    for (const [addr, st] of states) {
      if (st.lastSeen && (st.name === undefined || st.config !== st.configSeen)) {
        st.configSeen = st.config;
        sendOne('Push 0 0 1', addr);
      }
    }
  }, 1000);

  console.log(`bound udp/${MCP_PORT}; subscribed to ${targets.length} receiver(s) for ${seconds} s\n`);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  clearInterval(keepalive);
  socket.close();

  console.log(`\n${datagrams} datagram(s) received\n`);
  for (const [addr, s] of states) {
    if (!s.lastSeen) { console.log(`${addr.padEnd(15)} SILENT — no reply on udp/${MCP_PORT}`); continue; }
    console.log(renderState(addr, s));
  }
  if (!datagrams) {
    console.log('\nNothing answered. Check in this order:');
    console.log('  1. Is the host on the same IP subnet as the receivers, or routed to it?');
    console.log('     Discovery finding a receiver does NOT mean it is routable.');
    console.log('  2. Is udp/53212 reaching them (no firewall, no VLAN boundary)?');
    console.log('  3. Is the receiver firmware 1.7.0 or later? Media Control Protocol is not in earlier builds.');
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------- cli

// Guarded so the file can be imported by a test without the CLI running.
const isMain = /probe\.mjs$/.test(String(process.argv[1] ?? '').replace(/\\/g, '/'));
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
  const flag = (name) => argv.includes(`--${name}`);
  const valued = new Set(['--seconds', '--iface']);
  const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1]));
  const [command, ...rest] = positional;
  const seconds = Number(opt('seconds', command === 'discover' ? 6 : 10));

  if (!['discover', 'read'].includes(command) || (command === 'read' && !rest.length)) {
    console.error('Usage: probe.mjs discover [--iface <ip>] [--seconds N]');
    console.error('       probe.mjs read <ip> [<ip> ...] [--seconds N] [--raw]');
    process.exit(2);
  }

  try {
    if (command === 'discover') await cmdDiscover({ seconds, iface: opt('iface') });
    else await cmdRead(rest, { seconds, raw: flag('raw') });
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exitCode = 1;
  }
}
