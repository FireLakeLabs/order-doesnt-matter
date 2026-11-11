// Draft document shape for Phase 0 studies. Not production code (decision D7).
// Spikes copy or import this file; propose changes in your FINDINGS.md rather
// than forking it silently.
//
// The idea: everything is a Pattern, and a Pattern is a core plus layers.
// Layers are ordered. Inside one "settings" layer, order does not matter.
// That is the whole visual rule: moons (settings) are unordered, shells
// (rewrites) are ordered, and a moon belongs to the shell level it sits at.

/** How well the app understands a node. */
export type Tier =
  | 1 // understood: has a purpose-built editor
  | 2 // recognised by shape: a named call with plain or pattern arguments
  | 3; // not modelled: kept as source text, still played and drawn

export interface Meta {
  id: string; // stable within one document
  tier: Tier;
  /** Offsets into the imported source, when the node came from an import. */
  span?: { start: number; end: number };
}

export interface Doc {
  /** Tempo and other setup the app understands. */
  tempo?: { cpm: number };
  /** Setup the app does not model: sample loading, helper functions, etc. */
  setup: Opaque[];
  /** Top-level patterns, one per `$:` line or per root expression. */
  voices: Voice[];
  /** Named patterns reused in more than one place. */
  shared: Record<string, Pattern>;
  /** Spike extension: preserve setup/definition/voice evaluation order. */
  order?: (
    | { kind: "setup"; index: number }
    | { kind: "shared"; name: string }
    | { kind: "voice"; index: number }
    | { kind: "tempo" }
    | { kind: "transform"; index: number }
  )[];
  /** all() is a global transform, not a voice or an opaque statement. */
  transforms?: (Meta & { name: "all"; args: Arg[] })[];
}

export interface Voice extends Meta {
  name: string; // label from `name:`, or generated
  muted: boolean;
  pattern: Pattern;
}

export interface Pattern extends Meta {
  core: Core;
  /** Applied in order, first to last (innermost shell first). */
  layers: Layer[];
}

export type Core =
  | { kind: "sequence"; steps: Step[]; notation: string } // typed mini-notation
  | { kind: "signal"; shape: string } // sine, saw, perlin, rand, ...
  | { kind: "constant"; value: number | string | boolean }
  | { kind: "data"; value: JsonValue } // plain array/object, not mini notation
  | {
      kind: "group";
      how: "stack" | "cat" | "seq" | "arrange" | string;
      parts: GroupPart[];
    }
  | { kind: "generator"; name: string; args: Arg[] } // any other call that makes a pattern
  | { kind: "ref"; name: string } // points into Doc.shared
  | { kind: "hole" } // "the pattern this callback receives"
  | { kind: "opaque"; code: string };

export interface GroupPart {
  pattern: Pattern;
  /** For `arrange`: how many cycles this part lasts. */
  cycles?: number;
}

/** One element of a typed sequence. Nesting and weights are kept, not flattened. */
export type Step =
  | {
      kind: "value";
      value: string;
      weight?: number;
      repeat?: number;
      chance?: number;
    }
  | { kind: "rest"; weight?: number }
  | { kind: "sub"; steps: Step[]; weight?: number } // [a b]
  | { kind: "alternate"; steps: Step[] } // <a b>
  | { kind: "together"; steps: Step[] } // a,b
  | { kind: "other"; notation: string }; // euclid tuples, polymeter, anything else

export type Layer = SettingsLayer | RewriteLayer | OpaqueLayer;

/** A bag of settings. Order inside the bag does not matter. */
export interface SettingsLayer extends Meta {
  kind: "settings";
  settings: Setting[];
}

export interface Setting extends Meta {
  name: string; // canonical control name: lpf, gain, pan, room, s, note, ...
  value: Pattern; // constant, sequence, signal with its own layers, ...
}

/** A call that changes which events exist or when. Order matters. */
export interface RewriteLayer extends Meta {
  kind: "rewrite";
  name: string; // fast, slow, rev, off, every, jux, euclid, degradeBy, FX, ...
  args: Arg[];
}

/** Source the app could not place in the chain any other way. */
export interface OpaqueLayer extends Meta {
  kind: "opaque";
  code: string; // e.g. ".withValue(v => v * 2)"
}

export type Arg =
  | { kind: "literal"; value: JsonValue }
  | { kind: "pattern"; pattern: Pattern }
  | { kind: "callback"; body: Pattern; parameter?: string } // body's innermost core is a 'hole'
  | { kind: "opaque"; code: string };

export interface Opaque extends Meta {
  code: string;
}

// Rooms are not stored. They are derived: every pattern whose settings include
// `orbit` n (default 1) and a delay or reverb send belongs to room n.

export type JsonValue =
  | null
  | number
  | string
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };
