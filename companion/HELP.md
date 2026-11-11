# Sennheiser evolution wireless G3/G4 receivers

This module reads battery, RF, AF and warnings from **ew G3 and G4 rack
receivers** over Sennheiser's Media Control Protocol (EM 300/500 G3,
EM 300-500 G4, EM 2000, EM 2050). It does not cover transmitters or EW-D.

## One connection for every receiver

The receivers reply **to UDP port 53212**, not to the port a request came
from. So this module has to listen on 53212, and only one program per machine
can do that. **Add one connection and enter every receiver in it.** A second
connection cannot open the port and stays red.

For the same reason, close Sennheiser WSM or Control Cockpit if they run on
this machine.

## Setting up

1. **Fixed addresses.** Give each receiver a fixed address or a DHCP
   reservation. If the address changes, this module keeps asking the old one
   and gets no answer.
2. **Receivers.** Enter the addresses separated by commas, in the order you
   want them numbered. The first is receiver 1, and that number is what every
   variable, feedback and preset refers to.
3. **Labels** (optional). Names in the same order, so a key shows `PRESENTER`
   instead of `192.168.0.234`.
4. **Firmware.** The receivers need firmware **1.7.0 or later**. Earlier
   firmware has no network protocol at all.

The connection turns green once every receiver answers, yellow while only some
do, and red while none do.

## Reading the keys

- **Battery is a four-step gauge, not a percentage**: FULL, GOOD, LOW, EMPTY,
  and `?`. `?` means there is no reading, almost always because the
  transmitter is switched off. It is drawn grey, never as an empty gauge:
  an empty gauge reads as flat, and someone changes a good battery in the
  middle of a show.
- **RF is shown per antenna**, with a flag for the antenna that is carrying the
  signal. Signal on one antenna and nothing on the other is normal diversity
  behaviour, not a fault.
- **Silent means no data is arriving.** UDP has no connection to drop, so a
  receiver counts as present while its data keeps arriving and silent when it
  stops.

## Presets

Drag them straight onto a key. Every preset is complete and needs no editing.
They are grouped by how you work: a **Rack** overview, **Alerts** that stay
dark until they matter, and one category per receiver.

On each key the feedbacks are listed in priority order, with the most urgent
last so that its colour wins. Silent beats everything: a receiver that has
stopped answering tells you nothing about its battery, and showing its old
battery colour underneath would be misleading.

## G4

The G4 receivers use the same protocol. This module has been measured on G3
only. If you run it on a G4, a report helps, especially of the battery values:
github.com/FiLORUX/companion-module-sennheiser-ew-g3/issues
