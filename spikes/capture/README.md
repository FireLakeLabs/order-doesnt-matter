# Capture spike

Node 24.22.2, npm, no audio. All dependencies are exact in package.json and package-lock.json.

```sh
cd /home/aaron/projects/order-doesnt-matter/spikes/capture
npm ci --ignore-scripts
npm test
node capture.mjs seeds /home/aaron/projects/order-doesnt-matter/corpus/programs probes
node size-sweep.mjs
node report.mjs
```

`capture.mjs` accepts one or more directories of `.strudel` files; with no arguments it uses `seeds/`. It snapshots filenames when entering each directory. It loads tags from source comments and, if present, `../index.json`. It writes `results/<directory>--<program>.json` and `results/aggregate.json`. `probes/` contains intentional semantic counterexamples, separate from the 20 seeds. The size sweep synthesizes fixed-density chains and writes `results/size-sweep.json`. `report.mjs` produces tables and a cost chart from these saved measurements.

## What is instrumented

`instrument.mjs` reads **the installed 1.2.6 transpiler source**, adds two in-memory AST hooks and transfers original label metadata onto rewritten `.p()` calls. The upstream mini literal, mini-disable, label, samples-await, slider and widget passes run first; capture runs after them. It does not patch node_modules. The metadata walk enumerates original `CallExpression`s and labels, not compiler-inserted mini calls, constructors, or property reads. Content hashes plus duplicate occurrence numbers are reproducible site IDs; offset-only prefix edits preserve them. Editing a call's text or inserting an identical earlier call can change IDs. This is not incremental document identity.

A collision-free recorder identifier is chosen from the original AST. Direct argument/receiver site IDs and callback owner/argument positions supplement runtime identity edges. Aliased objects expose candidate producer lists, not exact variable use-def provenance.

Calls lower to a helper that retrieves the function before evaluating arguments, then invokes it with `Reflect.apply` and the original receiver. No call argument moves into a thunk; lexical `this`, `arguments`, await and evaluation order remain in their original function. Optional calls retain their chain and use a property-lookup mediator. Direct eval/super/private calls get result-only capture with a warning; eval code itself is not rewritten. Call errors are recorded and rethrown. Argument evaluation errors occur before the outer invocation and may leave the outer site unexecuted.

Function bodies get entry/finally/return reporting without replacing the function object or changing arity. Invocation records contain phase, argument producers, caller and query owner/cycle. Late station instances retain individual inputs/results, not a single static callback node. Function bodies with async/generator suspension are not claimed to have accurate nesting across suspension. Parameters evaluated before function entry are not independently traced as invocations.

The prototype alternative wraps all current own function-valued Pattern prototype properties and refreshes after `register`. It intentionally has no source spans and groups by method name. Own `pattern.query`, factories, constructors and bare exported functions are outside its coverage. Wrapping methods can itself be observed through function identity, arity and source inspection.

## Host and query bounds

Each program has a fresh worker, runs baseline/AST/prototype modes, and has a 20s parent deadline and 384MB V8 old-generation limit. VM timeouts cover synchronous evaluation (400ms) and individual low-level queries (80ms). These are containment for this experiment, **not** a security sandbox or a hard total memory bound.

Host: real core/mini/tonal, mini string coercion, REPL-like unique anonymous labels/muting, and ordered `all()` transforms. Samples, browser visuals/outputs, tempo scheduler and hush are stubs; tempo still supplies `_cps` (setcpm/60). Kabelsalat is replaced by an import hook whose audio constructor throws. No samples are fetched or decoded. Browser worklets, solo labels, `each()`, interactive widgets, external modules, persistent REPL state and a full scheduler are not implemented.

Every retained Pattern instance is offered integer-cycle queries 0 through 8, with 1.2s station time and 50,000 returned-event budgets per mode, at most 1,000 queried retained instances. Keep at most eight instances per source site (two per runtime method). Overflow counts and budget flags remain. More than 4,096 events in one query stops its sampling; count checks happen after the query allocates its result. The worker deadline/memory limit cover cases that do not return. The 1.2s cap is checked between instances, so one instance can overrun it by its bounded queries. Arrays are only sampled over nine cycles; no repeat detection is attempted.

Event records preserve whole/part fractions, value, context and stateful status. Full projected event multisets are hashed (SHA-256); up to 64 events per cycle are included for inspection. More events in the saved display sample is not itself a query-budget failure. Functions serialize to a marker and are explicitly flagged as opaque. Context locations are included. Equality is finite-window equality of this projection, not proof of function behavior, infinite-time equality, audible equality or trigger behavior.

`comparison.astEqualsBaseline`/`runtimeEqualsBaseline` can be true for matching query failures. Require `fullyChecked` for a complete nine-cycle comparison, and inspect `functionBehaviorUnchecked` before interpreting it. `astUnaffectedByStationQueries` compares first/final observations after the extra station queries; impure programs intentionally fail. The second pass also queries again, so this identifies impurity, not its exact cause.

Evaluation overhead uses five alternating-order warmed runs per mode and excludes parsing, worker/module startup and query cost. Compile times are single cold observations. Capturing stations queries receivers and intermediates repeatedly and is deliberately more expensive than querying only the final result. Measurements are machine-specific, bounded and not a production latency promise.
