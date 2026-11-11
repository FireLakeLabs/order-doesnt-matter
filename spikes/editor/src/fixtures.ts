import type {
  Doc,
  Pattern,
  Step,
  Voice,
  Layer,
  Setting,
  Core,
} from "../../import/src/document";
let serial = 0;
export const id = () => `e${++serial}`;
export function pattern(
  core: Core,
  layers: Layer[] = [],
  tier: 1 | 2 | 3 = 1,
): Pattern {
  return { id: id(), tier, core, layers };
}
export function constant(value: number | string | boolean) {
  return pattern({ kind: "constant", value });
}
export function sequence(steps: Step[]) {
  return pattern({ kind: "sequence", steps, notation: "" });
}
export function setting(name: string, value: Pattern): Setting {
  return { id: id(), tier: 1, name, value };
}
export function bag(settings: Setting[]): Layer {
  return { id: id(), tier: 1, kind: "settings", settings };
}
export function shell(
  name: string,
  values: (string | number | boolean)[] = [],
): Layer {
  return {
    id: id(),
    tier: 1,
    kind: "rewrite",
    name,
    args: values.map((value) => ({ kind: "literal", value })),
  };
}
export function voice(name: string, n = 0): Voice {
  return {
    id: id(),
    tier: 1,
    name,
    muted: false,
    pattern: pattern(
      {
        kind: "sequence",
        notation: "",
        steps: [
          { kind: "value", value: String(48 + (n % 12)), weight: 2 },
          {
            kind: "sub",
            steps: [
              { kind: "value", value: String(55 + (n % 9)) },
              { kind: "rest" },
            ],
          },
          {
            kind: "alternate",
            steps: [
              { kind: "value", value: String(60 + (n % 8)) },
              { kind: "value", value: String(67 + (n % 5)) },
            ],
          },
        ],
      },
      [
        bag([
          setting(
            "s",
            constant(["triangle", "sine", "sawtooth"][n % 3] ?? "sine"),
          ),
          setting("gain", constant(0.3)),
          setting(
            "lpf",
            n % 3 === 0
              ? pattern({ kind: "signal", shape: "sine" }, [
                  shell("range", [300, 2600]),
                  shell("slow", [2]),
                ])
              : n % 3 === 1
                ? sequence([
                    { kind: "value", value: "600", weight: 2 },
                    { kind: "value", value: "2200" },
                  ])
                : constant(1400),
          ),
          setting("pan", constant(0.2 + (n % 4) * 0.2)),
        ]),
        shell("fast", [1]),
        bag([
          setting("room", constant(0.25)),
          setting("roomsize", constant(n === 1 ? 1.2 : 0.4)),
          setting("orbit", constant(1 + Math.floor(n / 4))),
        ]),
        shell("late", [0.0625]),
      ],
    ),
  };
}
function doc(voices: Voice[]): Doc {
  return { tempo: { cpm: 32 }, setup: [], shared: {}, voices };
}
const names = [
  "lead",
  "bass",
  "bell",
  "reed",
  "spark",
  "pad",
  "glass",
  "pulse",
  "copper",
  "drift",
  "tide",
  "dust",
  "moss",
  "chime",
  "hush",
  "bloom",
  "grain",
  "glow",
  "air",
  "shore",
];
const many = (n: number) =>
  doc(
    names.slice(0, n).map((name, i) => {
      const v = voice(name, i);
      const inner = pattern(v.pattern.core);
      v.pattern.core = {
        kind: "generator",
        name: "note",
        args: [{ kind: "pattern", pattern: inner }],
      };
      return v;
    }),
  );
const kinds = many(3);
if (kinds.voices[1])
  kinds.voices[1].pattern.core = {
    kind: "generator",
    name: "note",
    args: [{ kind: "literal", value: "48" }],
  };
if (kinds.voices[1])
  kinds.voices[1].pattern.layers.unshift(shell("euclid", [3, 8]));
if (kinds.voices[2])
  kinds.voices[2].pattern = pattern(
    { kind: "opaque", code: 'note("60 67 72").s("sine").degradeBy(0.2)' },
    [],
    3,
  );
const deep = many(3);
const deepVoice = deep.voices[0];
if (deepVoice) {
  const speed = sequence([
    { kind: "value", value: "1" },
    { kind: "value", value: "2" },
  ]);
  const middle = pattern({ kind: "signal", shape: "saw" }, [
    shell("range", [1, 6]),
    {
      id: id(),
      tier: 2,
      kind: "rewrite",
      name: "fast",
      args: [{ kind: "pattern", pattern: speed }],
    },
  ]);
  const nested = pattern({ kind: "signal", shape: "sine" }, [
    shell("range", [200, 4000]),
    {
      id: id(),
      tier: 2,
      kind: "rewrite",
      name: "slow",
      args: [{ kind: "pattern", pattern: middle }],
    },
  ]);
  const first = deepVoice.pattern.layers[0];
  if (first?.kind === "settings")
    first.settings = first.settings.filter((s) => s.name !== "lpf");
  deepVoice.pattern.layers.unshift(bag([setting("lpf", nested)]));
}
const conflict = many(3);
export const fixtures = [
  { id: "three", name: "01 · Small hours / 3 voices", doc: many(3) },
  { id: "eight", name: "02 · Glass garden / 8 voices", doc: many(8) },
  {
    id: "twenty",
    name: "03 · After-hours ensemble / 20 voices",
    doc: many(20),
  },
  { id: "rhythms", name: "04 · Three kinds of rhythm", doc: kinds },
  { id: "nested", name: "05 · Drivers, three deep", doc: deep },
  { id: "rooms", name: "06 · A shared-room conflict", doc: conflict },
];
