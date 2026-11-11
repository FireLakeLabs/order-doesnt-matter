# Gesture study

Use Node **24.22.2**. From this directory:

```sh
npm ci
npm run dev
```

Open the printed URL and click **Play**. The launcher asks the operating system
for a free port. Both voices are synthesized; there are no remote samples.

- Drag the inner dark track to turn a voice in sixteenth-cycle increments.
  Hold **Shift**, or select **Free time**, for continuous movement.
- Drag a note arc radially to change pitch. Tap a note/rest to toggle it.
- Pull an arc's end dot outward to split its step. Pull a nested step's dot
  inward to merge the pair. **Split / merge** makes either edge easier to select.
- Paint the amber brightness or blue gain band. Radial distance sets its value.
  **Smooth paint** uses a periodic, linearly interpolated curve.
- Wheel up/down or pinch apart/together to double/halve speed (bounded ×¼…×4).
- Hold **Alt** and pull outward from the inner track to add an echo. Angle
  sets delay; distance sets transposition. **Pull echo** is the touch equivalent.
  Each separate pull adds another ordered rewrite.
- **Undo / Redo** groups each drag into one edit. **Reverse** adds a rewrite.
  The bottom drawer shows freshly generated, read-only Strudel.

Verification:

```sh
npm test
npm run build
npm run test:browser
```

`test:browser` builds first, serves the built app with Vite on a free port,
launches headless Chromium, and closes both. It uses the pinned Playwright
browser, an existing Chromium in `~/.cache/ms-playwright`, or `CHROMIUM_PATH`.
If none is installed: `npx playwright install chromium`.
The browser run has a 57-second watchdog. Held-gesture screenshots are in
`shots/`; raw latency and trigger evidence is in `browser-results.json`.

`src/document.ts`, `src/generate.ts`, and `src/scene.ts` have no browser/audio
imports. `engine.ts` owns Strudel web playback and instrumentation; `view.ts`
owns pointer handling, document history, and SVG rendering. The diagnostic
`window.gesture` API is deliberately available in this throwaway spike.

Vitest resolves the published Kabelsalat ESM entry through Vite: its Node `main`
points at an IIFE. Real Strudel is used, without mocks. Generated source starts
with `// mini-off` so the web transpiler leaves JSON strings alone; a Node test
also exercises the actual transpiler.

Read [FINDINGS.md](FINDINGS.md) for measurement limits and remaining checks.
