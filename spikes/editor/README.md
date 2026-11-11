# Two maps, one editor

A local, throwaway design study. Node **24.22.2**; npm; no fixed port.

```sh
cd /home/aaron/projects/order-doesnt-matter/spikes/editor
npm ci
npm run build
npm run serve
```

Open the URL printed by `serve`. `dist/` is current and works without the source
server; `serve` uses Vite's built-file preview on an OS-selected free port.
`npm run dev` serves source on another free port.

- Pick one of six design fixtures or any of the 85 corpus programs. Paste also
  uses the real importer. Imported text is executable Strudel.
- Switch maps with the two tabs. Search `shore lpf` in the 20-voice fixture to
  reach the same setting in either map. Click a result to open the editor.
- **Done** or **Escape** returns to navigation. The map is inert while editing.
  Context lanes and nested-driver links explicitly change the selection.
- Constellation: drag empty space to pan, scroll to explore, use +/− to zoom and
  **Fit** to recover. Collapsing hides moons. A phone uses one planet per row.
- Sheet: names and headers stay pinned while scrolling. M/S mute and solo;
  arrows reorder presentation without changing `cat`/`arrange` timing. Named shared instruments stay in one row/planet; section badges and the editor
  distinguish a shared edit from a section variation.
- Typed sequences: select a leaf or a subgroup header; edit values/weight,
  split, merge, rest or alternate. A stepped setting also has a paintable lane.
- Signal: drag high/low/speed handles or enter exact values. Rules generate
  notes; their notes cannot be dragged. Source edits evaluate after 450 ms.
- Changes during playback stay **PENDING** until the first dispatched onset of
  that voice at the new revision reaches the audio clock. The aligned option
  uses the next _uncommitted_ cycle, because queued audio cannot be recalled.
  A silent selection may remain pending until it next produces an onset.
- Undo/Redo and Ctrl/Cmd-Z work across document edits. Refresh resets the study;
  it deliberately has no persistence/export workflow.

## Verification

```sh
npm test
npm run test:browser
npm run shots:v2
```

Browser checks need Chromium installed for Playwright (or the existing cache).
They build **nothing**: run `npm run build` first. The combined gate runs real-input edits/jumps, existing editor behavior, pointer
checks and all 85 corpus maps, with a **90-second aggregate budget**. Every
script starts and closes a built-copy server on a free port. Durations are in
`browser-suite-study02.json`; real-input assertions are in `real-browser-results.json`;
coverage of every corpus program is in `corpus-coverage.json` and `CORPUS.md`.
Study 02 screenshots and four round critiques are in `shots/v2/`, under 6 MB.
`npm run shots:v2` refreshes the final screenshots from the built app.

`src/document.ts`, `src/query-document.ts` and `src/scene.ts` are pure and tested
in Node. `src/engine.ts` alone owns audio/REPL wiring. `src/adapter.ts` consumes
`spikes/import` after its 43 acceptance tests passed. `prepare-import.mjs` builds
that source into this study's `vendor/`, without writing into the import spike;
Vite packages its bounded query worker for the browser. The local declaration
uses the import agent's extended draft types (`data`, ordered setup, globals).
`src/fallback.ts` retains the original minimal three-function fixture adapter as
study evidence; it is no longer the active adapter.

No audio was heard. Dispatch timestamps and real queried events prove the
specified score changes, not speaker output, sample availability or continuity.

The default piece is the real House sketch. The section strip shows authored
sections, lengths and current position. Click a section to query it or restart
playback there. The sheet orders settings by instrument usage; “more settings”
unfolds rare controls. Signal curves use 64 queried samples per cycle.

“Switch Angel · local file” reads the earlier project through a Vite runtime
endpoint when it is present. The source is never included in `dist/`, `public/`,
or the corpus. Attribution is recorded in `corpus/README.md`; redistribution
permission was not clearly recorded in the earlier project's documentation.
On a different machine the button reports that the local file is unavailable.
