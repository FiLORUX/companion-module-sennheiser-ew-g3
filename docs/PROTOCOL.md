# The Media Control Protocol, receiver side, as measured

Sennheiser's documents for this protocol (TI 1254, AN 1260) are not publicly
downloadable. This page records what the receivers actually send, so that the
module's behaviour can be checked against something other than the module.

**Provenance.** The field order was learnt by reading
[`s0600204/senn_rx_monitor`](https://github.com/s0600204-LiSP-Plugins/senn_rx_monitor),
a working implementation for EM 300/500 G3 and EM 300-500 G4, and then measured
on four **EM 500 G3** on 07/09/2026. Where the measurement disagreed with the
reference, the measurement won; those points are marked below. Nothing on this
page has yet been measured on a G4.

## Transport

- UDP, **port 53212 in both directions**. ASCII, case-sensitive, each record
  ended by a carriage return (`\r`).
- The receiver answers **to port 53212**, not to the port the request came
  from. A client therefore has to bind 53212, and only one process per machine
  can. Everything else about the module's shape follows from this: one
  connection serves every receiver, keyed by source address.
- No connection, no acknowledgement. A receiver is present while datagrams keep
  arriving; silence is the only evidence of absence.
- Firmware **1.7.0 or later**. Earlier firmware has no Media Control Protocol.

## Subscribing

| Command | Effect |
|---|---|
| `Push 0 0 1` | Send the static configuration once (name, frequency, squelch, mute, AF out, equaliser). |
| `Push 1 <rate_ms> 0` | Push the cyclic telemetry every `rate_ms` for the next second. Re-sent every second to keep it alive. |
| `Name <text>` | Write the name shown on the receiver's display. |

The reply begins with **an echo of the command it answers** (`Push 0 0 1`).
That echo starts with an upper-case letter like every real record, so it has to
be dropped by name. *(Not handled by the reference implementation.)*

The configuration reply can be lost, or overtaken by the cyclic push behind it.
The module asks again while a receiver's name is unknown, and whenever `Config`
changes.

## Records

Configuration reply, verbatim:

    Push 0 0 1<CR>Name ew500 G3<CR>Frequency 572400 21 1<CR>Squelch 5<CR>AfOut 18<CR>Equalizer 0<CR>Mute 0<CR>

Cyclic push, verbatim:

    RF1 14 16 1<CR>RF2 0 0 0<CR>States 5 0<CR>RF 16 1 0<CR>AF 0 0 5<CR>Bat ?<CR>Msg RF_Mute<CR>Config 9<CR>

| Record | Fields | Meaning |
|---|---|---|
| `RF1`, `RF2` | level, peak, flag | Antenna A and B, 0–100 on a 0–40 dBµV scale. **The third field was 1 on the antenna carrying signal and 0 on the other in every sample.** Read as "active antenna"; inferred, not documented. *(The reference reads two fields.)* |
| `AF` | level, peak, ? | 0–100, where 0 is −50 dB and 85 is 0 dB; over 100 is possible. Only fixed points are known: 5→−50, 10→−40, 15→−30, 25→−20, 45→−10, 85→0 dB. The module interpolates linearly between them. The third field equalled the squelch setting in every capture; meaning unconfirmed. |
| `Bat` | step | **A four-step gauge as a string: `100`, `70`, `30`, `0`, or `?`.** Not a percentage. `?` means no reading, which is what every receiver reports while its transmitter is switched off. It is not a flat battery. |
| `Msg` | words | Warnings raised by the receiver, e.g. `RF_Mute`, `Low_RF_Signal`, `AF_Peak`. Empty when there are none. |
| `Config` | n | A generation counter. It moves when the configuration changes, including from the front panel. |
| `Frequency` | kHz, ?, ? | `572400` is 572.400 MHz. The two trailing fields look like bank and channel; unconfirmed. *(The reference reads one field.)* |
| `Squelch` | n | 0, or 5–25 in steps. |
| `RF` | 3 values | Present in every push; meaning unconfirmed. *(The reference treats it as a bare marker.)* |
| `States` | 2 values | Present in every push; meaning unconfirmed. |
| `Name`, `AfOut`, `Equalizer`, `Mute` | | Configuration reply only. |

Records the module does not recognise are logged once at debug level rather
than discarded, so an unknown field on another model shows up instead of
vanishing.

## Discovery

A fixed 1035-byte service command to `224.0.0.251:8133` (link-local multicast)
makes receivers reply from the same port with `Model=… ID=<MAC> IPA=<address>`.
It crosses an L2 segment even where IP does not route, so a receiver found by
discovery may still be unreachable for reads. `tools/probe.mjs discover` sends
it; the module itself is configured with addresses and does not use it.

## Not covered

EW-D and EW-DX use Sennheiser's SSC protocol (JSON over UDP) and are not
compatible. Nor are Digital 6000 and Spectera.
