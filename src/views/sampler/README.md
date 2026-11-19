# Sampler source screens

A pad is a scored `s` + rounded `n` address. The lookup resolves banks, wrapped
indices, and note-keyed files. Notes selecting the same address and file share a
pad; a pitched address selecting different files has separate screens. Synth
pitches share one symbolic shape card, explicitly labelled “synth, no sample”.
Events without `s` use pinned Superdough's default triangle source.
Waveforms collapse the lookup's shared min/max peaks across all channels. Drawing
never reads `SampleBuffer.channels`. Each screen scales by its source's own peak,
computed once per buffer from those summaries. Its label retains the true peak in
dBFS. Silent and near-silent sources (below −60 dBFS) are labelled and keep their
natural amplitude rather than being amplified.

For ordinary sample playback:

```
elapsedSeconds = (now - note.start) / frame.cps
framesTravelled = elapsedSeconds * abs(speed) * buffer.sampleRate
sliceFrames = (end - begin) * buffer.frameCount
sliceProgress = clamp(framesTravelled / sliceFrames, 0, 1)
```

Thus the requested onset offset × speed × (sample rate ÷ playback rate) uses
`frame.cps` as the transport playback rate. This differs from the Web Audio
source node's playback-rate multiplier. Source fraction is frames divided by
`frameCount`. Speed zero does not trigger a source.

Pinned Superdough 1.3.0 multiplies the multiplier by `buffer.duration` for
`unit: 'c'`. Strudel rewrites such as `loopAt`/`splice` can already put a
tempo-dependent speed into the scored values; do not apply the cycle conversion
again. Although the control documentation mentions `unit: 's'`, this pinned
sampler only branches for `'c'`, so `'s'` follows ordinary rate behavior.

`begin`/`end` are fractions of the natural full buffer, independent of speed.
Negative speed reverses the entire buffer first: source bounds are
`[1-end, 1-begin]`, traversed from right to left. Simultaneous different slices
retain all their boundaries and cursors; coincident cursors merge into counted
pixel columns. The displayed percentage belongs to the most recent active
cursor. “Ended” means source traversal reached the slice end, not measured
silence. Envelopes, release, cut groups and effects aren't measured here.

The lookup does not expose bank-root transposition. Pitched samples, pitch
modulation and looping keep their true waveform but say the exact cursor is
unavailable. No guessed playback cursor is drawn for them.

Inventory and source tails are limited to the score window supplied by the host.
Constant sound/index settings retain known absent parts as unlit pads. A part
with neither queried notes nor a constant source address is counted as outside
the window; the view cannot discover its samples. No inventory or voice state
is remembered between frames. Overflow pads report merged addresses, notes and
cursors when the stage cannot fit individual screens.

The default MIDI 36 can also be transposed by a note-keyed bank whose closest
key is not C2, even without an explicit `note` or `freq`. The lookup does not
identify this case. Those unpitched cursors assume an untransposed bank and can
have an unknown rate; exact support needs resolved root/rate metadata.
