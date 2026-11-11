Original source CallExpression sites; program-level tags overlap. Q = at least one retained instance completed all nine cycles. N = non-pattern (including functions). E = failed call or no complete Pattern snapshot, including timeouts. Sites that overflow later can still qualify as Q.

| Tag | Programs | Sites | Q | N | Never | E | Verdict | Evidence |
|---|---:|---:|---:|---:|---:|---:|---|---|
| G1 | 23 | 506 | 506 (100.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | shown | Seed 02; corpus trees/arrange/pieces |
| G2 | 19 | 111 | 109 (98.2%) | 1 (0.9%) | 1 (0.9%) | 0 (0.0%) | shown degraded | Seeds 03–08: eager/lazy, nested and capped instances |
| G3 | 28 | 533 | 514 (96.4%) | 14 (2.6%) | 4 (0.8%) | 1 (0.2%) | shown degraded | Seeds 09–10; source/eval/alias counterexamples |
| G4 | 15 | 72 | 71 (98.6%) | 1 (1.4%) | 0 (0.0%) | 0 (0.0%) | shown | Seed 11: pattern arguments and continuous lane |
| G5 | 5 | 38 | 36 (94.7%) | 2 (5.3%) | 0 (0.0%) | 0 (0.0%) | shown degraded | Seed 12: anonymous/named/muted roots + all; partial REPL |
| S1 | 5 | 37 | 22 (59.5%) | 12 (32.4%) | 2 (5.4%) | 1 (2.7%) | shown degraded | Seed 13: awaiting and tempo controls; external effects stubbed |
| S2 | 3 | 14 | 13 (92.9%) | 0 (0.0%) | 1 (7.1%) | 0 (0.0%) | out of scope | Seed 14: trigger callback ran 0 times; visuals/outputs stubbed |
| Q1 | 5 | 22 | 8 (36.4%) | 9 (40.9%) | 2 (9.1%) | 3 (13.6%) | shown degraded | Seed 15 reports errors; swallowed-query hides an inner failure |
| Q2 | 6 | 12 | 10 (83.3%) | 0 (0.0%) | 0 (0.0%) | 2 (16.7%) | shown degraded | Seeds 16–18: timeout, impurity and nontermination |
| Q3 | 4 | 17 | 15 (88.2%) | 2 (11.8%) | 0 (0.0%) | 0 (0.0%) | shown degraded | Seed 19: unit/speed/slices queried; decoded duration absent |
| T1 | 12 | 48 | 46 (95.8%) | 2 (4.2%) | 0 (0.0%) | 0 (0.0%) | shown degraded | Nine-cycle windows only; every/slow/polymeter |
| T2 | 5 | 25 | 25 (100.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | shown degraded | Random/sometimes/perlin samples, no repeat claim |
| T3 | 17 | 470 | 470 (100.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | shown degraded | 300/301-cycle arrange: only first nine cycles |
| T4 | 4 | 17 | 17 (100.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | shown degraded | Finite sample cannot establish periodicity |
| E1 | 3 | 13 | 13 (100.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | shown | Eight source sites flagged continuous; bare sine has final root only |
| E2 | 9 | 40 | 40 (100.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | shown | 132 source sites flagged fragments |
| E3 | 23 | 497 | 497 (100.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | shown | Stack/chords/long notes preserve whole and part |
| E4 | 6 | 20 | 19 (95.0%) | 0 (0.0%) | 0 (0.0%) | 1 (5.0%) | shown degraded | fast(20000) timeout; dense 64 succeeds; capped instances |
| E5 | 4 | 12 | 12 (100.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | shown | Bare numbers/strings returned as values |
| C1 | 4 | 18 | 18 (100.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | shown degraded | Observed control bags; no exhaustive schema validation |
| C2 | 4 | 21 | 21 (100.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | shown degraded | Arrays/colon values captured; function values opaque |
| A1 | 7 | 171 | 171 (100.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | shown degraded | FX metadata recorded; no ordered-audio verification |
| A2 | 13 | 326 | 326 (100.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | out of scope | Orbit settings visible; shared audio rooms untested |
| A3 | 2 | 14 | 14 (100.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | out of scope | Cut/duck settings visible; cross-note state untested |
| A4 | 20 | 473 | 473 (100.0%) | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) | out of scope | Score durations captured; release/tails unheard |

| Stations | AST all-station query ms, median [range] | Runtime sampled query ms, median [range] | Events in AST run |
|---:|---:|---:|---:|
| 4 | 10.2 [8.51–15.83] | 58.59 [57.41–87.1] | 144 |
| 8 | 19.65 [18.16–20.49] | 55.66 [54.54–57.13] | 288 |
| 16 | 42.95 [39.06–46.16] | 55.58 [53.94–59.44] | 576 |
| 32 | 106.86 [102.81–109.56] | 52.94 [51.23–57.69] | 1152 |
| 64 | 280.05 [277.62–289.15] | 51.13 [49.26–52.52] | 2304 |

Runtime retains only two instances per **method name**, so its sweep queries are not equivalent all-station coverage. Sweep: five fresh workers per size, four events/cycle, nine cycles/station, no query failures or budget hits. See raw JSON for all evaluation repetitions.
