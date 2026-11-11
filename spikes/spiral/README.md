# Time, in orbit

A throwaway 3D design study for Order Doesn't Matter. The travel clock and all
geometry work without audio; Play audio optionally starts Strudel behind a
user gesture.

Use Node **24.22.2** from the project root's `.node-version`:

```sh
cd /home/aaron/projects/order-doesnt-matter/spikes/spiral
npm ci
npm run dev
```

The dev command asks the OS for a free port, then prints the URL. Open that URL.
Paste a Strudel score, set the start/window, and click **Draw score** (or
Ctrl/Cmd+Enter). The bundled core/mini/tonal/transpiler versions are 1.2.6.
`setcpm()` and `setcps()` set the visual clock; the CPM input can override it.
Travel stops at the queried horizon; it never silently loops the window.
Query the next window, or click an earlier cycle to travel again.
Multiple `$:` labels and `all()` are supported. Browser/audio-specific helpers
such as `samples()` are outside this visual-only evaluator and report an error.
It executes JavaScript in a disposable worker, not a security sandbox. An
8-second timeout terminates slow evaluations; queries are limited to 256 cycles
and 150,000 event parts / signal samples. Broken queries clear the old score.

- **Ring focus** reads one turn, with adjacent turns ghosted.
- **Fly-through** travels down a genuine helix at the visual clock's speed.
- **Cycle coil** fits the queried horizon into a side-on overview.
- Drag to orbit, wheel/pinch to zoom, two-finger drag to pan. Reset with ⌖.
- Click a cycle in the strip to visit it. Amber marks a difference from its
  predecessor, including the predecessor outside a shifted query window.
- Click a sound's colour key to focus that voice. Hover a glyph to inspect its
  full control bag, including values that have no dedicated visual encoding.
- **Auto detail** aggregates turns above 128 event parts into 64 time bins per
  sound / three-semitone pitch group. Close zoom (camera distance < 12) restores
  raw creatures. **Raw creatures** forces full detail at any zoom.

Bodies span the queried `part`; heads exist only when `part.begin == whole.begin`.
Long notes continue with dim, dotted bodies across cycle seams. Same-pitch
simultaneous voices receive small track offsets. No-`whole` haps are sampled with
64 genuine subqueries/cycle and drawn as control bands, without heads. Solid
length means **score duration**, not audible duration. Dotted offset whiskers
estimate explicit `duration`/`clip` plus `release`; sample tails, reverb and delay
are not measured. Unknown controls, arrays and opaque functions stay inspectable.
The pitch scale fits the queried window; it stays fixed while scrubbing it.

## Browser evidence

```sh
npm run build
# Install a matching browser locally if one is not already available:
PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers" npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers" npm test
PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers" node scripts/smoke.mjs
```

`npm test` starts its own Vite dev server on a free port, launches headless
Chromium, saves all 45 program/view screenshots, and writes `measurements.json`.
It also checks real hap counts, determinism, fragment onsets, multi-label pastes,
visible query failure, tempo/camera travel, mouse and touch, and a density sweep.
No fixed URL is required. An explicit `CHROMIUM_PATH=/absolute/path/to/chrome`
selects a locally installed Chromium; otherwise the harness uses the matching
Playwright browser or an already-installed cache browser and records its version.

`shots/pass-1-*`, `shots/pass-2-*`, and `shots/pass-3-*` preserve the original
appearance and the two visual iterations. Final program screenshots have no pass
prefix. Frame intervals include browser scheduling and software rendering;
`draw*Ms` measures CPU submission, not completed GPU work. Read [FINDINGS.md](FINDINGS.md)
for the visual verdicts and limits. Fonts are bundled for offline use after install.

## Study 02: watching now

Use **Play audio** to initialise pinned `@strudel/web` behind a user gesture.
The visible playhead follows the scheduler's audio clock, including its scheduling
latency. **Travel** remains a silent camera tour. Pause audio holds the position;
visiting another turn stops audio. Play audio starts the scheduler at that score
address; a sustained note already in progress is re-attacked for its remaining
scored duration. Oscillator phase and effect history cannot be reconstructed.
The display deliberately shows scored activity, not measured effect tails.
The master output is halved for mix headroom. Local deterministic percussion WAVs
supply `bd`, `sd`, and `hh`; other sample names need their own sample registration.

Fly-through shows the current turn plus four future turns by default. **Look
ahead** offers 3, 4, 5, 8, or 14 future turns. Past turns disappear. Bright spans
and beads mark scored activity; clicking a sound key focuses it visually while
the full ensemble continues playing. Camera gestures do not edit the score.

```sh
npm run build
npm test            # original 15-program / 3-view browser coverage
npm run test:now     # built bundle: duration, rest, continuation, focus, audio
npm run test:built   # built bundle / worker / fonts smoke check
npm run test:audio   # real Strudel: start inside a long note
```

Evidence: `shots/v2/`, `measurements-study02.json`, `study02-checks.json`, and
`FINDINGS.md`. Run the new recording from `spikes/demos/` with
`node record-now.mjs`, then `TAKE=08 .venv/bin/python finish.py`.
