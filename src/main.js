/**
 * main.js — Sennheiser evolution wireless G3/G4 receiver monitoring for
 * Bitfocus Companion 5.
 *
 * One connection serves every receiver. That is forced by the protocol, not a
 * design preference: the receivers answer *to* UDP 53212 rather than to the
 * sender's port, and only one process per host may bind it.
 *
 * Everything the panel shows is read from the wire. Nothing is inferred, and
 * "not reported" is carried through to the face as `—` rather than being
 * flattened into a zero — a radio-mic display whose failure mode is a
 * confident wrong number is worse than no display at all.
 */

import { InstanceBase, InstanceStatus, Regex } from '@companion-module/base';
import { McpClient, MCP_PORT, BATTERY_UNKNOWN, afToDb, rfToDbuv } from './protocol.js';
import { PALETTE } from './palette.js';
import { buildPresets } from './presets.js';

/** Four-step gauge, worst first. Used for ordering and for "at or below" tests. */
const BATTERY_ORDER = ['0', '30', '70', '100'];
const BATTERY_TEXT = { '100': 'FULL', '70': 'GOOD', '30': 'LOW', '0': 'EMPTY' };
/** Nominal percentages purely for a meter width; the device does not report these. */
const BATTERY_PCT = { '100': 100, '70': 70, '30': 30, '0': 0 };

const csv = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const dash = (v, digits) => (v === undefined || Number.isNaN(v) ? '—' : (digits === undefined ? String(v) : v.toFixed(digits)));
// Publishing (0.1.8, 02/11/2026). At most one publish per MIN_PUBLISH_MS, and only the values that changed: a
// meter that moved less than its band is not sent, because the face would not change visibly. Measured that
// night: the module sent all ~75 values and re-checked every feedback ten times a second, the busiest source on
// Companion's variable bus. Meters now move up to five times a second, and a quiet rack sends nothing at all.
const MIN_PUBLISH_MS = 200;
const FULL_EVERY_MS = 10000;
const METER_BAND = { rf_a: 2, rf_b: 2, rf_a_dbuv: 1, rf_b_dbuv: 1, af: 2, af_db: 1 };

// API v2 has no runEntrypoint: the host imports the default export and the
// upgrade scripts as a named one, then drives the lifecycle itself.
//
// Companion 5.0.5 validates against its own host contract regardless of which
// @companion-module/base a module bundles -- pinning an older base does not opt
// out of it. Measured the hard way: variable definitions must be an OBJECT keyed
// by id, presets carry `type: 'simple'` with no `category`, and
// setPresetDefinitions takes the section structure as its FIRST argument. A
// preset with the wrong type is dropped in silence and every structure
// reference to it dangles, which reads on screen as sections that list but hold
// no buttons.
export default class SennheiserEwInstance extends InstanceBase {
	/** Definitions registered and init returned; only then may feedbacks be checked. */
	#ready = false;
	/** Ids to re-check; a bare checkFeedbacks() errors when nothing is subscribed. */
	#feedbackIds = [];
	#client = null;
	/** @type {string[]} receiver addresses, index 0 = receiver 1 */
	#targets = [];
	#labels = [];
	/** Coalesced publishing: when the last publish went out (ms) and the pending trailing one. */
	#publishedAt = 0;
	#publishTimer = null;
	/** What Companion holds: the last value sent per variable, and the last status. */
	#sent = new Map();
	#status = '';
	/** When every value was last sent whole (see FULL_EVERY_MS). */
	#fullAt = 0;

	async init(config) {
		this.config = config ?? {};
		await this.#start();
	}

	async configUpdated(config) {
		this.config = config ?? {};
		await this.#stop();
		await this.#start();
	}

	async destroy() {
		await this.#stop();
	}

	// ------------------------------------------------------------------ lifecycle

	async #start() {
		this.#ready = false;
		this.#targets = csv(this.config.receivers);
		this.#labels = csv(this.config.labels);

		if (!this.#targets.length) {
			this.updateStatus(InstanceStatus.BadConfig, 'No receiver addresses');
			this.#publishDefinitions();
			return;
		}

		this.updateStatus(InstanceStatus.Connecting, `binding udp/${MCP_PORT}`);
		this.#publishDefinitions();

		this.#client = new McpClient({
			targets: this.#targets,
			updateRateMs: Number(this.config.updateRate) || 100,
			staleMs: (Number(this.config.staleSeconds) || 3) * 1000,
			onUpdate: () => this.#schedulePublish(),
			onPresence: () => this.#publishState(),
			onLog: (level, message) => this.log(level, message),
		});

		try {
			await this.#client.open();
			// The socket being bound proves nothing about any receiver, so the
			// connection only claims Ok once one has actually answered. Until then
			// it is honestly still connecting.
			this.updateStatus(InstanceStatus.Connecting, 'waiting for a receiver to answer');
			// Only now. The first datagrams arrive while open() is still running,
			// and checkFeedbacks() before the host holds the definitions errors
			// once per datagram instead of doing anything.
			this.#ready = true;
			this.#publishState();
		} catch (err) {
			this.#client = null;
			this.updateStatus(InstanceStatus.ConnectionFailure, err.message);
			this.log('error', `could not bind udp/${MCP_PORT}: ${err.message}`);
		}
	}

	async #stop() {
		clearTimeout(this.#publishTimer);
		this.#publishTimer = null;
		this.#sent.clear();
		this.#status = '';
		this.#fullAt = 0;
		this.#client?.close();
		this.#client = null;
	}

	// Every receiver pushes on its own cycle (Push 1 <rate>), so four receivers at 100 ms meant up to forty publishes a
	// second, and Companion walks its whole panel on each one (measured 21/10/2026 on 5.0.7: every variable batch visits
	// every control, every internal entity and every module). One publish per update period carries the latest value of
	// every receiver, at the same rate a single receiver updates: the meters move as often as before, the panel pays once.
	// The first update after a quiet period goes out at once; presence changes (onPresence) are never delayed.
	#schedulePublish() {
		if (this.#publishTimer) return;
		const period = Math.max(Number(this.config.updateRate) || 100, MIN_PUBLISH_MS);
		const wait = Math.max(0, this.#publishedAt + period - Date.now());
		if (wait === 0) { this.#publishState(); return; }
		this.#publishTimer = setTimeout(() => { this.#publishTimer = null; this.#publishState(); }, wait);
	}

	// ------------------------------------------------------------------ config

	getConfigFields() {
		return [
			{
				type: 'static-text', id: 'info', width: 12, label: 'One connection, every receiver',
				value: `The receivers answer <b>to UDP ${MCP_PORT}</b> rather than to the port a request came from, so this module binds that port and serves all of them from here. Only one process per machine may hold it — do not add a second connection for a second receiver.<br><br>Requires receiver firmware <b>1.7.0 or later</b>. Give the receivers fixed addresses: a DHCP lease that moves leaves them answering discovery while this module reads nothing.`,
			},
			{
				type: 'textinput', id: 'receivers', label: 'Receivers (comma-separated addresses, in order)', width: 12,
				default: '', tooltip: 'The first address is receiver 1, and that is what every variable, feedback and preset refers to.',
			},
			{
				type: 'textinput', id: 'labels', label: 'Labels (optional, same order)', width: 12,
				default: '', tooltip: 'Friendly names for the buttons, e.g. PRESENTER, GUEST 1. Falls back to the receiver’s own name, then its address.',
			},
			{
				type: 'number', id: 'updateRate', label: 'Update rate (ms)', width: 6,
				default: 100, min: 20, max: 1000,
				tooltip: 'How often the receiver should push telemetry. 100 ms is the reference implementation’s value and is comfortable for four receivers.',
			},
			{
				type: 'number', id: 'staleSeconds', label: 'Offline after (s)', width: 6,
				default: 3, min: 1, max: 60,
				tooltip: 'UDP has no connection to lose, so a receiver counts as present only while datagrams keep arriving. This is how long the silence must last before it is called offline.',
			},
		];
	}

	// ------------------------------------------------------------------ state

	/** Receiver state by 1-based index, or a blank state if not configured. */
	#rx(n) {
		const addr = this.#targets[n - 1];
		return this.#client?.states.get(addr);
	}

	/** What to put on a face: the operator's label, else the device's own name, else the address. */
	#label(n) {
		return this.#labels[n - 1] || this.#rx(n)?.name || this.#targets[n - 1] || `RX ${n}`;
	}

	#publishDefinitions() {
		const defs = {};
		for (let n = 1; n <= this.#targets.length; n++) {
			const p = `rx${n}`;
			Object.assign(defs, {
				[`${p}_label`]: { name: `Receiver ${n}: label` },
				[`${p}_address`]: { name: `Receiver ${n}: address` },
				[`${p}_name`]: { name: `Receiver ${n}: name reported by the device` },
				[`${p}_online`]: { name: `Receiver ${n}: answering (1/0)` },
				[`${p}_frequency`]: { name: `Receiver ${n}: frequency (MHz)` },
				[`${p}_battery`]: { name: `Receiver ${n}: battery step (100/70/30/0/?)` },
				[`${p}_battery_text`]: { name: `Receiver ${n}: battery as a word` },
				[`${p}_battery_pct`]: { name: `Receiver ${n}: battery as a nominal percentage` },
				[`${p}_rf_a`]: { name: `Receiver ${n}: RF antenna A (0-100)` },
				[`${p}_rf_b`]: { name: `Receiver ${n}: RF antenna B (0-100)` },
				[`${p}_rf_a_dbuv`]: { name: `Receiver ${n}: RF antenna A (dBuV)` },
				[`${p}_rf_b_dbuv`]: { name: `Receiver ${n}: RF antenna B (dBuV)` },
				[`${p}_antenna`]: { name: `Receiver ${n}: antenna carrying signal (A/B/—)` },
				[`${p}_af`]: { name: `Receiver ${n}: AF level (0-100)` },
				[`${p}_af_db`]: { name: `Receiver ${n}: AF level (dB)` },
				[`${p}_squelch`]: { name: `Receiver ${n}: squelch` },
				[`${p}_mute`]: { name: `Receiver ${n}: muted (1/0)` },
				[`${p}_warnings`]: { name: `Receiver ${n}: warnings reported by the device` },
			});
		}
		Object.assign(defs, {
			['receivers_total']: { name: 'Receivers configured' },
			['receivers_online']: { name: 'Receivers answering' },
			['receivers_offline']: { name: 'Receivers silent' },
			['lowest_battery']: { name: 'Worst battery across the rack' },
			['lowest_battery_label']: { name: 'Which receiver holds the worst battery' },
			['low_battery_count']: { name: 'Receivers at or below LOW' },
			['warning_count']: { name: 'Receivers reporting a warning' },
			['rack_summary']: { name: 'Rack summary, e.g. 4/4 · LOW on GUEST 1' },
		});
		const feedbacks = this.#feedbacks();
		this.#feedbackIds = Object.keys(feedbacks);
		const actions = this.#actions();
		// Presets name variables by the connection's label, so they are rebuilt on
		// every configUpdated -- which is also when Companion applies a rename.
		const { structure, presets } = buildPresets(
			this.#targets.map((_, i) => ({ n: i + 1, label: this.#label(i + 1) })), this.label);
		this.setVariableDefinitions(defs);
		this.setFeedbackDefinitions(feedbacks);
		this.setActionDefinitions(actions);
		this.setPresetDefinitions(structure, presets);
		// Say what went out. An empty presets panel or a missing variable namespace
		// is otherwise indistinguishable from a module that never tried, and that
		// ambiguity cost an evening.
		this.log('info', `registered ${Object.keys(defs).length} variables, ${Object.keys(feedbacks).length} feedbacks, ${Object.keys(actions).length} actions, ${Object.keys(presets).length} presets in ${structure.length} sections`);
	}

	#publishState() {
		this.#publishedAt = Date.now();
		const values = {};
		let online = 0, lowCount = 0, warnCount = 0;
		let worst = null, worstLabel = '—';

		for (let n = 1; n <= this.#targets.length; n++) {
			const s = this.#rx(n) ?? {};
			const p = `rx${n}`;
			const up = s.online === true;
			if (up) online++;

			const bat = up ? (s.battery ?? BATTERY_UNKNOWN) : BATTERY_UNKNOWN;
			if (up && bat !== BATTERY_UNKNOWN && BATTERY_ORDER.indexOf(bat) <= BATTERY_ORDER.indexOf('30')) lowCount++;
			if (up && (s.messages?.length ?? 0) > 0) warnCount++;
			if (up && bat !== BATTERY_UNKNOWN && (worst === null || BATTERY_ORDER.indexOf(bat) < BATTERY_ORDER.indexOf(worst))) {
				worst = bat; worstLabel = this.#label(n);
			}

			values[`${p}_label`] = this.#label(n);
			values[`${p}_address`] = this.#targets[n - 1];
			values[`${p}_name`] = s.name ?? '—';
			values[`${p}_online`] = up ? 1 : 0;
			// The device reports kHz; broadcast usage is MHz to three decimals.
			values[`${p}_frequency`] = up && s.frequency !== undefined ? (s.frequency / 1000).toFixed(3) : '—';
			values[`${p}_battery`] = bat;
			values[`${p}_battery_text`] = BATTERY_TEXT[bat] ?? 'NO BATT';
			values[`${p}_battery_pct`] = BATTERY_PCT[bat] ?? 0;
			values[`${p}_rf_a`] = up ? dash(s.rf1) : '—';
			values[`${p}_rf_b`] = up ? dash(s.rf2) : '—';
			values[`${p}_rf_a_dbuv`] = up && s.rf1 !== undefined ? dash(rfToDbuv(s.rf1), 1) : '—';
			values[`${p}_rf_b_dbuv`] = up && s.rf2 !== undefined ? dash(rfToDbuv(s.rf2), 1) : '—';
			values[`${p}_antenna`] = up ? (s.rf1Active ? 'A' : s.rf2Active ? 'B' : '—') : '—';
			values[`${p}_af`] = up ? dash(s.af) : '—';
			values[`${p}_af_db`] = up && s.af !== undefined ? dash(afToDb(s.af), 1) : '—';
			values[`${p}_squelch`] = up ? dash(s.squelch) : '—';
			values[`${p}_mute`] = s.mute === true ? 1 : 0;
			values[`${p}_warnings`] = up && s.messages?.length ? s.messages.join(' ') : '—';
		}

		values.receivers_total = this.#targets.length;
		values.receivers_online = online;
		values.receivers_offline = this.#targets.length - online;
		values.lowest_battery = worst ?? '—';
		values.lowest_battery_label = worstLabel;
		values.low_battery_count = lowCount;
		values.warning_count = warnCount;
		values.rack_summary = `${online}/${this.#targets.length}`
			+ (worst !== null && BATTERY_ORDER.indexOf(worst) <= BATTERY_ORDER.indexOf('30') ? ` · ${BATTERY_TEXT[worst]} on ${worstLabel}` : '');

		// Every FULL_EVERY_MS the whole set goes out: a value Companion dropped (one sent before it held the definitions,
		// seen 02/11/2026 right after an import) is otherwise never sent again, since it never changes.
		const full = Date.now() - this.#fullAt >= FULL_EVERY_MS;
		if (full) { this.#fullAt = Date.now(); this.#sent.clear(); }
		const changed = {};
		for (const [k, v] of Object.entries(values)) {
			const last = this.#sent.get(k);
			if (last === v) continue;
			const band = METER_BAND[k.replace(/^rx\d+_/u, '')];
			if (band && last !== undefined && Number.isFinite(Number(v)) && Number.isFinite(Number(last)) && Math.abs(Number(v) - Number(last)) < band) continue;
			changed[k] = v;
			this.#sent.set(k, v);
		}
		if (Object.keys(changed).length) {
			this.setVariableValues(changed);
		// Named rather than bare: checkFeedbacks() with no arguments throws while
		// no button subscribes to any of them, which is the normal state until
		// somebody drags a preset onto a page.
			if (this.#ready && this.#feedbackIds.length) this.checkFeedbacks(...this.#feedbackIds);
		}

		// Status follows what the rack is doing, not what the socket is doing.
		const [st, msg] = online === 0 ? [InstanceStatus.ConnectionFailure, 'no receiver is answering']
			: online < this.#targets.length ? [InstanceStatus.UnknownWarning, `${online}/${this.#targets.length} answering`] : [InstanceStatus.Ok, `${online}/${this.#targets.length}`];
		if (`${st}|${msg}` !== this.#status) { this.#status = `${st}|${msg}`; this.updateStatus(st, msg); }
	}

	// ------------------------------------------------------------------ feedbacks

	#rxChoices() {
		return this.#targets.map((addr, i) => ({ id: String(i + 1), label: `${i + 1} · ${this.#label(i + 1)} (${addr})` }));
	}

	#rxOption() {
		return { type: 'dropdown', id: 'rx', label: 'Receiver', default: '1', choices: this.#rxChoices().length ? this.#rxChoices() : [{ id: '1', label: 'Receiver 1' }] };
	}

	#feedbacks() {
		const batteryChoices = [
			{ id: '100', label: 'FULL' }, { id: '70', label: 'GOOD or worse' },
			{ id: '30', label: 'LOW or worse' }, { id: '0', label: 'EMPTY' },
		];
		return {
			battery_at_or_below: {
				type: 'boolean', name: 'Battery at or below a level',
				description: 'True while this receiver reports the chosen step or a worse one. An unknown battery is never true here — it has its own feedback.',
				defaultStyle: { bgcolor: PALETTE.amber, color: PALETTE.black },
				options: [this.#rxOption(), { type: 'dropdown', id: 'level', label: 'At or below', default: '30', choices: batteryChoices }],
				callback: (fb) => {
					const s = this.#rx(Number(fb.options.rx));
					const bat = s?.online ? s.battery : undefined;
					if (!bat || bat === BATTERY_UNKNOWN) return false;
					return BATTERY_ORDER.indexOf(bat) <= BATTERY_ORDER.indexOf(String(fb.options.level));
				},
			},
			battery_unknown: {
				type: 'boolean', name: 'Battery reading unavailable',
				description: 'True while the receiver reports "?" — normally because the transmitter is switched off. This is not a flat battery and should not be coloured like one.',
				defaultStyle: { bgcolor: PALETTE.dim, color: PALETTE.grey },
				options: [this.#rxOption()],
				callback: (fb) => {
					const s = this.#rx(Number(fb.options.rx));
					return !s?.online || s.battery === undefined || s.battery === BATTERY_UNKNOWN;
				},
			},
			offline: {
				type: 'boolean', name: 'Receiver silent',
				description: 'True while no datagram has arrived within the configured window. UDP has no connection to lose, so silence is the only evidence of absence.',
				defaultStyle: { bgcolor: PALETTE.deepRed, color: PALETTE.white },
				options: [this.#rxOption()],
				callback: (fb) => this.#rx(Number(fb.options.rx))?.online !== true,
			},
			rf_below: {
				type: 'boolean', name: 'RF below a threshold',
				description: 'True while the carrying antenna is below the threshold. Reads the active antenna, so normal diversity switching does not trip it.',
				defaultStyle: { bgcolor: PALETTE.amber, color: PALETTE.black },
				options: [this.#rxOption(), { type: 'number', id: 'threshold', label: 'Below (0-100)', default: 20, min: 0, max: 100 }],
				callback: (fb) => {
					const s = this.#rx(Number(fb.options.rx));
					if (!s?.online) return false;
					const best = Math.max(s.rf1 ?? 0, s.rf2 ?? 0);
					return best < Number(fb.options.threshold);
				},
			},
			af_peak: {
				type: 'boolean', name: 'AF peaking',
				description: 'True while the receiver reports AF at or above the threshold, or raises AF_Peak itself.',
				defaultStyle: { bgcolor: PALETTE.red, color: PALETTE.white },
				options: [this.#rxOption(), { type: 'number', id: 'threshold', label: 'At or above (0-100)', default: 85, min: 0, max: 150 }],
				callback: (fb) => {
					const s = this.#rx(Number(fb.options.rx));
					if (!s?.online) return false;
					return (s.af ?? 0) >= Number(fb.options.threshold) || (s.messages ?? []).includes('AF_Peak');
				},
			},
			muted: {
				type: 'boolean', name: 'Receiver muted',
				description: 'True while the receiver reports its output muted, or raises RF_Mute.',
				defaultStyle: { bgcolor: PALETTE.red, color: PALETTE.white },
				options: [this.#rxOption()],
				callback: (fb) => {
					const s = this.#rx(Number(fb.options.rx));
					if (!s?.online) return false;
					return s.mute === true || (s.messages ?? []).includes('RF_Mute');
				},
			},
			has_warning: {
				type: 'boolean', name: 'Receiver reports a warning',
				description: 'True while the receiver sends any Msg, or only the one named.',
				defaultStyle: { bgcolor: PALETTE.amber, color: PALETTE.black },
				options: [this.#rxOption(), { type: 'textinput', id: 'match', label: 'Only this warning (blank = any)', default: '' }],
				callback: (fb) => {
					const s = this.#rx(Number(fb.options.rx));
					if (!s?.online) return false;
					const msgs = s.messages ?? [];
					const want = String(fb.options.match ?? '').trim();
					return want ? msgs.includes(want) : msgs.length > 0;
				},
			},
			antenna_active: {
				type: 'boolean', name: 'Antenna carrying signal',
				description: 'True while the chosen antenna is the one flagged as carrying. Diversity behaviour, not a fault indicator.',
				defaultStyle: { bgcolor: PALETTE.violet, color: PALETTE.white },
				options: [this.#rxOption(), { type: 'dropdown', id: 'antenna', label: 'Antenna', default: 'A', choices: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }] }],
				callback: (fb) => {
					const s = this.#rx(Number(fb.options.rx));
					if (!s?.online) return false;
					return fb.options.antenna === 'A' ? s.rf1Active === true : s.rf2Active === true;
				},
			},
			any_offline: {
				type: 'boolean', name: 'Any receiver silent',
				description: 'Rack-wide. True while at least one configured receiver is not answering.',
				defaultStyle: { bgcolor: PALETTE.deepRed, color: PALETTE.white },
				options: [],
				callback: () => this.#targets.some((_, i) => this.#rx(i + 1)?.online !== true),
			},
			any_battery_at_or_below: {
				type: 'boolean', name: 'Any battery at or below a level',
				description: 'Rack-wide. Unknown batteries are ignored, so a rack of switched-off transmitters does not shout.',
				defaultStyle: { bgcolor: PALETTE.amber, color: PALETTE.black },
				options: [{ type: 'dropdown', id: 'level', label: 'At or below', default: '30', choices: batteryChoices }],
				callback: (fb) => this.#targets.some((_, i) => {
					const s = this.#rx(i + 1);
					if (!s?.online || !s.battery || s.battery === BATTERY_UNKNOWN) return false;
					return BATTERY_ORDER.indexOf(s.battery) <= BATTERY_ORDER.indexOf(String(fb.options.level));
				}),
			},
			any_warning: {
				type: 'boolean', name: 'Any receiver reports a warning',
				description: 'Rack-wide. True while any answering receiver sends a Msg.',
				defaultStyle: { bgcolor: PALETTE.amber, color: PALETTE.black },
				options: [],
				callback: () => this.#targets.some((_, i) => (this.#rx(i + 1)?.online === true) && (this.#rx(i + 1)?.messages?.length ?? 0) > 0),
			},
		};
	}

	// ------------------------------------------------------------------ actions

	#actions() {
		const addrOf = (rx) => this.#targets[Number(rx) - 1];
		return {
			rename: {
				name: 'Set receiver name',
				description: 'Writes the name shown on the receiver’s own display. The only write this protocol is documented to accept.',
				options: [this.#rxOption(), { type: 'textinput', id: 'name', label: 'Name', default: '', useVariables: true }],
				callback: async (act) => {
					const addr = addrOf(act.options.rx);
					if (!addr) return;
					const name = await this.parseVariablesInString(String(act.options.name ?? ''));
					this.#client?.send(addr, `Name ${name}`);
				},
			},
			refresh_config: {
				name: 'Re-read configuration',
				description: 'Asks the receiver to resend name, frequency, squelch and mute. Sent automatically when the device’s own config counter moves, so this is only for forcing it.',
				options: [{ type: 'dropdown', id: 'rx', label: 'Receiver', default: 'all', choices: [{ id: 'all', label: 'All receivers' }, ...this.#rxChoices()] }],
				callback: (act) => {
					const targets = act.options.rx === 'all' ? this.#targets : [addrOf(act.options.rx)];
					for (const addr of targets) if (addr) this.#client?.send(addr, 'Push 0 0 1');
				},
			},
			raw_command: {
				name: 'Send a raw command (advanced)',
				description: 'Sends the text verbatim, CR-terminated. The protocol is not publicly documented, so anything beyond Name and Push is unverified — expect no reply rather than an error.',
				options: [this.#rxOption(), { type: 'textinput', id: 'command', label: 'Command', default: '', useVariables: true, regex: Regex.SOMETHING }],
				callback: async (act) => {
					const addr = addrOf(act.options.rx);
					if (!addr) return;
					const cmd = await this.parseVariablesInString(String(act.options.command ?? ''));
					if (!cmd.trim()) return;
					this.log('debug', `raw command to ${addr}: ${cmd}`);
					this.#client?.send(addr, cmd.trim());
				},
			},
		};
	}
}

/** No upgrade scripts yet; the export must exist for the host to import. */
export const upgradeScripts = [];
