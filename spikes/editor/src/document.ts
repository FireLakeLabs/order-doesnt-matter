import type {
  Doc,
  Pattern,
  Layer,
  Setting,
  Voice,
  Step,
  Arg,
  Opaque,
} from "../../import/src/document";
export type {
  Doc,
  Pattern,
  Layer,
  Setting,
  Voice,
  Step,
} from "../../import/src/document";
import { humanName, song } from "./song";
import { fixtures } from "./fixtures";
export type Target = {
  id: string;
  voice: Voice;
  node: Pattern | Layer | Setting | Voice | Opaque;
  label: string;
  path: string[];
  pattern: Pattern;
  parent?: Pattern;
  layerIndex?: number;
  setting?: Setting;
};
export function targets(doc: Doc): Target[] {
  const out: Target[] = [];
  for (const v of doc.voices) {
    const voiceName = /^[\$_]+$/.test(v.name) ? humanName(v.pattern) : v.name;
    out.push({
      id: v.id,
      voice: v,
      node: v,
      label: voiceName,
      path: [voiceName],
      pattern: v.pattern,
    });
    const seen = new Set<string>();
    function walk(
      p: Pattern,
      path: string[],
      parent?: Pattern,
      context?: Setting,
    ) {
      if (seen.has(p.id)) return;
      seen.add(p.id);
      const label =
        p.label ??
        (p.core.kind === "ref" ? p.core.name : undefined) ??
        (p.core.kind === "signal"
          ? `${p.core.shape} wave`
          : p.core.kind === "sequence"
            ? "typed sequence"
            : p.core.kind === "opaque"
              ? "source · not modelled"
              : p.core.kind === "generator"
                ? p.core.name
                : p.core.kind);
      const author =
        p.label ?? (p.core.kind === "ref" ? p.core.name : undefined);
      const contextPath =
        author && path.at(-1) !== author ? [...path, author] : path;
      out.push({
        id: p.id,
        voice: v,
        node: p,
        label,
        path: [...contextPath, label],
        pattern: p,
        parent,
        setting: context,
      });
      p.layers.forEach((l, i) => {
        out.push({
          id: l.id,
          voice: v,
          node: l,
          label:
            l.kind === "rewrite"
              ? l.name
              : l.kind === "opaque"
                ? "source layer"
                : "settings bag",
          path: [
            ...contextPath,
            l.kind === "rewrite"
              ? l.name
              : l.kind === "opaque"
                ? "source layer"
                : `settings ${i === 0 ? "before rewrites" : "between rewrites"}`,
          ],
          pattern: p,
          layerIndex: i,
          setting: context,
        });
        if (l.kind === "settings")
          for (const s of l.settings) {
            out.push({
              id: s.id,
              voice: v,
              node: s,
              label: s.name,
              path: [...contextPath, s.name],
              pattern: s.value,
              parent: p,
              layerIndex: i,
              setting: s,
            });
            walk(s.value, [...contextPath, s.name], p, s);
          }
        if (l.kind === "rewrite")
          l.args.forEach((a, j) =>
            arg(
              a,
              [...contextPath, `${l.name} › argument ${j + 1}`],
              p,
              context,
            ),
          );
      });
      if (p.core.kind === "group")
        p.core.parts.forEach((x, i) =>
          walk(
            x.pattern,
            [
              ...contextPath,
              x.pattern.label ??
                (x.pattern.core.kind === "ref"
                  ? x.pattern.core.name
                  : humanName(x.pattern)),
            ],
            p,
          ),
        );
      if (p.core.kind === "generator")
        p.core.args.forEach((a, j) =>
          arg(
            a,
            [
              ...contextPath,
              `${p.core.kind === "generator" ? p.core.name : "call"} › argument ${j + 1}`,
            ],
            p,
            context,
          ),
        );
      if (p.core.kind === "ref" && doc.shared[p.core.name])
        walk(doc.shared[p.core.name]!, [...contextPath, p.core.name], p);
    }
    function arg(a: Arg, path: string[], p: Pattern, s?: Setting) {
      if (a.kind === "pattern") walk(a.pattern, path, p, s);
      if (a.kind === "callback") walk(a.body, path, p, s);
    }
    walk(v.pattern, [voiceName]);
  }
  const base = doc.voices[0] ?? {
    id: "setup-voice",
    tier: 3 as const,
    name: "program",
    muted: false,
    pattern: {
      id: "setup-pattern",
      tier: 3 as const,
      core: { kind: "opaque" as const, code: "" },
      layers: [],
    },
  };
  for (const [i, o] of doc.setup.entries())
    out.push({
      id: o.id,
      voice: base,
      node: o,
      label: `setup ${i + 1} · source`,
      path: ["program", `setup ${i + 1}`],
      pattern: base.pattern,
    });
  for (const [name, p] of Object.entries(doc.shared)) {
    if (!out.some((t) => t.id === p.id)) {
      const virtual = {
        ...base,
        id: "shared-" + p.id,
        name: "shared " + name,
        pattern: p,
      };
      out.push(
        ...targets({
          ...doc,
          setup: [],
          transforms: [],
          voices: [virtual],
          shared: {},
        }).filter((t) => t.id !== virtual.id),
      );
    }
  }
  for (const x of doc.transforms ?? []) {
    out.push({
      id: x.id,
      voice: base,
      node: { ...x, kind: "rewrite" },
      label: "all",
      path: ["program", "all · global rewrite"],
      pattern: base.pattern,
    });
    for (const a of x.args) {
      const p =
        a.kind === "pattern"
          ? a.pattern
          : a.kind === "callback"
            ? a.body
            : undefined;
      if (p) {
        const virtual = {
          ...base,
          id: "global-" + p.id,
          name: "global all",
          pattern: p,
        };
        out.push(
          ...targets({
            ...doc,
            setup: [],
            transforms: [],
            voices: [virtual],
            shared: {},
          }).filter((t) => t.id !== virtual.id),
        );
      }
    }
  }
  return out;
}
export function update(
  doc: Doc,
  targetId: string,
  fn: (t: Target) => void,
): Doc {
  const next = structuredClone(doc);
  const t = targets(next).find((x) => x.id === targetId);
  if (!t) throw Error("Selection no longer exists");
  fn(t);
  return next;
}
function allocate(doc: Doc): () => string {
  const used = new Set(targets(doc).map((t) => t.id));
  let n = 0;
  return () => {
    let id: string;
    do {
      id = `edit-${++n}`;
    } while (used.has(id));
    used.add(id);
    return id;
  };
}
export function addVoice(doc: Doc): Doc {
  const d = structuredClone(doc),
    v = structuredClone(fixtures[0]!.doc.voices[0]!),
    next = allocate(d);
  function assign(x: unknown) {
    if (!x || typeof x !== "object") return;
    if ("id" in x && "tier" in x) x.id = next();
    for (const y of Object.values(x))
      if (Array.isArray(y)) y.forEach(assign);
      else if (y && typeof y === "object") assign(y);
  }
  assign(v);
  v.name = `voice ${d.voices.length + 1}`;
  v.muted = false;
  d.voices.push(v);
  d.order?.push({ kind: "voice", index: d.voices.length - 1 });
  return d;
}
export function addSetting(doc: Doc, voiceId: string, name: string): Doc {
  const next = allocate(doc);
  return update(doc, voiceId, (t) => {
    t.pattern.layers.push({
      id: next(),
      tier: 1,
      kind: "settings",
      settings: [
        {
          id: next(),
          tier: 1,
          name,
          value: {
            id: next(),
            tier: 1,
            core: {
              kind: "constant",
              value:
                name === "s"
                  ? "sine"
                  : name === "gain"
                    ? 0.3
                    : name === "lpf"
                      ? 1200
                      : 0.5,
            },
            layers: [],
          },
        },
      ],
    });
  });
}
export function addShell(doc: Doc, voiceId: string, name: string): Doc {
  const next = allocate(doc);
  return update(doc, voiceId, (t) =>
    t.pattern.layers.push({
      id: next(),
      tier: 1,
      kind: "rewrite",
      name,
      args: (name === "rev"
        ? []
        : name === "euclid"
          ? [3, 8]
          : [name === "late" ? 0.125 : 2]
      ).map((value) => ({ kind: "literal", value })),
    }),
  );
}
export function stepAt(steps: Step[], path: number[]): Step | undefined {
  let s: Step | undefined;
  for (const i of path) {
    s = steps[i];
    if (s && "steps" in s) steps = s.steps;
  }
  return s;
}
export function changeStep(
  p: Pattern,
  path: number[],
  action: "split" | "merge" | "rest" | "weight" | "value" | "alternate",
  value?: string,
): void {
  if (p.core.kind !== "sequence") throw Error("Not a typed sequence");
  let a = p.core.steps;
  for (const i of path.slice(0, -1)) {
    const s = a[i];
    if (!s || !("steps" in s)) throw Error("No nested step");
    a = s.steps;
  }
  const i = path.at(-1) ?? 0,
    s = a[i];
  if (!s) return;
  if (action === "split")
    a[i] = {
      kind: "sub",
      steps: [structuredClone(s), structuredClone(s)],
      weight: "weight" in s ? s.weight : undefined,
    };
  if (action === "merge" && "steps" in s) {
    const child: Step = structuredClone(
      s.steps[0] ?? { kind: "rest" as const },
    );
    if (
      "weight" in s &&
      (child.kind === "value" || child.kind === "rest" || child.kind === "sub")
    )
      child.weight = s.weight;
    a[i] = child;
  }
  if (action === "rest")
    a[i] =
      s.kind === "rest"
        ? { kind: "value", value: value ?? "60", weight: s.weight }
        : { kind: "rest", weight: "weight" in s ? s.weight : undefined };
  if (action === "value")
    a[i] =
      s.kind === "value"
        ? { ...s, value: value ?? "60" }
        : {
            kind: "value",
            value: value ?? "60",
            weight: "weight" in s ? s.weight : undefined,
          };
  if (
    action === "weight" &&
    (s.kind === "value" || s.kind === "rest" || s.kind === "sub")
  )
    s.weight = Math.max(0.125, Math.min(8, Number(value) || 1));
  if (action === "alternate")
    a[i] = {
      kind: "alternate",
      steps: [structuredClone(s), { kind: "value", value: "72" }],
    };
}
export function moveShell(doc: Doc, targetId: string, delta: number): Doc {
  return update(doc, targetId, (t) => {
    if (t.layerIndex === undefined) return;
    const i = t.layerIndex,
      j = i + delta;
    const a = t.pattern.layers;
    if (j < 0 || j >= a.length) return;
    const x = a[i],
      y = a[j];
    if (x && y) {
      a[i] = y;
      a[j] = x;
    }
  });
}
export class History {
  past: Doc[] = [];
  future: Doc[] = [];
  constructor(public doc: Doc) {}
  set(d: Doc) {
    this.past.push(this.doc);
    this.future = [];
    this.doc = d;
  }
  undo() {
    const d = this.past.pop();
    if (d) {
      this.future.push(this.doc);
      this.doc = d;
    }
  }
  redo() {
    const d = this.future.pop();
    if (d) {
      this.past.push(this.doc);
      this.doc = d;
    }
  }
}
export function makeDriver(
  t: Target,
  kind: "signal" | "sequence" | "constant",
) {
  const p = t.pattern,
    name = t.setting?.name;
  const range =
    name === "gain"
      ? [0.1, 0.8]
      : ["pan", "room", "delay", "delayfeedback"].includes(name ?? "")
        ? [0, 1]
        : name === "release"
          ? [0.05, 0.8]
          : [300, 3000];
  p.core =
    kind === "signal"
      ? { kind: "signal", shape: "sine" }
      : kind === "sequence"
        ? {
            kind: "sequence",
            notation: "",
            steps: [
              { kind: "value", value: String(range[0]), weight: 2 },
              { kind: "value", value: String(range[1]) },
            ],
          }
        : { kind: "constant", value: range[0] ?? 0.5 };
  p.layers =
    kind === "signal"
      ? [
          {
            id: p.id + "-range",
            tier: 1,
            kind: "rewrite",
            name: "range",
            args: range.map((value) => ({ kind: "literal", value })),
          },
          {
            id: p.id + "-speed",
            tier: 1,
            kind: "rewrite",
            name: "slow",
            args: [{ kind: "literal", value: 2 }],
          },
        ]
      : [];
  p.tier = 1;
}

export function toggleMute(doc: Doc, id: string): Doc {
  const next = structuredClone(doc);
  const instrument = song(next).instruments.find((i) => i.id === id);
  if (!instrument) throw Error("Instrument no longer exists");
  // Set the canonical definition, never a section's reference or a driver.
  if (instrument.id === instrument.voice.id)
    instrument.voice.muted = !instrument.voice.muted;
  else instrument.pattern.muted = !instrument.pattern.muted;
  return next;
}

/** Find the voice leaf that owns a setting/driver, without lifting an edit to the
 * entire enclosing stack/cat/arrange. */
export function ownerId(doc: Doc, t: Target): string {
  const all = targets(doc);
  let p = t.pattern;
  for (let depth = 0; depth < 50; depth++) {
    const parent = all.find((x) => x.id === p.id && "core" in x.node)?.parent;
    if (!parent || parent.core.kind === "group")
      return p.id === t.voice.pattern.id ? t.voice.id : p.id;
    p = parent;
  }
  throw Error("Cyclic ownership");
}

/** Paint a typed driver's weighted interval, retaining its nested structure. */
export function paintSequence(
  p: Pattern,
  position: number,
  value: number,
  cycle = 0,
): void {
  if (p.core.kind !== "sequence") throw Error("Not a stepped driver");
  const paint = (steps: Step[], x: number) => {
    const total = steps.reduce(
      (n, s) => n + ("weight" in s ? (s.weight ?? 1) : 1),
      0,
    );
    let start = 0;
    for (const s of steps) {
      const duration = ("weight" in s ? (s.weight ?? 1) : 1) / total;
      if (x >= start && x < start + duration) {
        if (s.kind === "value")
          s.value = String(Math.round(value * 1000) / 1000);
        else if (s.kind === "sub") paint(s.steps, (x - start) / duration);
        else if (s.kind === "alternate") {
          const option = s.steps[cycle % s.steps.length];
          if (option?.kind === "value") option.value = String(value);
        }
        return;
      }
      start += duration;
    }
  };
  paint(p.core.steps, Math.max(0, Math.min(0.999999, position)));
}
