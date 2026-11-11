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

- Pick one of six design fixtures or any of the 72 corpus programs. Paste also
  uses the real importer. Imported text is executable Strudel.
- Switch maps with the two tabs. Search `shore lpf` in the 20-voice fixture to
  reach the same setting in either map. Click a result to open the editor.
- **Done** or **Escape** returns to navigation. The map is inert while editing.
  Context lanes and nested-driver links explicitly change the selection.
- Constellation: drag empty space to pan, scroll to explore, use +/− to zoom and
  **Fit** to recover. Collapsing hides moons. A phone uses one planet per row.
- Sheet: names and headers stay pinned while scrolling. M/S mute and solo;
  arrows reorder presentation without changing `cat`/`arrange` timing. Group
  leaves become separate rows in the same way they become separate planets.
- Typed sequences: select a leaf or a subgroup header; edit values/weight,
  split, merge, rest or alternate. A stepped setting also has a paintable lane.
- Signal: drag high/low/speed handles or enter exact values. Rules generate
  notes; their notes cannot be dragged. Source edits evaluate after 450 ms.
- Changes during playback stay **PENDING** until the first dispatched onset of
  that voice at the new revision reaches the audio clock. The aligned option
  uses the next *uncommitted* cycle, because queued audio cannot be recalled.
  A silent selection may remain pending until it next produces an onset.
- Undo/Redo and Ctrl/Cmd-Z work across document edits. Refresh resets the study;
  it deliberately has no persistence/export workflow.

## Verification

```sh
npm test
npm run test:browser
node corpus-audit.mjs
node pointer-check.mjs
```

Browser checks need Chromium installed for Playwright (or the existing cache).
They build **nothing**: run `npm run build` first. Both browser scripts start and
close a built-copy server on a free port. The behavior suite has an 85-second
watchdog. Its latest duration and assertions are in `browser-results-final.json`;
coverage of every corpus program is in `corpus-coverage.json` and `CORPUS.md`.
Screenshots are in `shots/` (JPEG to stay under the requested 6 MB).

`src/document.ts`, `src/query-document.ts` and `src/scene.ts` are pure and tested
in Node. `src/engine.ts` alone owns audio/REPL wiring. `src/adapter.ts` consumes
`spikes/import` after its 37 acceptance tests passed. `prepare-import.mjs` builds
that source into this study's `vendor/`, without writing into the import spike;
Vite packages its bounded query worker for the browser. The local declaration
uses the import agent's extended draft types (`data`, ordered setup, globals).
`src/fallback.ts` retains the original minimal three-function fixture adapter as
study evidence; it is no longer the active adapter.

No audio was heard. Dispatch timestamps and real queried events prove the
specified score changes, not speaker output, sample availability or continuity.
