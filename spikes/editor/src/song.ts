import type { Doc, Pattern, Voice } from "../../import/src/document";
import type { PlainEvent } from "./adapter";

export interface Section {
  name: string;
  comment?: string;
  start: number;
  cycles: number;
  pattern: Pattern;
  index: number;
}
export interface Instrument {
  id: string;
  name: string;
  pattern: Pattern;
  voice: Voice;
  uses: { pattern: Pattern; section: number }[];
  sections: number[];
}
export function resolve(
  doc: Doc,
  p: Pattern,
  seen = new Set<string>(),
): Pattern {
  if (p.core.kind !== "ref" || seen.has(p.core.name)) return p;
  const shared = doc.shared[p.core.name];
  if (!shared) return p;
  seen.add(p.core.name);
  const base = resolve(doc, shared, seen);
  return { ...base, layers: [...base.layers, ...p.layers] };
}
function notation(p: Pattern): string {
  return p.core.kind === "sequence"
    ? p.core.notation
    : p.core.kind === "constant"
      ? String(p.core.value)
      : "";
}
export function humanName(p: Pattern): string {
  if (p.label) return p.label;
  if (p.core.kind === "ref") return p.core.name;
  const ss = p.layers.flatMap((l) => (l.kind === "settings" ? l.settings : []));
  const sound = ss.find((s) => s.name === "s");
  let text = sound
    ? notation(sound.value)
    : p.core.kind === "generator" && p.core.name === "s"
      ? p.core.args
          .map((a) =>
            a.kind === "pattern"
              ? notation(a.pattern)
              : a.kind === "literal"
                ? String(a.value)
                : "",
          )
          .join("")
      : "";
  const key = text.match(/[a-z]+/i)?.[0] ?? "";
  const names: Record<string, string> = {
    bd: "kick",
    sd: "snare",
    cp: "clap",
    hh: "hi-hat",
    oh: "open hat",
    sawtooth: "saw",
    supersaw: "supersaw",
    piano: "piano",
    sine: "sine",
    triangle: "triangle",
    square: "square",
    speech: "vocal chop",
    ade: "vocal phrase",
    pulse: "pulse",
  };
  text = names[key] ?? key;
  const notes =
    p.core.kind === "generator" && ["note", "n"].includes(p.core.name)
      ? p.core.args
          .map((a) => (a.kind === "pattern" ? notation(a.pattern) : ""))
          .join("")
      : "";
  const role = notes.includes(",")
    ? "chords"
    : /\b[a-g][b#]?[12]\b/.test(notes)
      ? "bass"
      : notes
        ? "notes"
        : "";
  return (
    [text, role].filter(Boolean).join(" ") ||
    p.comment
      ?.replace(/^\d+\.\s*/, "")
      .split(/[(:]/)[0]
      ?.trim() ||
    (p.core.kind === "group"
      ? p.core.how === "arrange"
        ? "Song"
        : "Ensemble"
      : p.core.kind === "opaque"
        ? "source pattern"
        : "pattern")
  );
}
export function song(doc: Doc): {
  sections: Section[];
  instruments: Instrument[];
  total: number;
} {
  const sections: Section[] = [],
    instruments: Instrument[] = [];
  const byId = new Map<string, Instrument>(),
    names = new Map<string, number>();
  let total = 0;
  function add(p: Pattern, v: Voice, section: number, top = false) {
    const resolved = resolve(doc, p);
    if (
      resolved.core.kind === "group" &&
      (top || (!p.label && p.core.kind !== "ref"))
    ) {
      for (const part of resolved.core.parts) add(part.pattern, v, section);
      return;
    }
    const shared = p.core.kind === "ref" ? doc.shared[p.core.name] : undefined;
    const base = shared ?? p;
    const id = p === v.pattern ? v.id : base.id;
    let row = byId.get(id);
    if (!row) {
      const proposed =
        p === v.pattern && !/^[\$_]+$/.test(v.name) ? v.name : humanName(base);
      const n = (names.get(proposed) ?? 0) + 1;
      names.set(proposed, n);
      row = {
        id,
        name: proposed + (n > 1 ? ` ${n}` : ""),
        pattern: base,
        voice: v,
        uses: [],
        sections: [],
      };
      instruments.push(row);
      byId.set(id, row);
    }
    row.uses.push({ pattern: p, section });
    if (!row.sections.includes(section)) row.sections.push(section);
  }
  for (const v of doc.voices) {
    const root = resolve(doc, v.pattern);
    if (root.core.kind === "group" && root.core.how === "arrange") {
      let start = 0;
      for (const [index, part] of root.core.parts.entries()) {
        const p = resolve(doc, part.pattern),
          cycles = part.cycles ?? 1;
        sections.push({
          name:
            part.pattern.label ??
            (part.pattern.core.kind === "ref"
              ? part.pattern.core.name
              : p.label) ??
            p.comment
              ?.split(":")[0]
              ?.replace(/^\d+\.\s*/, "")
              .trim() ??
            `Section ${index + 1}`,
          comment: p.comment,
          start,
          cycles,
          pattern: part.pattern,
          index: sections.length,
        });
        add(part.pattern, v, sections.length - 1, true);
        start += cycles;
      }
      total = Math.max(total, start);
    } else add(v.pattern, v, -1, true);
  }
  return { sections, instruments, total };
}
export function currentSection(
  sections: Section[],
  cycle: number,
  total: number,
): Section | undefined {
  const t = total ? ((cycle % total) + total) % total : cycle;
  return sections.find((s) => t >= s.start && t < s.start + s.cycles);
}
export function instrumentEvents(
  i: Instrument,
  events: Record<string, PlainEvent[]>,
): PlainEvent[] {
  const es = events[i.voice.id] ?? [];
  return es.filter((e) => {
    const value = e.value;
    const tag =
      value && typeof value === "object"
        ? Reflect.get(value, "__planet")
        : undefined;
    return tag === i.id || (i.id === i.voice.id && tag === undefined);
  });
}
