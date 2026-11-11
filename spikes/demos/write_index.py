# Executed by finish.py after every output has been measured.
from pathlib import Path
import json, math
rows=sorted(json.loads(Path('out/measurements.json').read_text()),key=lambda r:r['id'])
notes={
'01-gesture-delay':('Gesture delay','Watch the yellow release tick, then compare the following affected onset or gap. Each caption gives the measured release-to-engine-target delay; a note that occurs once per cycle can take longer than the scheduler horizon to change.'),
'02-gesture-delay-slowed':('Gesture delay, half speed','The exact turn and pitch actions from 01 replay at half speed, with audio one octave lower. The timeline marks release in yellow and the first changed scheduled note target in mint; start/end sync sentinels remain at normal speed.'),
'03-continuous-dragging':('Continuous dragging','Compare a slow continuous turn with fast back-and-forth scrubbing. Captions count sub-125 ms gaps, simultaneous onsets, and late dispatches; these are log observations, and a continuously changing score does not establish a fixed missing-note count.'),
'04a-six-voice-views':('Six voices: ring, fly-through, coil','Twelve seconds per view of the same continuously playing six-voice source. Follow the sweep against the onsets; the bd/sd/hh sample timbres are generated local substitutes, while the six branches, pitches, timing, and settings are original.'),
'04b-three-cycle-views':('Three-cycle pattern: ring, fly-through, coil','Twelve seconds per view of the original three-cycle alternating pattern. Compare how the changing cycle is represented while the same source keeps playing.'),
'05-density':('Density','The original 512-onsets-per-cycle program moves from raw creatures to occupancy bins, then close zoom. Compare exact onset visibility with aggregated occupancy; audio playback uses a recording allowance of 512 polyphony.'),
'06-order-doesnt-matter':('Order comparisons','A/B scalar setters, A/B ordered FX, and A/B implicit lfo targets use the same four-note phrase, with the code visible. Independent scalar setter event bags agree; prior probe PCM found differences for the FX and lfo pairs. No listening judgment was made.'),
'07-rooms-fighting':('Shared versus separate rooms','The same two phrases and delay/reverb settings play in one room, then two rooms; only AMBER’s orbit changes. Watch the conflict marker, voice strip, and room settings while comparing the captured tails; engine values are scheduling state, not proof of the active reverb buffer.')}
lines=['# Phone demonstrations','', 'Regenerate from the project root: `bash spikes/demos/run.sh`. All outputs are MP4, H.264, AAC, yuv420p, 1280×720, 25 fps, with faststart. Nothing was staged or committed.','',
'No audio was heard by the agent. All audio statements below are measurements or listening prompts. The music was tapped from the final Web Audio output before the device; these videos do not measure a phone speaker, Bluetooth, touch hardware, or physical output latency.','',
'Sync values are **audio minus picture**, in milliseconds, at the start / end flash-click markers. A negative number means the click leads the flash. RMS and peak are linear full-scale values measured after decoding each final AAC stream; all clipping counts are zero.','',
'| Video | Length | Size (MB) | Sync start / end (ms) | Audio RMS / peak |','|---|---:|---:|---:|---:|']
for r in rows:
    lines.append(f"| [{r['id']}.mp4]({r['id']}.mp4) | {r['lengthSeconds']:.2f} s | {r['sizeBytes']/1e6:.2f} | {r['syncMs'][0]:+.1f} / {r['syncMs'][1]:+.1f} | {r['audio']['rms']:.5f} / {r['audio']['peak']:.5f} |")
lines+=['','## What to watch and listen for','']
for r in rows:
    title,text=notes[r['id']];lines+=[f"### {r['id']}.mp4 — {title}",'',text,'']
    details=[]
    if 'sampleRate' in r:details.append(f"Capture: {r['sampleRate']} Hz; Chromium reported base/output latency {r['reportedBaseLatencyMs']:.1f}/{r['reportedOutputLatencyMs']:.1f} ms. Those device-path estimates are excluded by the output tap and do not establish latency on a phone.")
    if r.get('frameClock'):
        c=r['frameClock'];details.append(f"Captured frame intervals: median {c['medianFrameGapMs']:.1f} ms; maximum outside sync flashes {c['maxRenderGapMs']:.1f} ms; {c['gapsOver80ms']} gaps above 80 ms. {c['framesReused']} source frames reused for 25 fps export.")
        details.append(f"Music gain {r['gain']:.3f}× for the entire take; marker gain 0.8×. Source music RMS {r['musicSourceRms']:.6f}; source bus peak {r['rawAudio']['peak']:.6f}.")
    if r.get('dragLogSummary'):details.append('Complete melody dispatch log: '+json.dumps(r['dragLogSummary'])+'.')
    if r.get('densityStages'):details.append('Measured density stages: '+ '; '.join(f"{name}: {m['drawn']} parts drawn, {m['aggregated']} parts merged" for name,m in r['densityStages'].items())+'.')
    if r.get('rawAudio',{}).get('peak',0)>1:details.append('**Source-level warning:** the float output bus exceeded full scale. It was attenuated before AAC encoding; the final decoded stream has no clipped samples. The video carries this warning.')
    if r.get('renderMetrics'):
        m=r['renderMetrics'];details.append(f"Spiral's final rolling renderer sample: median frame {m['frameMedianMs']:.1f} ms; p95 {m['frameP95Ms']:.1f} ms. Software ANGLE/SwiftShader; this is not hardware-mobile performance.")
    if r.get('warning'):details.append('**WARNING: '+r['warning']+'.**')
    if r['errors']:details.append('**Browser console:** '+json.dumps(r['errors'])+' '+r.get('consoleNote',''))
    if r['id']=='01-gesture-delay':
        details.append('Release → first affected target: '+ '; '.join(f"{e['title']}: {e['delayMs']:.1f} ms ({e['type']})" for e in r['events'])+'.')
        if r.get('releaseTickAlignment'):details.append('Independent release-tick pixel check, picture minus logged release: '+', '.join(f"{v['visualMinusReleaseMs']:+.1f} ms" for v in r['releaseTickAlignment'])+'.')
    if r['id']=='07-rooms-fighting':details.append('Recorded DOM checks: '+ '; '.join(f"orbit setting {e['orbit']}: {e['rooms']} room(s), {e['conflicts']} conflict marker(s)" for e in r['events'])+'.')
    if details:lines+=[' '.join(details),'']
lines+=['## Timing and capture limits','',
'Playwright video PTS drifted materially relative to the page audio clock in this environment. Each rendered frame therefore carries a small binary audio-clock strip at the upper left. The mux selects captured frames by that clock on a 25 fps grid; normal-speed audio is never stretched. The only deliberate musical retiming is 02’s half-speed replay. Source PTS offsets and the endpoint scale they would have required are retained in the per-video metrics, but that scale is not applied.','',
'Start/end flashes are emitted with short clicks. Raw flashes are held for 100 ms to guarantee capture; the export retains exactly one captured white frame per marker at the observed flash time. Each marker’s captured frame is checked against neighboring audio-clock stamps, then its picture and decoded-AAC click are measured again in the exported MP4. The 40 ms output frame duration limits precision; the frame selection adds at most about 20 ms nearest-frame quantization. Marker checks do not prove acoustic output latency.','',
'Video 01’s yellow release ticks are burned from the trusted pointer-release/audio-clock log, independently of DOM paint delay; the half-speed replay retains those markers. Their final pixels are checked against the logged release time. Gesture movements and SVG updates remain captured prototype frames. The gesture delays compare pre-edit events with actually dispatched revised event values. A rest uses the first old onset beyond the committed horizon that is absent from the new score and absent from dispatch logs. These are first affected scheduled targets, not a waveform classifier’s estimate of when a human notices a change.','',
'The continuous-drag captions use target-time gaps below 125 ms, equal-target simultaneous onsets, and dispatches whose target is already in the past. Simultaneous onsets can involve different notes; the caption intentionally does not call them proven erroneous duplicates. Dropped notes remain unverified for this changing score.','',
'All builds and hooks live in `spikes/demos/`. The original gesture, spiral, and rooms directories were unchanged. The spiral’s original Travel button is not used to start audio; the moving playhead is supplied by the recording audio-clock hook. The spiral hook supplies an audio clock and extends queried horizons to 32 cycles; generated local percussion replaces the unspecified bd/sd/hh bank. The rooms comparison restarts each A/B phrase; the shared/separate test keeps every setting except the second orbit identical.','',
'Per-video machine-readable evidence is in the adjacent `.metrics.json` files; [measurements.json](measurements.json) collects it. Raw PCM, browser video, event logs, screenshots, and clock-based frame selections remain in `../raw/`.','']
Path('out/index.md').write_text('\n'.join(lines))
