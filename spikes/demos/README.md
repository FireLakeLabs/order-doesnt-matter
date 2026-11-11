# Phone demonstrations

From the project root, regenerate everything with:

```sh
bash spikes/demos/run.sh
```

Requires the project's Node 24.22.2, npm, Python with venv support, and ffmpeg /
ffprobe with `libopenh264`, AAC, drawtext, and a Liberation Sans font at
`/usr/share/fonts/liberation-sans-fonts/LiberationSans-Regular.ttf`.
The script installs the pinned npm dependencies, Chromium and Playwright's ffmpeg,
and a local Python environment with NumPy. Servers bind OS-selected ports.
No original prototype files are changed. No git commands stage or publish output.

`record.mjs` uses headless Playwright against built copies prepared by `build.mjs`.
`bridge.js` adds phone-sized captions, a visible pointer, press/release ripples,
release ticks, start/end flash-click markers, and a final-output AudioWorklet PCM tap.
The tiny black/white strip at the upper left encodes the page audio clock in every
rendered frame. `finish.py` decodes it to select each 25 fps output frame at the
matching audio time, then independently detects the captured flash/click markers
in the final H.264/AAC MP4. It measures the decoded audio, not just the source PCM.

The raw capture holds each sync flash for 100 ms to ensure the video recorder sees
it. The exported video keeps exactly one captured white frame at that marker's
observed audio-clock time. Music is not retimed for normal-speed takes. Music gets
one constant gain per take; sync clicks get a separate fixed gain. No limiter or
per-example normalization is used. See the JSON metrics for exact gains.

Video 01's external release tick is burned from the trusted pointer-release
audio-clock log, avoiding DOM marker paint delay. Captured gesture/rack updates
retain their measured frame times. The mux checks the final yellow tick pixels
against the input timestamps. Source float peaks above full scale and capture
gaps above 80 ms receive visible warnings; AAC is checked after decoding.

The slowed video reuses the exact turn and pitch segment of video 01. Its audio
and video are both half speed; pitch is one octave lower. Normal-speed start/end
sync sentinels are retained. Its timeline marks release and the first changed
scheduled note target.

## Recording-only changes in copies

`build.mjs` copies the three prototypes into `stage/`, which is disposable:

- All copies: an extra module script loads `demo-bridge.js`; CSS hides peripheral
  UI and enlarges labels without changing the music or gesture operations.
- Gesture: trigger telemetry additionally stores the complete event value and
  end time. This allows comparison against the pre-gesture pattern. No scheduler
  or gesture code changes.
- Spiral: a typed `demoSpiral.setClock` hook lets the recorder supply the inverted
  Strudel scheduler audio clock each animation frame. Query windows are extended
  to 32 cycles so a 36-second tour cannot outrun the score. Audio is supplied by
  pinned `@strudel/web` 1.3.0, playing the source shown by the prototype.
- Spiral's six-voice source names `bd`, `sd`, and `hh` but ships no sample bank.
  Deterministic local WAV percussion is registered under those names. The source
  score, six branches, timing, pitches, and settings are preserved; those three
  sample timbres are recording substitutes and are disclosed in the video.
- Rooms: no model, engine, or event hook changes. The recording drives its existing
  editor and play/stop handlers, retaining its voice strip and conflict display.

## Limits

No audio was heard by the agent. Delays in captions come from scheduled event
changes, including missing scored onsets for a rest; they are not microphone or
speaker measurements. Headless/device output latency is excluded by the output
tap. Live audio timing, sample rate, rendering cadence, clock alignment, and output
level measurements are in `out/index.md` and adjacent `*.metrics.json`.

A changing score has no fixed list of expected onsets, so the continuous-drag
captions identify sub-125 ms gaps, simultaneous onsets, and late dispatches, but do
not label every short gap as an erroneous duplicate or claim zero dropped notes.

For one take while iterating: `TAKE=05 node spikes/demos/record.mjs --no-build`
(from the project root, after a full build). Re-mux with
`spikes/demos/.venv/bin/python spikes/demos/finish.py`.
