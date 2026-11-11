// ../import/src/runtime.mjs
import * as core from "@strudel/core";
import * as mini from "@strudel/mini";
import * as tonal from "@strudel/tonal";
import { transpiler } from "@strudel/transpiler";
async function evaluate({ source, fromCycle, toCycle }, run, query) {
  const events = [], labels = /* @__PURE__ */ new Map(), transforms = [];
  let phase = "evaluation", cps = 0.5, anonymous = 0, opaqueValues = false;
  mini.miniAllStrings();
  const scope = {
    ...core,
    ...mini,
    ...tonal,
    console: { log() {
    }, warn() {
    }, error() {
    } }
  };
  const scalar = (x) => core.isPattern(x) ? x.__pure : x;
  Object.assign(scope, {
    samples: async () => {
    },
    hush: () => core.silence,
    setcpm: (x) => {
      cps = scalar(x) / 60;
      return core.silence;
    },
    setcps: (x) => {
      cps = scalar(x);
      return core.silence;
    },
    all: (f) => {
      transforms.push(f);
      return core.silence;
    },
    sliderWithID: (_id, x) => x,
    slider: (x) => x,
    register: (...args) => {
      const result = core.register(...args);
      Object.assign(scope, core.strudelScope);
      return result;
    }
  });
  core.Pattern.prototype.p = function(name) {
    if (name.startsWith("_") || name.endsWith("_")) return core.silence;
    labels.set(name.includes("$") ? `${name}${anonymous++}` : name, this);
    return this;
  };
  for (const name of [
    "scope",
    "pianoroll",
    "punchcard",
    "spiral",
    "spectrum",
    "osc",
    "midi",
    "midin",
    "out",
    "output",
    "draw",
    "analyze"
  ]) {
    core.Pattern.prototype[name] = function() {
      return this;
    };
    scope[name] = () => core.silence;
  }
  const normalize = (value, seen = /* @__PURE__ */ new Set()) => {
    if (typeof value === "function") {
      opaqueValues = true;
      return "[function:unchecked]";
    }
    if (value === void 0) return "[undefined]";
    if (typeof value === "bigint") return String(value);
    if (typeof value === "number" && !Number.isFinite(value))
      return `[${value}]`;
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) {
      opaqueValues = true;
      return "[circular:unchecked]";
    }
    seen.add(value);
    const result = Array.isArray(value) ? value.map((x) => normalize(x, seen)) : Object.fromEntries(
      Object.keys(value).sort().map((k) => [k, normalize(value[k], seen)])
    );
    seen.delete(value);
    return result;
  };
  try {
    const code = transpiler(source).output;
    if (!run)
      run = async (code2, scope2) => {
        const AsyncFunction = Object.getPrototypeOf(
          async function() {
          }
        ).constructor;
        return new AsyncFunction(...Object.keys(scope2), code2)(
          ...Object.values(scope2)
        );
      };
    const result = await run(code, scope);
    let pattern = labels.size ? core.stack(...labels.values()) : result;
    for (const transform of transforms) pattern = transform(pattern);
    if (!core.isPattern(pattern))
      return { events: [], error: "Program did not produce a Pattern", phase };
    phase = "query";
    for (let cycle = Math.floor(fromCycle); cycle < toCycle; cycle++) {
      const state = new core.State(
        new core.TimeSpan(
          Math.max(cycle, fromCycle),
          Math.min(cycle + 1, toCycle)
        ),
        { _cps: cps }
      );
      const haps = query ? query(pattern, state) : pattern.query(state);
      if (haps.length + events.length > 1e5)
        throw Error("100000 event budget exceeded");
      for (const h of haps)
        events.push({
          cycle,
          whole: h.whole ? [Number(h.whole.begin), Number(h.whole.end)] : null,
          part: [Number(h.part.begin), Number(h.part.end)],
          value: normalize(h.value),
          hasOnset: h.hasOnset()
        });
    }
    return { events, error: null, opaqueValues };
  } catch (e) {
    return { events, error: e.message ?? String(e), phase, opaqueValues };
  }
}

// ../import/src/browser-worker.mjs
self.onmessage = async ({ data }) => {
  self.postMessage(await evaluate(data));
};
