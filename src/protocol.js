/**
 * protocol.js — Sennheiser Media Control Protocol, receiver side.
 *
 * The wire format is not publicly documented: Sennheiser's own notes for it
 * (TI 1254, AN 1260) are not downloadable. The field order was learnt by
 * reading a working implementation (s0600204/senn_rx_monitor) and then
 * **measured against four EM 500 G3** on 07/09/2026. No code was taken from it.
 * The measurement corrected the reference on three points, each of which would
 * have been a silent error in this module:
 *
 *   - RF1, RF2, AF and Frequency carry more fields than the reference reads.
 *   - `RF` is not a bare marker; it carries three values.
 *   - A receiver prefixes its reply with the command it is answering, and that
 *     echo starts with an uppercase letter like any real record.
 *
 * Full notes: docs/PROTOCOL.md. The command-line probe in tools/probe.mjs uses
 * this same decoder, so what it prints is what the module sees.
 */

import { createSocket } from 'node:dgram';

/**
 * Both directions use the same port. The receiver answers *to* 53212 rather
 * than to the sender's ephemeral port, so a client must bind it — and only one
 * process per host can. That single fact is why this module is one connection
 * serving every receiver, keyed by source address, instead of one connection
 * per receiver fighting over the port.
 */
export const MCP_PORT = 53212;

/** Battery is a four-step gauge reported as a string, not a percentage. */
export const BATTERY_STEPS = { '100': 3, '70': 2, '30': 1, '0': 0 };

/**
 * `?` means the receiver has no battery reading — usually because the
 * transmitter is switched off. It is emphatically not "flat", and must never
 * be drawn like it: an operator glancing at an empty gauge changes a good
 * battery in the middle of a programme.
 */
export const BATTERY_UNKNOWN = '?';

/** RF arrives as 0-100; the receiver's own scale is 0-40 dBuV. */
export const rfToDbuv = (v) => (v * 40) / 100;

/**
 * AF arrives as a "percentage" where 0% is -50 dB and 100% is peak, and over
 * 100 is possible. Sennheiser publish no formula, only these fixed points, so
 * this is a piecewise-linear interpolation between them and nothing more is
 * claimed for it.
 */
const AF_POINTS = [[5, -50], [10, -40], [15, -30], [25, -20], [45, -10], [85, 0]];

export function afToDb(value) {
  for (let i = 0; i < AF_POINTS.length; i++) {
    const [inAt, outAt] = AF_POINTS[i];
    if (value === inAt) return outAt;
    if (value < inAt) {
      if (i === 0) return outAt;
      const [prevIn, prevOut] = AF_POINTS[i - 1];
      return outAt + (value - inAt) * ((outAt - prevOut) / (inAt - prevIn));
    }
  }
  return 0;
}

/** A receiver's decoded state. `undefined` means "not reported yet", which is
 *  deliberately distinct from a reported zero — the difference matters most for
 *  battery and RF, where zero is a real and alarming value. */
export function emptyState() {
  return {
    online: false, lastSeen: 0,
    name: undefined, frequency: undefined, squelch: undefined,
    rf1: undefined, rf1Peak: undefined, rf1Active: undefined,
    rf2: undefined, rf2Peak: undefined, rf2Active: undefined,
    af: undefined, afPeak: undefined,
    battery: undefined, mute: undefined, afOut: undefined, equalizer: undefined,
    messages: [], config: undefined, configSeen: undefined, states: undefined,
    rfSummary: undefined, frequencyExtra: undefined, afExtra: undefined,
  };
}

/**
 * Decode one datagram into `state`. Records are CR-separated; each is a
 * whitespace-separated key and arguments. Unknown keys are returned rather
 * than dropped, so an undocumented field surfaces in the log instead of
 * vanishing — the whole point of having measured this rather than assumed it.
 *
 * @returns {string[]} records this decoder does not understand
 */
export function parseDatagram(buffer, state) {
  const unknown = [];
  for (const record of buffer.toString('ascii').split('\r')) {
    const parts = record.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    const [key, ...args] = parts;
    switch (key) {
      // The command echo. It looks exactly like a real record, so it has to be
      // dropped by name; a first-byte test lets it straight through.
      case 'Push': break;
      case 'Name': state.name = args.join(' '); break;
      // Measured as three fields, e.g. "Frequency 572400 21 1": kHz, then two
      // whose meaning is unconfirmed (bank and channel, on the evidence). Only
      // the first is claimed; the rest is kept for anyone who can confirm it.
      case 'Frequency': state.frequency = Number(args[0]); state.frequencyExtra = args.slice(1); break;
      case 'Squelch': state.squelch = Number(args[0]); break;
      // Third field was 1 on the antenna carrying signal and 0 on the other in
      // every sample taken. Read as "this antenna is active"; inferred from
      // behaviour, not documented.
      case 'RF1': state.rf1 = Number(args[0]); state.rf1Peak = Number(args[1]); state.rf1Active = args[2] === '1'; break;
      case 'RF2': state.rf2 = Number(args[0]); state.rf2Peak = Number(args[1]); state.rf2Active = args[2] === '1'; break;
      case 'AF': state.af = Number(args[0]); state.afPeak = Number(args[1]); state.afExtra = args.slice(2); break;
      case 'Bat': state.battery = args[0]; break;
      case 'Msg': state.messages = args; break;
      case 'Config': state.config = args[0]; break;
      case 'RF': state.rfSummary = args; break;
      case 'States': state.states = args; break;
      case 'AfOut': state.afOut = Number(args[0]); break;
      case 'Equalizer': state.equalizer = args[0]; break;
      case 'Mute': state.mute = args[0] === '1'; break;
      default: unknown.push(record.trim());
    }
  }
  state.lastSeen = Date.now();
  state.online = true;
  return unknown;
}

/**
 * One UDP socket serving every receiver.
 *
 * Liveness is cadence, not socket state: UDP gives no connection to lose, so a
 * receiver counts as online only while datagrams keep arriving. Anything else
 * would be the `panasonic-ptz` mistake of reading a transport for a device.
 */
export class McpClient {
  #socket = null;
  #keepalive = null;
  #staleTimer = null;

  /**
   * @param {object} opts
   * @param {string[]} opts.targets receiver addresses
   * @param {number} opts.updateRateMs cyclic push rate the receiver should use
   * @param {number} opts.staleMs silence after which a receiver is declared offline
   * @param {(addr: string, state: object) => void} opts.onUpdate
   * @param {(addr: string, online: boolean) => void} opts.onPresence
   * @param {(level: 'debug'|'info'|'warn'|'error', message: string) => void} opts.onLog
   */
  constructor({ targets, updateRateMs, staleMs, onUpdate, onPresence, onLog }) {
    this.targets = targets;
    this.updateRateMs = updateRateMs;
    this.staleMs = staleMs;
    this.onUpdate = onUpdate;
    this.onPresence = onPresence;
    this.onLog = onLog;
    /** @type {Map<string, ReturnType<typeof emptyState>>} */
    this.states = new Map(targets.map((t) => [t, emptyState()]));
    this.unknownSeen = new Set();
  }

  async open() {
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    this.#socket = socket;

    socket.on('message', (msg, rinfo) => this.#receive(msg, rinfo));
    socket.on('error', (err) => {
      // Fail loud. EADDRINUSE here means something else on this host holds the
      // one port the receivers will answer to, and no amount of retrying fixes
      // it — the operator has to be told which, not left with a dead panel.
      this.onLog('error', err.code === 'EADDRINUSE'
        ? `udp/${MCP_PORT} is already in use on this machine. The receivers answer to that exact port and only one process may hold it — stop whatever has it, then restart this connection.`
        : `socket error: ${err.message}`);
    });

    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(MCP_PORT, () => resolve());
    });

    this.#requestConfig();
    this.#subscribe();
    this.#keepalive = setInterval(() => this.#tick(), 1000);
    this.#staleTimer = setInterval(() => this.#checkStale(), 1000);
    this.onLog('info', `listening on udp/${MCP_PORT} for ${this.targets.length} receiver(s): ${this.targets.join(', ')}`);
  }

  close() {
    clearInterval(this.#keepalive); this.#keepalive = null;
    clearInterval(this.#staleTimer); this.#staleTimer = null;
    try { this.#socket?.close(); } catch { /* already closed */ }
    this.#socket = null;
  }

  /** Send a verbatim command to one receiver, CR-terminated. */
  send(addr, command) {
    if (!this.#socket) return;
    this.#socket.send(Buffer.from(`${command}\r`, 'ascii'), MCP_PORT, addr, (err) => {
      if (err) this.onLog('warn', `send to ${addr} failed: ${err.message}`);
    });
  }

  #subscribe() { for (const t of this.targets) this.send(t, `Push 1 ${this.updateRateMs} 0`); }
  #requestConfig() { for (const t of this.targets) this.send(t, 'Push 0 0 1'); }

  #tick() {
    this.#subscribe();
    // `Config` is a generation counter. Ask again while a receiver's identity is
    // still unknown and whenever the generation moves — that is the only way a
    // frequency changed on the front panel ever reaches the panel, and a single
    // config reply can be lost or overtaken by the cyclic subscription behind it.
    for (const [addr, s] of this.states) {
      if (!s.online) continue;
      if (s.name === undefined || s.config !== s.configSeen) {
        s.configSeen = s.config;
        this.send(addr, 'Push 0 0 1');
      }
    }
  }

  #checkStale() {
    const now = Date.now();
    for (const [addr, s] of this.states) {
      if (s.online && now - s.lastSeen > this.staleMs) {
        s.online = false;
        this.onLog('warn', `receiver ${addr} has gone quiet — no datagram for ${Math.round(this.staleMs / 1000)} s`);
        this.onPresence(addr, false);
      }
    }
  }

  #receive(msg, rinfo) {
    const state = this.states.get(rinfo.address);
    // A device record always begins with an uppercase ASCII letter. Anything
    // else, or anything from an address we did not ask about, is not ours.
    if (!state || msg.length === 0 || msg[0] < 0x41 || msg[0] > 0x5a) return;
    const wasOnline = state.online;
    for (const record of parseDatagram(msg, state)) {
      if (this.unknownSeen.has(record)) continue;
      this.unknownSeen.add(record);
      this.onLog('debug', `unhandled record from ${rinfo.address}: ${record}`);
    }
    if (!wasOnline) {
      this.onLog('info', `receiver ${rinfo.address} is answering`);
      this.onPresence(rinfo.address, true);
    }
    this.onUpdate(rinfo.address, state);
  }
}
