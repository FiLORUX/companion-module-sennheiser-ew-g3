/**
 * palette.js — one palette for the whole module.
 *
 * Broadcast convention first: red means trouble, amber means attend to this
 * before it becomes trouble, green means ready. Grey is the fourth state and it
 * carries real weight here — "unknown" must never be dressed as either good or
 * bad, because a Sennheiser receiver reports `?` for battery whenever its
 * transmitter is off, which is most of the day.
 */
export const PALETTE = {
  bg: 0x101018, ink: 0x1a1a24, dim: 0x2a2a36,
  white: 0xffffff, black: 0x000000, grey: 0x8a8a96,
  green: 0x009900, amber: 0xff8c00, red: 0xff0000, deepRed: 0x660000,
  blue: 0x2196f3, violet: 0x7040a0,
};

/** Battery colour from the receiver's own four-step string. */
export const batteryColour = (bat) => ({
  '100': PALETTE.green, '70': PALETTE.green, '30': PALETTE.amber, '0': PALETTE.red,
}[bat] ?? PALETTE.grey);
