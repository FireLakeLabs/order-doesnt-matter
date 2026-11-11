# D2/D3: bounded corpus proof

**69/72 programs completed with identical plain-data events; all 72 matched their event/error projections.** There are no observed import/generate mismatches. Two inputs deliberately throw; one contains function-bearing Pattern values, so projection equality cannot prove its value behavior. **Idempotence: 72/72**, removing only IDs/spans. All 15 full pieces and all 15 MMS adaptations completed event equivalence.

Measured: pinned Strudel 1.2.6, Node 24.22.2, independent original/generated workers, direct low-level queries, numeric whole/part spans, onsets and canonical event bags as multisets separately for cycles **[0,16)**. Each worker has a five-second wall budget; query errors remain errors. [Raw results](results.json), [generated programs](generated/), [imported documents](out/), [method/API](README.md).

## Coverage

Nodes count cores, setters, rewrites, literal arguments, global transforms and opaque boundaries once; containers and individual mini steps are excluded. A sequence counts once. Tier 1 assumes the requested editors; this spike does not implement them. These constructed fixtures do not estimate the distribution of public Strudel music. “≤2” includes entirely tier-1 programs.

| Corpus       | Programs | Tier-1 nodes | Tier-2 nodes | Tier-3 nodes | Entirely 1 | Entirely ≤2 | Any 3 |
| ------------ | -------: | -----------: | -----------: | -----------: | ---------: | ----------: | ----: |
| All          |       72 |         1379 |           37 |           10 |         39 |          65 |     7 |
| Full pieces  |       15 |          919 |            9 |            0 |         10 |          15 |     0 |
| MMS-derived  |       15 |          116 |           11 |            0 |          4 |          15 |     0 |
| Nasty micros |       42 |          344 |           17 |           10 |         25 |          35 |     7 |

Ten most common tier-2 names; equal counts break alphabetically:

| Name       | Nodes |
| ---------- | ----: |
| FX         |     8 |
| chunk      |     2 |
| coarse     |     2 |
| seed       |     2 |
| add        |     1 |
| all        |     1 |
| bandf      |     1 |
| duckattack |     1 |
| duckdepth  |     1 |
| duckorbit  |     1 |

Every tier-3 reason encountered in these 72 inputs:

| Reason             | Count | Example                                                                       |
| ------------------ | ----: | ----------------------------------------------------------------------------- |
| Register body      |     1 | `register('ghosts', (amount, pat) => pat.off(1/8, p => p.gain(amount)))`      |
| Awaited setup      |     2 | `await samples('github:tidalcycles/dirt-samples')`                            |
| Setup effect       |     1 | `hush()`                                                                      |
| Side-effect output |     4 | `.onTrigger(() => console.log('a note was triggered'))`                       |
| Hand-built Pattern |     2 | `new Pattern(() => { throw new Error('corpus intentional query failure'); })` |

## Equivalence qualifications

These are the only three incomplete proofs; none is attributed to import/generate. Original and generated behavior matched up to the same qualification.

| Input                   | Smallest reproduction                                                             | Attribution                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| micro-query-throws      | `new Pattern(()=>{throw Error('x')})`                                             | Inherent input: immediate query error                                                                                |
| micro-query-late-throws | `new Pattern(s=>{if(+s.span.begin>=3)throw Error('x');return note(60).query(s)})` | Inherent input: error at cycle 3; three prior windows match                                                          |
| micro-bare-strings      | `pure("north")`                                                                   | Inherent Pattern-valued event under double-quote transpilation; harness marks functions, cannot prove their behavior |

## Draft-shape pressure

The original draft is untouched. [Copied shape](src/document.ts) differences and remaining proposals:

| Construct quoted                                     | Implemented representation                                  | Smallest proposed shape change                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `partials([1,.5,0,.25])`, `.lfo({rate:4})`           | JSON-valued literal args; `data` core for setter values     | Broaden literal values; add data core                                                 |
| `all(p=>p.slow(2))`                                  | Optional `Doc.transforms`                                   | Explicit global transforms                                                            |
| Setup interleaved with definitions/voices            | Optional `Doc.order`                                        | Ordered top-level references                                                          |
| `p=>p.off(.1,q=>q.rev())`                            | Optional callback `parameter` retained                      | Store binding name; later add lexical binding IDs                                     |
| `hats:` with canonical `$:` output                   | Generated metadata comment retains name/muting              | No shape change; retain voice metadata in generated format                            |
| `"{bd cp hh}%4"`, `"bd(3,8)"`, random/stretch syntax | Recognised PEG structure, preserved with draft `Step.other` | Add typed polymeter/euclid/random/stretch step variants before building their editors |
| `irand(24)`                                          | Tier-1 generator rather than argument-free signal           | Optional signal arguments                                                             |

Numeric-only arithmetic folds safely. Duplicate controls remain separate layers; rhythmic setters never cross rewrites. Implicit-target `lfo` freezes its predecessor as an ordered setter; FX stays ordered. Opaque source is retained verbatim. Compiler directives and top-level mutable/control-flow programs conservatively retain the whole program.

## Cost and limits

Seven warmed samples/program, alternating import/generate order; outputs consumed and checked. No comparative speed claim. Parsing/allocation dominate the separate diagnostic profile. [Per-program median/worst samples](TIMINGS.md), [measurement limits](BENCHMARK.md).

| Operation | Median of program medians | Worst program median | Worst individual sample |
| --------- | ------------------------: | -------------------: | ----------------------: |
| Import    |                  0.164 ms |             0.768 ms |                1.809 ms |
| Generate  |                  0.013 ms |             0.044 ms |                0.088 ms |

**37 fast behavior tests**, TypeScript and browser bundling pass. No audio was heard; no browser UI, decoded samples, trigger scheduling, room/tail behavior, future cycles or arbitrary impure JavaScript equivalence was checked. External effects are stubbed. Swallowed inner query errors remain an engine limitation. D2/D3 are supported for this bounded score study, not universally proved for JavaScript.
