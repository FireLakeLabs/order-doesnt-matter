**No universal guarantee.** A useful implementation can show source-mapped snapshots for pure, terminating Strudel, including calls it does not understand. Lazy callbacks form a sampled family of station instances, not one permanent score. Arbitrary JavaScript can observe instrumentation, mutate on observation, generate uninstrumented code, or never return.

Measured on Node 24.22.2, pinned Strudel 1.2.6: **20 seeds + 72 corpus files present at directory enumeration + five counterexample probes**. No audio. [Raw results](results/aggregate.json), [implementation/limits](README.md), [measurement qualifications](BENCHMARK.md). Nine behavior tests pass, including evaluation order, getter/receiver binding, lexical eval, optional chaining, graph edges, upstream rewrites, roots, errors and nontermination.

Across **861 original call sites**, 831 (96.5%) yielded at least one complete nine-cycle Pattern snapshot; 20 (2.3%) yielded non-patterns, including two functions; five (0.6%) never ran; five (0.6%) failed calls or snapshotting. The latter includes two thrown-query sites and two timeouts. Eighteen sites carry instance/budget flags; a successful snapshot does not mean every later instance was retained. Tag counts below include every call in each tagged program; tags overlap. Constructors and compiler-generated mini calls are excluded from call-site denominators.

Callbacks were measured with constant and patterned arguments. Counts below distinguish construction from the first final-pattern query over cycles 0–8; querying intermediate stations causes further invocations.

| Callback | Construction | First final-query pass | Inner stations live? |
|---|---:|---:|---|
| off | Scalar: 1; patterned offset: 0 | Scalar: 0; patterned: 9 | Yes; patterned/nested instances sampled |
| jux | 1 | 0 | Yes, eager transform |
| superimpose | 1/function | 0, or 9 nested under lazy off | Yes, contextual instances |
| layer | 1/function | 0 | Yes, separate branches |
| every / firstOf | Constant: 1; patterned: 0 | Constant: 0; patterned: 9 | Yes; retained variants |
| sometimes | 0 | 18 | Query-time family; 261 invocations across capture |
| when | Constant true: 1; patterned: 0 | Constant: 0; patterned: 4 | Yes; false branches may never run |
| within | Constant: 1; patterned: 0 | Constant: 0; patterned: 9 | Yes; retained variants |
| User function | 2 explicit calls | 0 | Yes; unused body remains unexecuted |
| register body | Patterned parameter: 0 | 9 | Yes; original function arity preserved |

Five warmed, alternating evaluation repetitions per program measured median baseline/AST/prototype evaluation at **0.378/0.423/0.652 ms**; median paired added costs were **0.044/0.270 ms**. AST all-station capture had median **13 ms**, maximum **142 ms** across inputs. The controlled sweep below measures increasing depth at fixed density. Profiling found allocation/GC, control merges and nested queries. Background browser load was substantial; these untuned, differently sampled approaches do **not** establish a speed winner. Small, debounced recapture seems plausible; arbitrary all-station per-keystroke capture does not. Keystroke/render/audio latency was not measured.

Both approaches matched all **87 completed seed/corpus event projections**. Five programs could not complete comparison; four completed programs contain opaque functions. Across all inputs, 92 comparisons completed: AST changed the function-source probe; prototype wrapping changed the prototype-source probe. Comparison includes whole/part/value/context/stateful projections, with opaque function markers. It proves neither function behavior nor future cycles. Additional station queries changed impure seed 17.

Prototype wrapping catches methods inside library implementation and generated eval code. AST catches bare factories, stack arguments, ordinary calls, callback phases, source spans and root boundaries. Runtime groups by method name, lacks source identity, and misses own query functions/factories. Its cheaper sampled sweep does less work.

| Small reproduction / evidence | Failure |
|---|---|
| `function f(){return 60}; note(f.toString().includes('__capture')?72:f())` | AST changes note 60 → 72; function-source probe |
| Inspect `Pattern.prototype.fast.toString()` for `runtimeCount` | Prototype wrapping changes note 60 → 72 |
| `let c=0; pure(0).withValue(()=>++c)`; seed 17 equivalent | Extra queries change subsequent score |
| `note('c3 d3 e3 g3').fast(20000)` | 80 ms query timeout |
| `identity(new Pattern(()=>{while(true){}}))` | Nonterminating query interrupted |
| `eval('note(60).fast(2)')` | AST sees eval result, misses inner stations; runtime catches fast |
| `const a=note(60), b=(p=>p)(a); stack(a,b)` | Identity edges have multiple candidate producers |
| `eval('new Pattern(()=>new Pattern(()=>{throw Error(1)}).queryArc(0,1))')` | Outer low-level query succeeds silently; inner failure already swallowed |

Measured evidence supports the verdicts below. Reasoned limits include unstable identity under edits and inaccurate async/generator nesting across suspension. Unchecked: audible behavior, decoded sample durations, trigger effects, browser visuals, external imports, full REPL state and behavior beyond nine cycles.

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
