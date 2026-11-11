# Study 02 regression evidence

All bugs below were reproduced before the corresponding fix, then passed in the final suite. The retained `*-red.txt` files contain the expected failures.

| Check                        | Failing observation                                                              | Result after fix                                                            |
| ---------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Import author vocabulary     | Single-use `intro` / `kick` names and adjacent comments absent from the document | Labels/comments retained through generation/reimport; events unchanged      |
| Browser evaluation binding   | `const drop` collided with an exported engine function                           | Nested evaluation scope permits authored bindings                           |
| Tempo and time               | `setCpm is not defined`; `time` treated as unresolved                            | Pinned alias and time signal recognised                                     |
| Draw parameter               | `fill is not a function` in the local registered gate                            | Same `createParams('fill')` registration as pinned draw package             |
| Silence                      | Three unresolved `silence` boundaries in the arranged Dubstep                    | Explicit silent generator, no warning, equal events                         |
| Shared instrument tagging    | Zero events attributed to the shared kick row                                    | All 64 kick events attributed to its single instrument                      |
| Dense constellation geometry | A moon extended to 293 px from a 200 px card boundary                            | Bounded rings and collision-avoiding placement                              |
| Shared aligned edits         | New gain 0.9 appeared before the boundary                                        | Prior lexical bindings isolated; old/new gains 0.2/0.9 in their own windows |
| Override search              | `chords filter` returned no section override                                     | Author name retained in the selection path, friendly control alias searched |
| Imported control range       | Canonical cutoff fell through to generic `value`, 0–10                           | Frequency control, 20–16000 Hz                                              |

The real browser suite also verifies 110 px rows, explicit inactive state, rare settings unfolding, shared edits in all five sections, Undo, named breadcrumbs, local-only loading, and section jumps while stopped/playing. An intermediate check caught a readiness race during an asynchronous jump; the busy state now covers the restart.

Browser timing is one local wall-clock run, with errors counted and actual queried events and dispatched revisions inspected. It is a budget check, not a speedup claim. Strudel and browser versions are pinned by the spike lockfiles / installed Chromium. No audio was heard, and no decoded sample availability, acoustic continuity or tails were proved.
