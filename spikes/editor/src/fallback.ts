import * as core from "@strudel/core";
import * as mini from "@strudel/mini";
import * as tonal from "@strudel/tonal";
import type { Doc, Pattern, Step, Arg, Layer } from "../../import/src/document";
import { constant, pattern } from "./fixtures";
export interface PlainEvent {
  whole: [number, number] | null;
  part: [number, number];
  value: unknown;
  hasOnset: boolean;
}
export interface EventResult {
  events: PlainEvent[];
  error: string | null;
}
export const adapterName = "Fixture adapter · real Strudel queries";
export function notation(s: Step): string {
  const w =
    "weight" in s && s.weight !== undefined && s.weight !== 1
      ? `@${s.weight}`
      : "";
  switch (s.kind) {
    case "value":
      return (
        s.value +
        (s.repeat ? `*${s.repeat}` : "") +
        (s.chance !== undefined ? `?${s.chance}` : "") +
        w
      );
    case "rest":
      return "~" + w;
    case "sub":
      return `[${s.steps.map(notation).join(" ")}]${w}`;
    case "alternate":
      return `<${s.steps.map(notation).join(" ")}>`;
    case "together":
      return `[${s.steps.map(notation).join(",")}]`;
    case "other":
      return s.notation;
  }
}
const json = JSON.stringify;
export function patternSource(
  p: Pattern,
  doc: Doc,
  root = false,
  limit = 0,
): string {
  if (limit > 20) throw Error("Reference cycle or excessive depth");
  const arg = (a: Arg): string =>
    a.kind === "literal"
      ? json(a.value)
      : a.kind === "opaque"
        ? a.code
        : a.kind === "callback"
          ? `p=>${patternSource(a.body, doc, false, limit + 1)}`
          : patternSource(a.pattern, doc, false, limit + 1);
  let s: string;
  switch (p.core.kind) {
    case "sequence":
      s = `${root ? "note" : "mini"}(${json(p.core.steps.map(notation).join(" "))})`;
      break;
    case "data":
      s = `pure(${json(p.core.value)})`;
      break;
    case "constant":
      s = `pure(${json(p.core.value)})`;
      break;
    case "signal":
      s = p.core.shape;
      break;
    case "generator":
      s = `${p.core.name}(${p.core.args.map(arg).join(",")})`;
      break;
    case "group":
      s = `${p.core.how}(${p.core.parts.map((x) => (p.core.kind === "group" && p.core.how === "arrange" ? `[${x.cycles ?? 1},${patternSource(x.pattern, doc, true, limit + 1)}]` : patternSource(x.pattern, doc, true, limit + 1))).join(",")})`;
      break;
    case "ref": {
      const ref = doc.shared[p.core.name];
      if (!ref) throw Error("Missing shared pattern " + p.core.name);
      s = patternSource(ref, doc, root, limit + 1);
      break;
    }
    case "hole":
      s = "p";
      break;
    case "opaque":
      s = `(${p.core.code})`;
      break;
  }
  for (const l of p.layers) {
    if (l.kind === "settings")
      for (const x of l.settings)
        s += `.${x.name}(${patternSource(x.value, doc, false, limit + 1)})`;
    else if (l.kind === "rewrite")
      s += `.${l.name}(${l.args.map(arg).join(",")})`;
    else s += l.code;
  }
  return s;
}
export function generate(doc: Doc): string {
  return `// mini-off\n${doc.setup.map((s) => s.code).join("\n")}\nstack(${doc.voices
    .filter((v) => !v.muted)
    .map(
      (v) =>
        `(${patternSource(v.pattern, doc, true)}).fmap(v=>typeof v==='object'?({...v,__voice:${json(v.id)}}):({note:v,__voice:${json(v.id)}}))`,
    )
    .join(",\n")})`;
}
export function importStrudel(source: string): {
  doc: Doc;
  warnings: string[];
} {
  return {
    doc: {
      setup: [],
      shared: {},
      voices: [
        {
          id: "pasted",
          tier: 3,
          name: "pasted source",
          muted: false,
          pattern: pattern({ kind: "opaque", code: source }, [], 3),
        },
      ],
    },
    warnings: [
      "Fixture adapter: pasted expressions are kept as selectable source; structured import is not ready.",
    ],
  };
}
let ready: Promise<unknown> | undefined;
export async function queryEvents(
  source: string,
  fromCycle: number,
  toCycle: number,
): Promise<EventResult> {
  try {
    ready ??= core
      .evalScope(core, mini, tonal)
      .then(() => mini.miniAllStrings());
    await ready;
    const { pattern: p } = await core.evaluate(source);
    if (!p || typeof p.query !== "function")
      throw Error("Source did not produce a pattern");
    const events = p
      .query(
        new core.State(new core.TimeSpan(fromCycle, toCycle), { _cps: 0.5 }),
      )
      .map(
        (h: {
          whole?: { begin: unknown; end: unknown };
          part: { begin: unknown; end: unknown };
          value: unknown;
          hasOnset(): boolean;
        }) => ({
          whole: h.whole ? [Number(h.whole.begin), Number(h.whole.end)] : null,
          part: [Number(h.part.begin), Number(h.part.end)],
          value: h.value,
          hasOnset: h.hasOnset(),
        }),
      );
    return { events, error: null };
  } catch (e) {
    return { events: [], error: e instanceof Error ? e.message : String(e) };
  }
}
export function sourceUntil(p: Pattern, doc: Doc, n: number): string {
  return patternSource({ ...p, layers: p.layers.slice(0, n) }, doc, true);
}
