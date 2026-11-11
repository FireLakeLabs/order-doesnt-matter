import * as controls from "@strudel/core/controls.mjs";
import { Pattern as StrudelPattern } from "@strudel/core/pattern.mjs";
import State from "@strudel/core/state.mjs";
import TimeSpan from "@strudel/core/timespan.mjs";

// Boundary adapter: discover canonical keys by asking each registered control
// for its bag. The public registry exposes membership but not its alias map.
type Control = (value: number) => {
  query(state: State): { value: Record<string, unknown> }[];
};
const exported: Record<string, unknown> = controls;
export const controlNames = new Map<string, string>();
for (const [name, fn] of Object.entries(exported)) {
  if (!controls.isControlName(name) || typeof fn !== "function") continue;
  const bag = (fn as Control)(0).query(new State(new TimeSpan(0, 1)))[0]?.value;
  const canonical = bag && Object.keys(bag)[0];
  if (canonical) controlNames.set(name, canonical);
}
// Some registered canonical names (duckorbit in 1.2.6) are prototype-only.
for (const name of Object.getOwnPropertyNames(StrudelPattern.prototype)) {
  if (controls.isControlName(name) && !controlNames.has(name))
    controlNames.set(name, name);
}
export const canonicalName = (name: string) => controlNames.get(name) ?? name;
export const tierOneControls = new Set(
  `s note n gain velocity lpf hpf lpq hpq pan delay delaytime delayfeedback room roomsize orbit attack decay sustain release speed begin end cut clip legato vowel crush distort shape scale`
    .split(" ")
    .map(canonicalName),
);
export const signals = new Set(
  "sine cosine saw isaw tri square perlin rand irand time".split(" "),
);
export const rewrites = new Set(
  "fast slow early late rev ply euclid euclidRot degradeBy sometimes sometimesBy often rarely every firstOf off jux superimpose layer struct mask".split(
    " ",
  ),
);
export const groups = new Set(["stack", "cat", "seq", "arrange"]);

export const patternMethods = new Set(
  Object.getOwnPropertyNames(StrudelPattern.prototype),
);
