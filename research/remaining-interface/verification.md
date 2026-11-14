# E0 verification · 2026-11-14

Baseline main `67e6b7f`, Node **24.22.2**, npm. Research-only additions;
production/pins/living docs unchanged. No listening or audio timing measurements.

## Measured and exercised

T3 preview browser, static document injected into an owned blank tab, no server.
Actual keyboard actions: desktop planet → Enter / Tab / Enter → Settings → Escape
returned to `planet-0`; phone List entry 14 → Space → Escape returned to `list-13`.
Nested navigation kept exactly one editor. Enlarged Now List → dependency setting
→ Escape returned to `list-0` without closing enlargement; second Escape returned
to Now's enlarge control. Watch enlargement Escape returned to its enlarge control.
Clicked rhythm Apply changed the illustrative notation to `{fs2 b2 cs3,e3 ~}%4`;
callback Move changed the ordered branch to `fast(2).rev()`. Source Apply only
announces simulation. No document editing or engine inference follows.

| Measurement                                                                   | Result                             |
| ----------------------------------------------------------------------------- | ---------------------------------- |
| CSS viewport / page scroll width, desktop                                     | 1440 / 1440px                      |
| CSS viewport / page scroll width, phone, including advanced/dependent editors | 390 / 390px                        |
| Phone first full-name List entry                                              | 56.49px tall                       |
| Visible button minimum height                                                 | 44px                               |
| Visible full-name entries after “10 more”                                     | 14                                 |
| Watch stage, compact / enlarged                                               | 190 / 360px                        |
| `html_preview` desktop / phone content height                                 | 1471 / 2203px at 1160 / 390px wide |
| HTML preview console messages                                                 | none                               |

Calculated relative-luminance contrast ratios for rendered theme tokens:

| Palette | Text / card | Muted / card | Text / input | Selected text / fill |
| ------- | ----------- | ------------ | ------------ | -------------------- |
| Fern    | 13.85       | 8.86         | 10.90        | 11.10                |
| Paper   | 12.96       | 6.66         | 10.88        | 6.71                 |
| Night   | 15.11       | 9.84         | 11.53        | 9.23                 |

These four pairs do not certify accessibility or all disabled, browser-native or
canvas states. Reduced-motion **selection** changed the message to stationary
depth/no camera travel. The entire mockup is static, so actual camera motion and
OS-preference changes were not tested. Ring remains the selected default.

## Actually inspected visuals

Viewed T3 captures for desktop rhythm, phone ordered callback, Paper depth study,
Night compact Ring, and full Fern desktop/phone HTML previews. Names wrapped;
room outlines had solid/dashed distinctions and text; representative advanced
controls remained reachable by page scrolling; short Watch spans retained heads.
The compact Ring is deliberately small: a head remains a cue, not an individually
readable note label. Preferences and moving-scene readability remain owner work.
Phone page length is the tradeoff; the production proposal still needs real-piece
interaction and density checks, including 390×667.

Local T3 screenshot evidence (not portable attachments in this PR):
`browser-screenshot-site-mwgsjfrc-11690092.png` (desktop rhythm),
`browser-screenshot-site-mwgsjg4g-2f94753c.png` (phone callback),
`browser-screenshot-site-mwgsl9w1-7ed09601.png` (Paper enlarged depth),
`browser-screenshot-site-mwgsla0t-adfcd4c1.png` (Night Ring), under
`/home/aaron/.t3/userdata/browser-artifacts/`. Rerender `mockup.html` for portable
review. `html_preview` then `html_render` displayed the final artifact inline.
Owned preview tab closed; no owned browser/server left running.

## Source checks and repository gates

Run `npx vitest run --config research/remaining-interface/vitest.config.ts` for
these baseline evidence canaries: ordinary versus whole-program Setup comment,
and original Kiln import → cutoff target → immutable edit → generation → real
Strudel query over cycles 4–12, with original events/value intact. **2 passed**,
1.08s wall / 246ms tests. Initial new-test failure expected `undefined` rather than
the contract's `null` error value; fixed assertion, no production change or retry.
This is not a new visual editor or an Undo implementation test. The standard
browser gate already contains original-Kiln editing/Undo/context checks.

Full gates run serially under the common exclusive acceptance lock. The separate
lock-wait and script timings are appended below after completion. Per-run output
stays in an ignored `.browser-build-e0-*` directory; the browser script allocates
its own independent build/results directory and OS-selected free port. Budgets
and assertions unchanged, no retries.

Final locked gate results (both exit 0): lock wait **0.000s**; `npm run check`
**41.331s** complete, including **545 tests / 49 files** and Node sub-suite
**28.674s / 60s**; `npm run test:browser` **71.885s / 180s** script accounting
(**72.063s** process wrapper), **67 passed / 3 intentionally skipped**. No new
skips or changed assertions. Logs/results: `.browser-build-e0-dakiiu9q/` beside
this record (ignored, local evidence only). The lock was released and browser
runner shut down. Final additions to this record are evidence-only.

Also inspected an all-14-entries-open phone HTML preview: **3014px** content
height; the unbroken last name wrapped within its row. This was a temporary
initial-disclosure override for inspection; the artifact defaults to four rows.
Source canaries are opt-in baseline evidence, intentionally outside normal CI;
the Setup expectation should change when its production fix ships.
