import type { Doc, Pattern, Setting, Voice } from "../../import/src/document";
import { targets, type Target } from "./document";
import {
  song,
  currentSection,
  instrumentEvents,
  resolve,
  type Instrument,
} from "./song";
import type { PlainEvent } from "./adapter";
export type EventMap = Record<string, PlainEvent[]>;
export const colors = ["#a3efd5", "#c3b0f1", "#efbd75", "#82bdde"];
export const valueAt = (e: PlainEvent, name: string): unknown =>
  typeof e.value === "object" && e.value !== null
    ? Reflect.get(
        e.value,
        name === "lpf" ? "cutoff" : name === "hpf" ? "hcutoff" : name,
      )
    : e.value;
export function span(e: PlainEvent, cycle: number): [number, number] {
  return [Math.max(0, e.part[0] - cycle), Math.min(1, e.part[1] - cycle)];
}
export function settings(v: Voice): Setting[] {
  return v.pattern.layers.flatMap((l) =>
    l.kind === "settings" ? l.settings : [],
  );
}
function constantValue(p: Pattern): unknown {
  return p.core.kind === "constant"
    ? p.core.value
    : p.core.kind === "sequence"
      ? p.core.steps.map((s) => (s.kind === "value" ? s.value : "~")).join(" ")
      : undefined;
}
export function rooms(doc: Doc, events: EventMap) {
  const r = new Map<
    string,
    { id: string; voices: string[]; conflict: boolean; signatures: Set<string> }
  >();
  for (const v of doc.voices) {
    const ss = settings(v),
      es = events[v.id] ?? [];
    const send =
      ss.some(
        (s) =>
          (s.name === "room" || s.name === "delay") &&
          constantValue(s.value) !== 0,
      ) ||
      es.some(
        (e) =>
          Number(valueAt(e, "room")) > 0 || Number(valueAt(e, "delay")) > 0,
      );
    if (!send) continue;
    const orbits = new Set(es.map((e) => String(valueAt(e, "orbit") ?? 1)));
    if (!orbits.size)
      orbits.add(
        String(
          constantValue(
            ss.find((s) => s.name === "orbit")?.value ??
              ({ core: { kind: "constant", value: 1 } } as Pattern),
          ) ?? 1,
        ),
      );
    for (const orbit of orbits) {
      let x = r.get(orbit);
      if (!x) {
        x = { id: orbit, voices: [], conflict: false, signatures: new Set() };
        r.set(orbit, x);
      }
      x.voices.push(v.id);
      const sig = JSON.stringify(
        ss
          .filter((s) =>
            ["roomsize", "delaytime", "delayfeedback"].includes(s.name),
          )
          .map((s) => [s.name, s.value.core]),
      );
      x.signatures.add(sig);
      for (const e of es)
        x.signatures.add(
          JSON.stringify(
            ["roomsize", "delaytime", "delayfeedback"].map((k) => [
              k,
              valueAt(e, k),
            ]),
          ),
        );
      x.conflict = x.signatures.size > 2;
    }
  }
  // Compare actual room parameters across senders, including defaults. Never predict a winner.
  for (const x of r.values()) {
    const signatures = x.voices.flatMap((id) => {
      const v = doc.voices.find((v) => v.id === id);
      return (events[id] ?? []).length
        ? (events[id] ?? [])
            .filter(
              (e) =>
                String(valueAt(e, "orbit") ?? 1) === x.id &&
                (Number(valueAt(e, "room")) > 0 ||
                  Number(valueAt(e, "delay")) > 0),
            )
            .map((e) =>
              JSON.stringify(
                ["roomsize", "delaytime", "delayfeedback"].map(
                  (k) => valueAt(e, k) ?? "default",
                ),
              ),
            )
        : [
            JSON.stringify(
              v
                ? settings(v)
                    .filter((s) =>
                      ["roomsize", "delaytime", "delayfeedback"].includes(
                        s.name,
                      ),
                    )
                    .map((s) => [s.name, constantValue(s.value)])
                : [],
            ),
          ];
    });
    x.conflict = new Set(signatures).size > 1;
  }
  return [...r.values()];
}
export const settingNames: Record<string, string> = {
  cutoff: "filter",
  lpf: "filter",
  hcutoff: "high-pass",
  hpf: "high-pass",
  room: "reverb",
  roomsize: "room size",
  shape: "drive",
  orbit: "shared room",
  lpenv: "filter env",
  fmi: "FM amount",
  fmh: "FM ratio",
  gain: "level",
  s: "sound",
  lpq: "resonance",
  delayfeedback: "echo feedback",
  delay: "echo",
  pan: "pan",
  attack: "attack",
  release: "release",
  note: "pitch",
  n: "pitch",
  speed: "speed",
};
export const settingName = (name: string) => settingNames[name] ?? name;
export interface Moon {
  id: string;
  label: string;
  x: number;
  y: number;
  r: number;
  level: number;
  tier: number;
  kind: "setting" | "driver" | "shell" | "group";
  owner: string;
  value?: Pattern;
}
export interface Planet {
  id: string;
  voice: string;
  name: string;
  x: number;
  y: number;
  radius: number;
  nodes: Moon[];
  shells: {
    id: string;
    name: string;
    r: number;
    labelX: number;
    labelY: number;
  }[];
  events: PlainEvent[];
  tier: number;
  group?: string;
  collapsed: boolean;
  pattern: Pattern;
  instrument: Instrument;
  active: boolean;
  orbit: number;
}
export function constellation(
  doc: Doc,
  events: EventMap,
  collapsed: Set<string> = new Set(),
  columns = 3,
  cycle = 0,
) {
  const structure = song(doc),
    active = currentSection(structure.sections, cycle, structure.total);
  const planets: Planet[] = structure.instruments.map((i, index) => {
    const use = i.uses.find(
      (u) => !active || u.section === active.index || u.section === -1,
    );
    const p = resolve(doc, use?.pattern ?? i.pattern),
      x = 210 + (index % columns) * 420,
      y = 250 + Math.floor(index / columns) * 480;
    const rewrites = p.layers.filter((l) => l.kind !== "settings");
    const shellStep = Math.min(28, 60 / Math.max(1, rewrites.length - 1));
    const shells = rewrites.map((l, j) => {
      const r = 76 + j * shellStep,
        dx = rewrites.length > 4 ? (j % 2 ? -32 : 32) : 0;
      return {
        id: l.id,
        name: l.kind === "rewrite" ? l.name : "source",
        r,
        labelX: x + dx,
        labelY: y + Math.sqrt(r * r - dx * dx),
      };
    });
    const outer = Math.max(96, ...shells.map((s) => s.r + 34));
    const nodes: Moon[] = [],
      ss = p.layers.flatMap((l, k) =>
        l.kind === "settings" ? l.settings.map((s) => ({ s, k })) : [],
      );
    if (!collapsed.has(i.id)) {
      for (const [j, { s, k }] of ss.entries()) {
        const constant =
          s.value.core.kind === "constant" ||
          (s.value.core.kind === "sequence" &&
            s.value.core.steps.length === 1 &&
            s.value.core.steps[0]?.kind === "value" &&
            !s.value.layers.length);
        const before = p.layers
          .slice(0, k)
          .filter((l) => l.kind !== "settings").length;
        const inner = shells[before - 1]?.r ?? 52,
          next = shells[before]?.r ?? outer;
        const radius = constant ? outer : Math.max(64, (inner + next) / 2);
        const candidates = Array.from({ length: 144 }, (_, n) => {
          const angle = -Math.PI / 2 + (n / 144) * Math.PI * 2,
            mx = x + Math.cos(angle) * radius,
            my = y + Math.sin(angle) * radius;
          const collision = nodes
            .filter((n) => n.kind === "setting")
            .reduce(
              (sum, n) =>
                sum + Math.max(0, 56 - Math.hypot(mx - n.x, my - n.y)) ** 2,
              0,
            );
          const labels = shells.reduce(
            (sum, sh) =>
              sum +
              (Math.abs(mx - sh.labelX) < 61 && Math.abs(my - sh.labelY) < 37
                ? 1000
                : 0),
            0,
          );
          const heading = Math.max(0, y - 170 - (my - 23)) * 100;
          const desired = -Math.PI / 2 + j * 2.3999632297;
          const preference = 1 - Math.cos(angle - desired);
          return {
            mx,
            my,
            cost: collision * 100 + labels + heading + preference,
          };
        }).sort((a, b) => a.cost - b.cost);
        const best = candidates[0];
        if (!best) throw Error("No moon placement");
        const { mx, my } = best;
        nodes.push({
          id: s.id,
          label: s.name,
          x: mx,
          y: my,
          r: 23,
          level: k,
          tier: s.tier,
          kind: "setting",
          owner: i.id,
          value: s.value,
        });
        const descend = (p: Pattern, depth: number, owner: string) => {
          if (depth > 5) return;
          const count = nodes.filter((n) => n.kind === "driver").length;
          nodes.push({
            id: p.id,
            label:
              p.core.kind === "signal"
                ? p.core.shape
                : p.core.kind === "sequence"
                  ? "steps"
                  : p.core.kind,
            x: x - 170 + (count % 5) * 70,
            y: y + 172 + Math.floor(count / 5) * 28,
            r: 12,
            level: depth,
            tier: p.tier,
            kind: "driver",
            owner,
          });
          for (const a of p.layers.flatMap((l) =>
            l.kind === "rewrite" ? l.args : [],
          ))
            if (a.kind === "pattern") descend(a.pattern, depth + 1, p.id);
        };
        if (s.value.core.kind !== "constant") descend(s.value, 1, s.id);
      }
    }
    return {
      id: i.id,
      voice: i.voice.id,
      name: i.name,
      x,
      y,
      radius: 32,
      nodes,
      shells,
      orbit: outer,
      events: instrumentEvents(i, events),
      tier: p.tier,
      group: p.core.kind === "group" ? p.core.how : undefined,
      collapsed: collapsed.has(i.id),
      pattern: p,
      instrument: i,
      active:
        !active || i.sections.includes(active.index) || i.sections.includes(-1),
    };
  });
  const roomEvents = Object.fromEntries(planets.map((p) => [p.id, p.events]));
  const roomDoc = {
    ...doc,
    voices: planets.map((p) => ({
      ...p.instrument.voice,
      id: p.id,
      name: p.name,
      pattern: p.pattern,
    })),
  };
  return {
    planets,
    rooms: rooms(roomDoc, roomEvents),
    width: columns * 420,
    height: Math.max(480, Math.ceil(planets.length / columns) * 480),
  };
}
export function sheet(doc: Doc, events: EventMap, cycle = 0) {
  const scene = constellation(doc, events, new Set(), 3, cycle),
    planets = scene.planets;
  const counts = new Map<string, number>();
  const rows = planets.map((p) => {
    const v = {
      ...p.instrument.voice,
      id: p.id,
      name: p.name,
      pattern: p.pattern,
      muted:
        p.instrument.voice.muted ||
        p.pattern.layers.some((l) => l.id === "mute-" + p.id),
    };
    // Query only this instrument's actual settings; never descend through the whole arrangement.
    const active = currentSection(song(doc).sections, cycle, song(doc).total);
    const uses = p.instrument.uses.filter(
      (u) => !active || u.section === active.index || u.section === -1,
    );
    const values: Setting[] = [];
    function gather(pat: Pattern, seen = new Set<string>()) {
      if (seen.has(pat.id)) return;
      seen.add(pat.id);
      const resolved = resolve(doc, pat);
      if (resolved.core.kind === "group")
        for (const part of resolved.core.parts) gather(part.pattern, seen);
      if (resolved.core.kind === "generator" && resolved.core.name === "s") {
        const arg = resolved.core.args[0];
        if (arg?.kind === "pattern")
          values.push({
            id: arg.pattern.id,
            tier: arg.pattern.tier,
            name: "s",
            value: arg.pattern,
          });
      }
      values.push(
        ...resolved.layers.flatMap((l) =>
          l.kind === "settings" ? l.settings : [],
        ),
      );
    }
    gather(p.pattern);
    for (const use of uses) gather(use.pattern);
    const ss = [...new Map(values.map((s) => [s.id, s])).values()];
    for (const name of new Set(ss.map((s) => s.name)))
      counts.set(name, (counts.get(name) ?? 0) + 1);
    return {
      voice: v,
      events: p.events,
      settings: ss,
      active: p.active,
      instrument: p.instrument,
    };
  });
  const columns = [...counts.keys()].sort(
    (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b),
  );
  return { columns, rows, rooms: scene.rooms };
}
export function searchTargets(doc: Doc, q: string): Target[] {
  return targets(doc).filter(
    (t) =>
      !("kind" in t.node && t.node.kind === "settings") &&
      q
        .toLowerCase()
        .split(/\s+/)
        .every((word) =>
          [...t.path, settingName(t.label)]
            .join(" ")
            .toLowerCase()
            .includes(word),
        ),
  );
}
