import { generate, generatePattern } from "./adapter";
import { targets } from "./document";
import { song } from "./song";
import type { Doc, Pattern } from "../../import/src/document";
/** Instrument the score, preserving group timing and transformations. Never query
 * leaves independently: cat/arrange and callbacks change where they occur. */
export function tagVoices(d: Doc, unmute = false): Doc {
  const uses = new Map(
    song(d).instruments.flatMap((i) =>
      i.uses.map((u) => [u.pattern.id, i.id] as const),
    ),
  );
  function walk(p: Pattern): Pattern {
    const core =
      p.core.kind === "group"
        ? {
            ...p.core,
            parts: p.core.parts.map((x) => ({
              ...x,
              pattern: walk(x.pattern),
            })),
          }
        : p.core;
    const id = uses.get(p.id);
    return {
      ...p,
      muted: unmute ? false : p.muted,
      core,
      layers: [
        ...p.layers,
        ...(id
          ? [
              {
                kind: "opaque" as const,
                id: "tag-" + p.id,
                tier: 3 as const,
                code: `.withValue(v=>typeof v==='object'&&v!==null?({...v,__planet:'${id}'}):({value:v,__planet:'${id}'}))`,
              },
            ]
          : []),
      ],
    };
  }
  return {
    ...d,
    shared: Object.fromEntries(
      Object.entries(d.shared).map(([name, p]) => [name, walk(p)]),
    ),
    voices: d.voices.map((v) => ({
      ...v,
      muted: unmute ? false : v.muted,
      pattern: {
        ...walk(v.pattern),
        layers: [
          ...walk(v.pattern).layers,
          {
            kind: "opaque",
            id: "tag-voice-" + v.id,
            tier: 3,
            code: `.withValue(v=>typeof v==='object'&&v!==null?({...v,__voice:'${v.id}'}):({value:v,__voice:'${v.id}'}))`,
          },
        ],
      },
    })),
  };
}
/** Apply at the first uncommitted cycle. Already queued audio cannot be recalled. */
export function atBoundary(previous: Doc, next: Doc, boundary: number): Doc {
  const declarations = generate({
    ...previous,
    setup: [],
    tempo: undefined,
    transforms: [],
    voices: [],
    order: previous.order?.filter((e) => e.kind === "shared"),
  });
  const previousPattern = (p: Pattern): Pattern =>
    Object.keys(previous.shared).length
      ? {
          ...p,
          core: {
            kind: "opaque",
            code: `(()=>{${declarations}return ${generatePattern(p)};})()`,
          },
          layers: [],
        }
      : p;
  const filter = (p: Pattern, old: boolean): Pattern => ({
    ...p,
    layers: [
      ...p.layers,
      {
        kind: "opaque",
        id: `boundary-${old}-${p.id}`,
        tier: 3,
        code: `.filterWhen(t=>Number(t) ${old ? "<" : ">="} ${boundary})`,
      },
    ],
  });
  return {
    ...next,
    order: undefined,
    voices: [
      ...previous.voices.map((v) => ({
        ...v,
        pattern: filter(previousPattern(v.pattern), true),
      })),
      ...next.voices.map((v) => ({ ...v, pattern: filter(v.pattern, false) })),
    ],
  };
}

/** Query signals at 64 actual times per cycle; the drawing never invents a wave. */
export function driverDocument(d: Doc): Doc | undefined {
  const unique = new Map<string, { id: string; value: Pattern }>();
  for (const t of targets(d)) {
    if (t.pattern.core.kind !== "signal") continue;
    if (t.id !== t.pattern.id && t.id !== t.setting?.id) continue;
    const id =
      t.setting?.value.id === t.pattern.id ? t.setting.id : t.pattern.id;
    unique.set(t.pattern.id, { id, value: t.pattern });
  }
  if (!unique.size) return;
  return {
    ...d,
    order: undefined,
    transforms: [],
    voices: [...unique.values()].map((s) => ({
      id: "driver-" + s.id,
      tier: 1,
      name: "$",
      muted: false,
      pattern: {
        ...s.value,
        layers: [
          ...s.value.layers,
          {
            kind: "rewrite",
            id: "sample-" + s.id,
            tier: 1,
            name: "segment",
            args: [{ kind: "literal", value: 64 }],
          },
          {
            kind: "opaque",
            id: "driver-tag-" + s.id,
            tier: 3,
            code: `.withValue(value=>({value,__driver:'${s.id}'}))`,
          },
        ],
      },
    })),
  };
}
