# One-way Strudel import study

Run with Node **24.22.2**, from this directory:

```sh
npm ci
npm run check
npm run corpus
npm run build
```

`src/index.ts` is the stable public ESM entry. It exports `importStrudel(source)`,
`generate(doc)` and async `queryEvents(source, fromCycle, toCycle)`, plus the
spike's document and event types. Import/generate are synchronous and do not
execute the input. Acorn supplies JavaScript structure; Strudel's pinned PEG mini
parser supplies string structure. Control membership and canonical names come
from the installed runtime registry, including prototype-only canonical names.
Numeric-only +, -, \*, / and unary signs fold without evaluating JavaScript.

`queryEvents` runs fresh, audio-free Strudel in a worker, with a five-second wall
budget including imports. Node also bounds evaluation to 500 ms and each direct
`Pattern.query(State)` to 250 ms. The event cap is 100,000. `error: null` means a
successful answer, including silence; non-null errors retain the phase and any
already collected events. Spans are numeric `[begin,end]` tuples and whole is
null for continuous signals. `cycle` identifies the query window. Values can be
primitives, arrays or objects. Function/circular values use explicit markers and
set `opaqueValues`; their behavior was not compared. This is **not a security
sandbox** for untrusted code.

The host emulates REPL labels (including muting, anonymous voices and named
replacement), tempo and `all()`. Sample loading, hush, visuals, MIDI/OSC and audio
outputs are stubs. No trigger callbacks or scheduler run. Node intercepts the
published core's browser-only Kabelsalat import with an inert class; the browser
bundle retains the real browser module but never starts audio. The build produces
`build/index.js` and a browser worker, and retains its Node adapter. Bundling is
verified; no browser interaction or audio was checked in this spike.

The original `spikes/document.ts` remains untouched. `src/document.ts` is a copied
shape with documented extensions: JSON literal arguments, data cores, optional
callback parameter names, ordered top-level execution and global transforms.
Generation accepts draft documents without those optional fields too. Editors
should use the types exported by this module for extended imported documents.
When an editor adds nodes, generation also emits nodes absent from the imported
execution map. Voice name metadata lives in generated Acorn-readable comments;
active voices use `$:` and muted ones `_$:`. Strings deliberately use double
quotes for mini patterns and single quotes for JavaScript literals, matching the
pinned transpiler. Generated code never embeds an original-source backup.

Adjacent independent setters share a settings layer. Duplicate canonical keys
start a new layer. Rewrites and opaque calls are barriers. Before implicit-target
`lfo`, the immediately preceding setter becomes an ordered rewrite, so sorting
the remaining bag cannot change its target. `FX` stays an ordered stage. `scale`
is tier 1 but remains ordered because it is not a registered control setter.
Unknown computations become exact source at a core/layer/argument/setup
boundary. Compiler directives and top-level mutable/control-flow programs stay
as a single opaque setup fragment. Some finite lexical forms are supported;
this study does not establish a universal semantics-preserving JavaScript
refactor. Opaque imported code should be reviewed before execution.

`npm run corpus` rewrites all 72 `out/<id>.json` documents and
`generated/<id>.strudel` files, plus `results.json` and `TIMINGS.md`. It checks
whole/part/value/onset multisets **per cycle over [0,16)**, with independently
constructed original/generated workers. Engine control bags already carry
canonical keys; context/source locations are excluded. It checks structural
idempotence after removing only IDs and source spans. Equality of marked
function values or matching errors is reported separately from completed event
equality. Tier accounting counts each core, setter, rewrite, literal argument,
global transform and opaque setup/argument/layer once; voice/settings-layer
containers and individual mini steps are excluded. A sequence is one node;
`Step.other` preserves recognised complex mini syntax, not an extra tier-3 node.
The tier-1 editors are assumed, not implemented or usability-tested here.
