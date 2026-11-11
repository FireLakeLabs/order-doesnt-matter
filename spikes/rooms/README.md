# Rooms research spike

Use Node **24.22.2** and npm. No other project imports this directory.

```sh
cd /home/aaron/projects/order-doesnt-matter/spikes/rooms
npm ci --cache .npm-cache
npm run build
node serve.mjs --built
```

Open the URL printed by the server: its port is allocated dynamically. `npm run dev`
also selects a free port. Paste a Strudel expression or labelled REPL program and
press **Play**. Stop resets shared effects. The two generated samples are `local`
(0.8 seconds) and `longlocal` (1.6 seconds). Other sample banks must be registered
by the pasted program; they are not silently substituted.

```sh
npm run measure
npm run shots
```

`measure` builds first, serves `dist/` on port zero, launches headless Chromium
through Playwright, then saves **results.json** and regenerates **FINDINGS.md**. No raw PCM is written. A fresh
iframe isolates every render from superdough's cross-context node pool, cut groups,
and orbit state. Native OfflineAudioContext renders handle ordinary probes;
`live:true` uses an AudioWorklet tap with sample-frame timestamps. The final live
probes use 60ms scheduling lead. Each program's rendered onsets have a 50ms offset;
all scores use one cycle per second. Generated reverb impulses are seeded for
comparisons. The offline harness awaits every nested IR render; it does not change
or reorder superdough's stages. Production Strudel's stock download renderer does
not provide this readiness barrier. Duck/bmod are also tested live because their
adapters depend on main-thread callbacks. No one listened to these recordings.

Playwright's matching Chromium is preferred; an existing local Chromium cache is
the fallback. To select an executable explicitly:

```sh
CHROMIUM_PATH=/absolute/path/to/chromium npm run measure
CHROMIUM_PATH=/absolute/path/to/chromium npm run shots
```

`shots` verifies five examples (trigger callbacks, ordered insert count, conflicts,
separate rooms and cross-voice relationships), syntax-error recovery, a pasted local
sample program and mobile overflow. It saves five full-page PNGs plus
**ui-results.json**. Compression requires Python Pillow and preserves accent hues.
After compression the PNGs are about 0.3 MB combined. Screenshots were inspected,
then the labels, default-envelope text, voice colors, scheduling explanation and
mobile wrapping were revised and recaptured.

The strip is the latest triggered note, not a meter of signal moving stage by
stage. It flashes all carried stages together at onset. FX entries show their
ordered bags; each bag itself has the same fixed native order. Room settings
include the engine's actual IR duration, which can disagree with its stored room
size after asynchronous regeneration. Conflicts compare intentions within the
queried cycle; they are potential conflicts, not a claim that notes overlap.
Labelled patterns retain identity through a harmless diagnostic event field.
Unlabelled branches with the same sound and orbit merge. Dense scores, opaque JS,
custom sources and arbitrary user-defined control schemas have no complete visual
coverage. Ring heads show a sampled cycle, never an inferred repeat length.
