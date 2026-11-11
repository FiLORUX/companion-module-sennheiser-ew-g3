---
name: Receiver report (G4 or another model)
about: Tell us how the module behaves on a receiver model we have not measured
title: "Receiver report: <model>"
labels: receiver-report
---

**Receiver model and firmware** (Menu → Advanced → Software Revision):

**Companion version and OS:**

**Does it work?** (battery, RF, AF, name and frequency on the keys)

**Probe output.** Disable the connection, then run on the Companion machine:

```sh
node tools/probe.mjs read <receiver-ip> --seconds 10 --raw
```

```
paste the whole output here
```

**Battery.** If you can, note what the transmitter's own display showed while
the probe ran (bars, or switched off). That is the field most likely to differ
between generations.
