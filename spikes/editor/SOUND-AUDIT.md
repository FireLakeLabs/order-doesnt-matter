# Corpus sound audit

Default registry: piano, drum machines, EmuSP12, VCSL, mridangam and the complete Dirt sample set. Names below come from real Strudel event queries, with authored muted voices enabled, across at least 16 cycles or the declared full piece length (maximum 512). Broken queries are explicitly marked; cycle zero is attempted separately. Sample readiness means downloaded and decoded, not heard.

| Program                  | Sounds                                                          | Missing / unchecked                           |
| ------------------------ | --------------------------------------------------------------- | --------------------------------------------- |
| micro-tree-stack         | sine                                                            | —                                             |
| micro-tree-arrange       | bd, cp, hh                                                      | —                                             |
| micro-callback-off       | triangle                                                        | —                                             |
| micro-callback-deep      | sine                                                            | —                                             |
| micro-reuse              | sine, triangle                                                  | —                                             |
| micro-register           | sine                                                            | —                                             |
| micro-pattern-fast       | sine                                                            | —                                             |
| micro-pattern-slow       | bd, cp, hh                                                      | —                                             |
| micro-labels             | bd, cp, hh                                                      | —                                             |
| micro-orbit-conflict     | bd, sine                                                        | —                                             |
| micro-long-alternation   | sine                                                            | —                                             |
| micro-polymeter          | bd, cp, hh                                                      | —                                             |
| micro-seeded-drop        | hh                                                              | —                                             |
| micro-random-pitch       | sine                                                            | —                                             |
| micro-arrange-300        | bd, cp, hh, sine                                                | —                                             |
| micro-arrange-301        | bd, cp, sine                                                    | —                                             |
| micro-signal-bare        | none queried                                                    | —                                             |
| micro-signal-lanes       | sawtooth                                                        | —                                             |
| micro-fragments-slow     | sine                                                            | —                                             |
| micro-fragments-chop     | sawtooth                                                        | —                                             |
| micro-dense-64           | hh                                                              | —                                             |
| micro-dense-stack        | sine                                                            | —                                             |
| micro-bare-numbers       | none queried                                                    | —                                             |
| micro-bare-strings       | triangle                                                        | —                                             |
| micro-control-aliases    | sine                                                            | —                                             |
| micro-control-multivalue | sine                                                            | —                                             |
| micro-control-array      | user                                                            | —                                             |
| micro-fx-filter-drive    | sawtooth                                                        | —                                             |
| micro-fx-drive-filter    | sawtooth                                                        | —                                             |
| micro-orbit-delay        | bd, cp                                                          | —                                             |
| micro-cut-group          | hh, oh                                                          | —                                             |
| micro-duck-room          | bd, sawtooth                                                    | —                                             |
| micro-tails              | sine                                                            | —                                             |
| micro-clip-length        | oh                                                              | —                                             |
| micro-external-state     | bd                                                              | —                                             |
| micro-external-tempo     | sine                                                            | —                                             |
| micro-trigger            | sine                                                            | —                                             |
| micro-visuals            | bd, cp, hh                                                      | —                                             |
| micro-query-throws       | none queried                                                    | query error: corpus intentional query failure |
| micro-query-late-throws  | triangle                                                        | query error: corpus intentional late failure  |
| micro-sample-loop        | breaks165                                                       | —                                             |
| micro-sample-splice      | breaks165                                                       | —                                             |
| mms-clock                | sine                                                            | —                                             |
| mms-euclid               | sine                                                            | —                                             |
| mms-euclid-legato        | sine                                                            | —                                             |
| mms-ratchet              | sine                                                            | —                                             |
| mms-seed                 | sine                                                            | —                                             |
| mms-palindrome           | sine                                                            | —                                             |
| mms-shuffle              | sine                                                            | —                                             |
| mms-ribbon               | sine                                                            | —                                             |
| mms-zoom                 | sine                                                            | —                                             |
| mms-echo                 | sine                                                            | —                                             |
| mms-chunk                | sine                                                            | —                                             |
| mms-off                  | sine                                                            | —                                             |
| mms-within               | sine                                                            | —                                             |
| mms-jux                  | sine                                                            | —                                             |
| mms-nested               | sine                                                            | —                                             |
| piece-harbour            | bd, cp, hh, sine, triangle                                      | —                                             |
| piece-foundry            | bd, cp, hh, oh, sawtooth, sine, triangle                        | —                                             |
| piece-lichen             | bd, cp, hh, sine, triangle                                      | —                                             |
| piece-night-bus          | bd, cp, hh, sine, triangle                                      | —                                             |
| piece-copper             | bd, cp, hh, sawtooth, sine, triangle                            | —                                             |
| piece-paper-lantern      | bd, cp, hh, sine, triangle                                      | —                                             |
| piece-tidal-stairs       | bd, cp, hh, sine, triangle                                      | —                                             |
| piece-glass-garden       | bd, cp, hh, sine, triangle                                      | —                                             |
| piece-relay              | bd, cp, hh, sawtooth, sine, triangle                            | —                                             |
| piece-slow-orbit         | bd, cp, hh, sine, triangle                                      | —                                             |
| piece-moss-radio         | bd, cp, hh, sine, triangle                                      | —                                             |
| piece-sundial            | bd, cp, hh, sawtooth, sine, triangle                            | —                                             |
| piece-kiln               | bd, cp, hh, sine, triangle                                      | —                                             |
| piece-blue-hour          | bd, cp, hh, sine, triangle                                      | —                                             |
| piece-switchyard         | bd, cp, hh, sawtooth, sine, triangle                            | —                                             |
| real-house               | bd, cp, oh, piano, sawtooth                                     | —                                             |
| real-techno              | bd, cp, hh, sawtooth                                            | —                                             |
| real-trance              | bd, oh, sawtooth, supersaw                                      | —                                             |
| real-dnb                 | bd, hh, sawtooth, sd                                            | —                                             |
| real-dubstep             | bd, hh, sawtooth, sd                                            | —                                             |
| real-ambient             | sine, triangle                                                  | —                                             |
| real-future-bass         | bd, hh, sd, sine, supersaw                                      | —                                             |
| real-synthwave           | bd, hh, sawtooth, sd, square                                    | —                                             |
| real-house-arranged      | bd, cp, hh, oh, piano, sawtooth, triangle                       | —                                             |
| real-house-vocals        | ade, bd, cp, hh, oh, piano, sawtooth, speech, triangle          | —                                             |
| real-custom-samples      | myvocal                                                         | myvocal                                       |
| real-dnb-arranged        | ade, bd, hh, oh, sawtooth, sd, speech, supersaw, triangle       | —                                             |
| real-dubstep-arranged    | ade, bd, hh, oh, sawtooth, sd, sine, speech, supersaw, triangle | —                                             |
