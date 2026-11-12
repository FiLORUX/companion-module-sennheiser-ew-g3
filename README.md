# Sennheiser evolution wireless G3/G4 receivers for Bitfocus Companion

Battery, RF, AF and warnings from Sennheiser **ew G3 and G4 rack receivers**,
read over the network and put on your Stream Deck.

![CI](https://github.com/FiLORUX/companion-module-sennheiser-ew-g3/actions/workflows/ci.yml/badge.svg)

| | |
|---|---|
| **Receivers** | EM 300 G3, EM 500 G3, EM 300-500 G4, EM 2000, EM 2050, with Ethernet and firmware 1.7.0 or later |
| **Companion** | 5.0 or later |
| **Protocol** | Sennheiser Media Control Protocol, UDP 53212 |
| **Status** | In daily use on four EM 500 G3. **Not yet confirmed on G4**, see [G4 owners](#g4-owners-please-read) |

Bitfocus's own `sennheiser-evolutionwireless` module covers the transmitter
side (SR / IEM); its receiver side was never written. This module is
receivers only.

## What you get

**Per receiver**
- battery as a four-step gauge (FULL, GOOD, LOW, EMPTY), or no reading
- RF level on each antenna, in 0–100 and dBµV, plus which antenna is carrying
- AF level, in 0–100 and dB
- squelch, mute, frequency in MHz, and the name on the receiver's own display
- the warnings the receiver raises itself: `RF_Mute`, `Low_RF_Signal`, `AF_Peak`

**For the whole rack**
- how many receivers are answering
- the worst battery and which receiver has it
- how many receivers are at LOW or below, and how many are raising a warning

There are 11 feedbacks, 3 actions and ready-made presets. Drag a preset onto a
key and it works; nothing needs editing. A **Rack** key gives a summary of the
whole rack. The **Alerts** keys stay dark until they matter. Each receiver also
gets its own category with status, battery, RF, AF, identity, mute, warnings and
antenna keys.

## Install

Companion installs this module from a package file. It is not in the module
store yet.

1. Download `sennheiser-ew-g3-<version>.tgz` from the
   [latest release](https://github.com/FiLORUX/companion-module-sennheiser-ew-g3/releases/latest).
2. Open the Companion web interface **on the Companion machine itself**
   (`http://localhost:8000`). Companion only accepts a module package from a
   browser on the same machine, unless network module import has been enabled
   in the launcher.
3. Open **Modules** and click **Import module package**. Choose the `.tgz` file.
   The module loads straight away; no restart is needed.
4. Open **Connections**, add **Sennheiser evolution wireless G3/G4 receivers**,
   and fill in the settings below.

To update, import the newer `.tgz` the same way, then pick that version on the
connection. To check a download against the release:
`sha256sum sennheiser-ew-g3-<version>.tgz` (on macOS, `shasum -a 256`) must
match `SHA256SUMS`.

## Setting up

**Add one connection for all your receivers.** A second connection does not
work. The receivers reply to UDP port 53212, and only one program per machine
can listen on that port. If you add a second connection, it cannot open the
port and stays red.

| Setting | |
|---|---|
| **Receivers** | The receivers' IP addresses, separated by commas, e.g. `192.168.0.31, 192.168.0.32`. The first one is receiver 1, and that number is what every variable, feedback and preset refers to. |
| **Labels** | Optional names in the same order, e.g. `PRESENTER, GUEST 1`. If you leave this empty, keys show the name stored in the receiver, or else its address. |
| **Update rate** | How often each receiver sends data, in milliseconds. The default is 100 ms. |
| **Offline after** | How many seconds without data before a receiver counts as silent. The default is 3 s. |

Before you start:
- **Fixed IP addresses.** Give every receiver a fixed address or a DHCP
  reservation. If the address changes, the module keeps asking the old one and
  gets no answer.
- **Firmware.** The receivers need firmware **1.7.0 or later**. Earlier
  firmware does not have the network protocol at all.
- **Nothing else using port 53212.** Close Sennheiser Wireless Systems Manager
  (WSM) and Control Cockpit on the Companion machine. They need the same port.
- **Network.** UDP port 53212 must get through in both directions between
  Companion and the receivers. Watch out for firewalls and VLAN boundaries.

## Variables

Here `rxN` is the receiver number, e.g. `$(MICS:rx1_battery_text)`. The part
before the colon is your connection's name.

| Variable | |
|---|---|
| `rxN_label`, `rxN_name`, `rxN_address` | Label, name reported by the receiver, address |
| `rxN_online` | `1` while answering |
| `rxN_battery` | `100`, `70`, `30`, `0` or `?` |
| `rxN_battery_text` | `FULL`, `GOOD`, `LOW`, `EMPTY`, or `NO BATT` when there is no reading |
| `rxN_battery_pct` | Approximate percentage for drawing a gauge. The receiver only reports the four steps. |
| `rxN_rf_a`, `rxN_rf_b`, `rxN_rf_a_dbuv`, `rxN_rf_b_dbuv` | RF per antenna |
| `rxN_antenna` | `A`, `B` or `—`: the antenna carrying signal |
| `rxN_af`, `rxN_af_db` | Audio level |
| `rxN_frequency`, `rxN_squelch`, `rxN_mute`, `rxN_warnings` | |
| `receivers_total`, `receivers_online`, `receivers_offline` | |
| `lowest_battery`, `lowest_battery_label`, `low_battery_count`, `warning_count` | |
| `rack_summary` | E.g. `4/4`, or `4/4 · LOW on GUEST 1` |

`—` means the receiver has not reported that value. It is never shown as zero.

## Reading the keys

- **`?` / NO BATT means there is no battery reading, not an empty battery.**
  The receiver reports it whenever its transmitter is switched off. The keys
  show it in grey and never as an empty gauge, so no one changes a good battery
  in the middle of a show.
- **Battery has only four steps.** The receiver does not report a percentage.
- **Signal on only one antenna is normal.** With diversity, one antenna usually
  carries the signal and the other is near zero. The RF alarm looks only at the
  antenna that is carrying.
- **Silent means no data is arriving.** UDP has no connection to drop, so a
  receiver counts as present only while its data keeps arriving. A silent
  receiver turns the key deep red, ahead of every other colour, because its
  last battery reading is no longer true.

## G4 owners, please read

The G4 receivers use the same Media Control Protocol, and the reference
implementation this module was checked against supports the EM 300-500 G4.
Even so, this module has only been measured against G3. If you have a G4,
please run the probe and send in the output. That turns "should work" into
"works":

```sh
git clone https://github.com/FiLORUX/companion-module-sennheiser-ew-g3.git
cd companion-module-sennheiser-ew-g3
node tools/probe.mjs read <receiver-ip> --seconds 10 --raw
```

The probe needs Node.js 22 or later and nothing else, so there is nothing to
install. Run it on the Companion machine. Disable the connection first, because
the probe needs port 53212 too. Paste the output into a
[G4 report](https://github.com/FiLORUX/companion-module-sennheiser-ew-g3/issues/new?template=g4-report.md).
Battery values are the most interesting: G4 might report them differently.

`node tools/probe.mjs discover` lists the receivers that answer on your network.

## How it works

[`docs/PROTOCOL.md`](docs/PROTOCOL.md) describes the wire format as measured.
Sennheiser's own documents for this protocol are not publicly available, so
the page also says where each field comes from and which ones are still
unconfirmed. Four things from that page shaped the module:
- **One connection per machine,** because of the port.
- **The receiver echoes your command back** at the start of its reply. The
  module recognises the echo by name and drops it, so it is never read as
  receiver data.
- **The configuration is fetched again** whenever the receiver's own change
  counter moves. A frequency changed on the front panel therefore reaches the
  keys.
- **Fields the module does not know are logged,** not silently dropped.

The module only publishes the values that changed, at most five times a
second. A meter that moves less than it would visibly change on a key is not
sent at all, so a quiet rack costs Companion nothing.

## Development

```sh
npm ci
npm test          # decoder against captured datagrams; client against a simulated receiver
npm run check     # manifest against the schema of the bundled @companion-module/base
npm run package   # check, test, bundle, and write dist/sennheiser-ew-g3-<version>.tgz
```

The package is reproducible: its files carry a fixed timestamp and owner, so
the same sources give the same archive contents anywhere, and the same bytes on
the same Node.js version (gzip output differs between zlib versions). Pushing a
`v*` tag builds it in CI and attaches the `.tgz` and `SHA256SUMS` to a GitHub
release. The tag must match the manifest version.

Source layout: `src/protocol.js` (decoder and UDP client, no Companion
dependency), `src/main.js` (the connection: config, variables, feedbacks,
actions), `src/presets.js`, `tools/probe.mjs` (command line, same decoder).

## Contributing

Reports are as welcome as code, and the most useful contribution right now is
a [receiver report](https://github.com/FiLORUX/companion-module-sennheiser-ew-g3/issues/new?template=g4-report.md)
from a model that has not been measured yet. There is no such thing as a
question too basic to ask; if something here is unclear, that is a fault in the
documentation. For a change to the code, please open an issue first so we can
agree the shape of it, keep pull requests small, and run `npm run package`
before you push.

## Acknowledgements

- [`senn_rx_monitor`](https://github.com/s0600204-LiSP-Plugins/senn_rx_monitor)
  by s0600204, whose working receiver monitor made the field order learnable
  at all. This module was written from scratch and measured against hardware,
  but it would have taken far longer without that reference.
- The [Bitfocus Companion](https://bitfocus.io/companion) team and its
  community, for a platform that makes this kind of tool worth building.

## Licence

MIT. See [LICENSE](LICENSE). Sennheiser and evolution wireless are trademarks
of Sennheiser electronic SE & Co. KG. This project is not affiliated with or
endorsed by Sennheiser.

---

Maintained by David Thåst, broadcast engineer, at [thast.works](https://thast.works).
