# Import/generate proof

`../corpus.test.ts` reads each indexed program **in place**. Original and fresh
programs run in independent Node workers with five-second wall budgets. Every
program uses at least [0,16), the indexed inclusive horizon is respected, and
all 13 `real-*` programs use at least [0,17). Plain events include whole/part
spans, values and onsets; tempo and opaque-value flags are also compared.

`tier3-baseline.json` was derived by taking `id` and `tiers["3"]` from the
`reports` arrays in `spikes/import/results.json` (72 entries) and
`spikes/import/study-02-results.json` (13 non-local entries), excluding entries
with `localOnly: true`. The test asserts exactly the 85 indexed IDs are present.
The table contains counts only, without copying sources, imported documents or
generated programs. Production and tests import no spike modules.

`metrics.ts` counts semantic boundaries: one per pattern core, setting, rewrite,
opaque layer, literal/opaque argument, setup, tempo or global transform. Voice,
shared-definition and settings-bag containers are excluded. This corresponds to
the spike's boundary counts, with tempo now an explicit understood node in the
production contract. Mini steps are typed but do not inflate the coverage count.
Tier-3 limits include opaque arguments, which have no `Meta` in the contract.

The three qualified inputs are asserted explicitly. The immediate query failure
has no events; the late failure retains three prior cycle windows; bare strings
have function-bearing values whose marked projection is compared, without a
claim about those functions' behavior. All other inputs must complete without
errors or opaque values.

For `only`, events are compared as multisets with multiplicity retained. Global
transforms are kept on every isolated program. The corpus's `all(p=>p.slow(2))`
distributes over its voices, and its isolated event union is asserted too. This
is not a general claim that arbitrary user transforms distribute over stack.

The local-only composition is read only when its external file exists. Assertions
compare booleans rather than dumping either document or program on failure. No
snapshot, copied composition, imported document or generated source is written.
An absent local file is a reported skipped test.

The browser canary bundles the same import/generate/evaluate entry with Vite.
There is no browser worker in this wave. In-process queries serialize host
installation but cannot interrupt synchronous user code. Node callers needing
a wall budget use `queryEventsNode`. These are score checks with external effects
stubbed; they do not check audio, decoded samples, room tails or a browser UI.
