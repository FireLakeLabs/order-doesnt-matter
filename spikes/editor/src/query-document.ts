import type { Doc, Pattern } from "../../import/src/document";
/** Instrument the score, preserving group timing and transformations. Never query
 * leaves independently: cat/arrange and callbacks change where they occur. */
export function tagVoices(d: Doc, unmute = false): Doc {
  function walk(p: Pattern, voice: string, planet: string): Pattern {
    const core =
      p.core.kind === "group"
        ? {
            ...p.core,
            parts: p.core.parts.map((x) => ({
              ...x,
              pattern: walk(x.pattern, voice, x.pattern.id),
            })),
          }
        : p.core;
    return {
      ...p,
      core,
      layers: [
        ...p.layers.filter((l) => !unmute || !l.id.startsWith("mute-")),
        ...(p.core.kind === "group"
          ? []
          : [
              {
                kind: "opaque" as const,
                id: "tag-" + p.id,
                tier: 3 as const,
                code: `.withValue(v => typeof v==='object'&&v!==null?({...v,__planet:'${planet}'}):({value:v,__planet:'${planet}'}))`,
              },
            ]),
      ],
    };
  }
  return {
    ...d,
    voices: d.voices.map((v) => ({
      ...v,
      muted: unmute ? false : v.muted,
      pattern: {
        ...walk(v.pattern, v.id, v.id),
        layers: [
          ...walk(v.pattern, v.id, v.id).layers,
          {
            kind: "opaque",
            id: "tag-voice-" + v.id,
            tier: 3,
            code: `.withValue(v => typeof v==='object'&&v!==null?({...v,__voice:'${v.id}'}):({value:v,__voice:'${v.id}'}))`,
          },
        ],
      },
    })),
  };
}
/** Apply at the first uncommitted cycle. Already queued audio cannot be recalled. */
export function atBoundary(previous: Doc, next: Doc, boundary: number): Doc {
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
        pattern: filter(v.pattern, true),
      })),
      ...next.voices.map((v) => ({ ...v, pattern: filter(v.pattern, false) })),
    ],
  };
}
