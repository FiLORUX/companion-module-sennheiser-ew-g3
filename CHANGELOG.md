# Changelog

All notable changes to this module. Versions follow [Semantic Versioning](https://semver.org/).

## 0.2.0 — 11/11/2026

First public release.

- Module id is now `sennheiser-ew-g3`. The previous private id
  `thast-sennheiser-g3` is listed in `legacyIds`, so Companion offers this
  module as the upgrade for a connection still on the old id. It does not
  switch the connection by itself. The variable, feedback and action ids are
  unchanged, so existing keys should carry over; that switch has not yet been
  tried on a live install.
- Presets reference variables as `$(<connection label>:…)`, the same form a
  trigger or a hand-built key uses. Before, they used the module id, which
  Companion rewrites to the label when a preset is dragged out. That worked
  too, but only there.
- `Frequency` and `AF` keep their unconfirmed trailing fields
  (`frequencyExtra`, `afExtra`) instead of discarding them.
- MIT licence, manifest validated against the schema of the bundled
  `@companion-module/base`, tests for the decoder, the UDP client and the
  presets, and reproducible release packages built in CI.
- `tools/probe.mjs`: reads and discovers receivers from the command line,
  using the module's own decoder.

## 0.1.9 and earlier

Private builds, in daily use on four EM 500 G3:

- One connection serves the whole rack; it publishes at most five times a
  second, and only the values that changed.
- Status follows the receivers, not the socket.
