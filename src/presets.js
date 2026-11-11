/**
 * presets.js — drag-and-drop button faces, fully baked.
 *
 * The ForeWire discipline throughout: ids are complete so nothing needs typing
 * after a drag, categories follow the operator's journey rather than the
 * protocol's shape, and **feedback order is priority order** — Companion lets a
 * later entry override an earlier one, so the most urgent state is listed LAST
 * and wins. That ordering is stated here rather than left to accident, because
 * getting it backwards is invisible until the night it matters.
 *
 * Preset ids embed only the receiver index, which is its position in the
 * configured list and therefore stable. Labels are not in ids: renaming a
 * receiver must never orphan a button somebody already dragged.
 */

import { PALETTE } from './palette.js';

/**
 * Priority ladder, worst last, applied to any face that should turn into an
 * alarm. Silence outranks everything: a receiver that has stopped answering
 * tells you nothing about its battery, so a stale battery colour underneath
 * would be a lie.
 */
const alarmLadder = (rx) => [
	{ feedbackId: 'battery_at_or_below', options: { rx, level: '30' }, style: { bgcolor: PALETTE.amber, color: PALETTE.black } },
	{ feedbackId: 'has_warning', options: { rx, match: '' }, style: { bgcolor: PALETTE.amber, color: PALETTE.black } },
	{ feedbackId: 'af_peak', options: { rx, threshold: 85 }, style: { bgcolor: PALETTE.red, color: PALETTE.white } },
	{ feedbackId: 'battery_at_or_below', options: { rx, level: '0' }, style: { bgcolor: PALETTE.red, color: PALETTE.white } },
	{ feedbackId: 'battery_unknown', options: { rx }, style: { bgcolor: PALETTE.dim, color: PALETTE.grey } },
	{ feedbackId: 'offline', options: { rx }, style: { bgcolor: PALETTE.deepRed, color: PALETTE.white } },
];

/**
 * @param {{ n: number, label: string }[]} receivers
 * @param {string} connection the connection's label: `$(<label>:rx1_battery)`
 *   is the form that works everywhere, in a trigger or a hand-built key as well
 *   as in a dragged preset (Companion rewrites a module-id prefix only there).
 * @returns {{ structure: object[], presets: Record<string, object> }}
 */
export function buildPresets(receivers, connection) {
	const V = (name) => `$(${connection}:${name})`;
	/** @type {Record<string, any>} */
	const presets = {};

	// ── Rack ────────────────────────────────────────────────────────────────
	// What one key tells you from across the gallery: how many are alive, and
	// whether anything needs a battery.
	presets['rack:summary'] = {
		type: 'simple',
		name: 'Rack summary — answering count, and the worst battery when one is low.',
		style: { text: `MICS\\n${V('rack_summary')}`, size: '14', color: PALETTE.white, bgcolor: PALETTE.ink },
		feedbacks: [
			{ feedbackId: 'any_battery_at_or_below', options: { level: '30' }, style: { bgcolor: PALETTE.amber, color: PALETTE.black } },
			{ feedbackId: 'any_battery_at_or_below', options: { level: '0' }, style: { bgcolor: PALETTE.red, color: PALETTE.white } },
			{ feedbackId: 'any_offline', options: {}, style: { bgcolor: PALETTE.deepRed, color: PALETTE.white } },
		],
		steps: [{ down: [{ actionId: 'refresh_config', options: { rx: 'all' } }], up: [] }],
	};

	presets['rack:online'] = {
		type: 'simple',
		name: 'How many receivers are answering, out of how many are configured.',
		style: { text: `ANSWERING\\n${V('receivers_online')} / ${V('receivers_total')}`, size: '14', color: PALETTE.white, bgcolor: PALETTE.ink },
		feedbacks: [{ feedbackId: 'any_offline', options: {}, style: { bgcolor: PALETTE.deepRed, color: PALETTE.white } }],
		steps: [{ down: [], up: [] }],
	};

	presets['rack:worst-battery'] = {
		type: 'simple',
		name: 'The worst battery in the rack and which receiver holds it.',
		style: { text: `WORST\\n${V('lowest_battery_label')}\\n${V('lowest_battery')}`, size: '14', color: PALETTE.white, bgcolor: PALETTE.ink },
		feedbacks: [
			{ feedbackId: 'any_battery_at_or_below', options: { level: '30' }, style: { bgcolor: PALETTE.amber, color: PALETTE.black } },
			{ feedbackId: 'any_battery_at_or_below', options: { level: '0' }, style: { bgcolor: PALETTE.red, color: PALETTE.white } },
		],
		steps: [{ down: [], up: [] }],
	};

	presets['rack:refresh'] = {
		type: 'simple',
		name: 'Force every receiver to resend its name, frequency and squelch.',
		style: { text: 'RE-READ\\nCONFIG', size: '14', color: PALETTE.white, bgcolor: PALETTE.dim },
		feedbacks: [],
		steps: [{ down: [{ actionId: 'refresh_config', options: { rx: 'all' } }], up: [] }],
	};

	// ── Alerts ──────────────────────────────────────────────────────────────
	// Keys whose whole job is to be noticed. Each is dark and quiet until it
	// is not, so a wall of them reads as "nothing to do" at a glance.
	presets['alert:offline'] = {
		type: 'simple',
		name: 'Lights when any receiver stops answering.',
		style: { text: `SILENT\\n${V('receivers_offline')}`, size: '14', color: PALETTE.grey, bgcolor: PALETTE.bg },
		feedbacks: [{ feedbackId: 'any_offline', options: {}, style: { bgcolor: PALETTE.deepRed, color: PALETTE.white } }],
		steps: [{ down: [], up: [] }],
	};

	presets['alert:low-battery'] = {
		type: 'simple',
		name: 'Lights amber at LOW and red at EMPTY, anywhere in the rack. Unknown batteries are ignored.',
		style: { text: `BATTERY\\n${V('low_battery_count')}`, size: '14', color: PALETTE.grey, bgcolor: PALETTE.bg },
		feedbacks: [
			{ feedbackId: 'any_battery_at_or_below', options: { level: '30' }, style: { bgcolor: PALETTE.amber, color: PALETTE.black } },
			{ feedbackId: 'any_battery_at_or_below', options: { level: '0' }, style: { bgcolor: PALETTE.red, color: PALETTE.white } },
		],
		steps: [{ down: [], up: [] }],
	};

	presets['alert:warning'] = {
		type: 'simple',
		name: 'Lights when any receiver raises a warning of its own — RF_Mute, Low_RF_Signal, AF_Peak.',
		style: { text: `WARNINGS\\n${V('warning_count')}`, size: '14', color: PALETTE.grey, bgcolor: PALETTE.bg },
		feedbacks: [{ feedbackId: 'any_warning', options: {}, style: { bgcolor: PALETTE.amber, color: PALETTE.black } }],
		steps: [{ down: [], up: [] }],
	};

	// ── One category per receiver ───────────────────────────────────────────
	// The operator thinks "the presenter's mic", not "receiver 3", so the
	// category carries the label while the ids stay on the index.
	for (const { n, label } of receivers) {
		const rx = String(n);
		const cat = `Receiver ${n} — ${label}`;
		const p = `rx${n}`;

		presets[`rx:${n}:status`] = {
			type: 'simple',
			name: 'Everything at a glance: name, battery, RF. Turns amber on a low battery or a warning, red on empty or peaking, and deep red when it goes silent.',
			style: { text: `${V(`${p}_label`)}\\n${V(`${p}_battery_text`)}\\nRF ${V(`${p}_rf_a_dbuv`)}`, size: '14', color: PALETTE.white, bgcolor: PALETTE.ink },
			feedbacks: alarmLadder(rx),
			steps: [{ down: [], up: [] }],
		};

		presets[`rx:${n}:battery`] = {
			type: 'simple',
			name: 'Battery only. Grey means the receiver has no reading — usually a transmitter that is switched off, never a flat battery.',
			style: { text: `${V(`${p}_label`)}\\nBATT\\n${V(`${p}_battery_text`)}`, size: '14', color: PALETTE.white, bgcolor: PALETTE.ink },
			feedbacks: [
				{ feedbackId: 'battery_at_or_below', options: { rx, level: '100' }, style: { bgcolor: PALETTE.green, color: PALETTE.white } },
				{ feedbackId: 'battery_at_or_below', options: { rx, level: '30' }, style: { bgcolor: PALETTE.amber, color: PALETTE.black } },
				{ feedbackId: 'battery_at_or_below', options: { rx, level: '0' }, style: { bgcolor: PALETTE.red, color: PALETTE.white } },
				{ feedbackId: 'battery_unknown', options: { rx }, style: { bgcolor: PALETTE.dim, color: PALETTE.grey } },
				{ feedbackId: 'offline', options: { rx }, style: { bgcolor: PALETTE.deepRed, color: PALETTE.white } },
			],
			steps: [{ down: [], up: [] }],
		};

		presets[`rx:${n}:rf`] = {
			type: 'simple',
			name: 'RF on both antennas with the carrying one named. Amber below the threshold, and only on the antenna actually in use.',
			style: { text: `${V(`${p}_label`)}\\nRF ${V(`${p}_antenna`)}\\nA ${V(`${p}_rf_a`)} B ${V(`${p}_rf_b`)}`, size: '14', color: PALETTE.white, bgcolor: PALETTE.ink },
			feedbacks: [
				{ feedbackId: 'rf_below', options: { rx, threshold: 20 }, style: { bgcolor: PALETTE.amber, color: PALETTE.black } },
				{ feedbackId: 'rf_below', options: { rx, threshold: 8 }, style: { bgcolor: PALETTE.red, color: PALETTE.white } },
				{ feedbackId: 'offline', options: { rx }, style: { bgcolor: PALETTE.deepRed, color: PALETTE.white } },
			],
			steps: [{ down: [], up: [] }],
		};

		presets[`rx:${n}:af`] = {
			type: 'simple',
			name: 'Audio level in dB, red while peaking or while the receiver raises AF_Peak itself.',
			style: { text: `${V(`${p}_label`)}\\nAF\\n${V(`${p}_af_db`)} dB`, size: '14', color: PALETTE.white, bgcolor: PALETTE.ink },
			feedbacks: [
				{ feedbackId: 'af_peak', options: { rx, threshold: 85 }, style: { bgcolor: PALETTE.red, color: PALETTE.white } },
				{ feedbackId: 'muted', options: { rx }, style: { bgcolor: PALETTE.deepRed, color: PALETTE.white } },
				{ feedbackId: 'offline', options: { rx }, style: { bgcolor: PALETTE.deepRed, color: PALETTE.white } },
			],
			steps: [{ down: [], up: [] }],
		};

		presets[`rx:${n}:identity`] = {
			type: 'simple',
			name: 'Identity: the name on the receiver’s own display and its tuned frequency.',
			style: { text: `${V(`${p}_name`)}\\n${V(`${p}_frequency`)}\\nMHz`, size: '14', color: PALETTE.white, bgcolor: PALETTE.blue },
			feedbacks: [{ feedbackId: 'offline', options: { rx }, style: { bgcolor: PALETTE.deepRed, color: PALETTE.white } }],
			steps: [{ down: [{ actionId: 'refresh_config', options: { rx } }], up: [] }],
		};

		presets[`rx:${n}:mute`] = {
			type: 'simple',
			name: 'Mute and squelch state. Red while the receiver reports itself muted or squelched shut.',
			style: { text: `${V(`${p}_label`)}\\nSQ ${V(`${p}_squelch`)}`, size: '14', color: PALETTE.white, bgcolor: PALETTE.ink },
			feedbacks: [
				{ feedbackId: 'muted', options: { rx }, style: { bgcolor: PALETTE.red, color: PALETTE.white } },
				{ feedbackId: 'offline', options: { rx }, style: { bgcolor: PALETTE.deepRed, color: PALETTE.white } },
			],
			steps: [{ down: [], up: [] }],
		};

		presets[`rx:${n}:warnings`] = {
			type: 'simple',
			name: 'Whatever the receiver is complaining about, in its own words.',
			style: { text: `${V(`${p}_label`)}\\n${V(`${p}_warnings`)}`, size: '14', color: PALETTE.grey, bgcolor: PALETTE.bg },
			feedbacks: [
				{ feedbackId: 'has_warning', options: { rx, match: '' }, style: { bgcolor: PALETTE.amber, color: PALETTE.black } },
				{ feedbackId: 'offline', options: { rx }, style: { bgcolor: PALETTE.deepRed, color: PALETTE.white } },
			],
			steps: [{ down: [], up: [] }],
		};

		presets[`rx:${n}:antenna`] = {
			type: 'simple',
			name: 'Which antenna is carrying. Diversity switching is normal — this is for aiming aerials, not for alarms.',
			style: { text: `${V(`${p}_label`)}\\nANT\\n${V(`${p}_antenna`)}`, size: '14', color: PALETTE.white, bgcolor: PALETTE.ink },
			feedbacks: [
				{ feedbackId: 'antenna_active', options: { rx, antenna: 'A' }, style: { bgcolor: PALETTE.violet, color: PALETTE.white } },
				{ feedbackId: 'antenna_active', options: { rx, antenna: 'B' }, style: { bgcolor: PALETTE.violet, color: PALETTE.white } },
				{ feedbackId: 'offline', options: { rx }, style: { bgcolor: PALETTE.deepRed, color: PALETTE.white } },
			],
			steps: [{ down: [], up: [] }],
		};
	}

	// Sections decide grouping and order; a preset no section names is not shown.
	const idsIn = (prefix) => Object.keys(presets).filter((k) => k.startsWith(prefix));
	const structure = [
		{ id: 'rack', name: 'Rack', description: 'The whole rack on one key.', definitions: idsIn('rack:') },
		{ id: 'alerts', name: 'Alerts', description: 'Dark until they matter.', definitions: idsIn('alert:') },
		...receivers.map(({ n, label }) => ({ id: `rx${n}`, name: `Receiver ${n} - ${label}`, definitions: idsIn(`rx:${n}:`) })),
	];
	return { structure, presets };
}
