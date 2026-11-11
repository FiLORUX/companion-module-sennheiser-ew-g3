# Changelog

All notable changes to this module. Versions follow [Semantic Versioning](https://semver.org/).

## 0.2.0 — 11/11/2026

First public release.

- Module id is now `sennheiser-ew-g3`. The previous private id
  `thast-sennheiser-g3` is listed in `legacyIds`, so Companion offers this
  module as the upgrade for a connection still on the old id. It does not
  switch the connection by itself; the variable, feedback and action ids are
  unchanged, so keys keep working after the switch.
- Presets name variables by the connection's label, so they work whatever the
  connection is called. They used to assume the module id.
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
