import type { Doc, Pattern, Setting, Voice } from "../../import/src/document";
import { targets, type Target } from "./document";
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
}
export interface Planet {
  id: string;
  voice: string;
  name: string;
  x: number;
  y: number;
  radius: number;
  nodes: Moon[];
  shells: { id: string; name: string; r: number }[];
  events: PlainEvent[];
  tier: number;
  group?: string;
  collapsed: boolean;
  pattern: Pattern;
}
export function constellation(
  doc: Doc,
  events: EventMap,
  collapsed: Set<string> = new Set(),
  columns = 3,
): {
  planets: Planet[];
  rooms: ReturnType<typeof rooms>;
  width: number;
  height: number;
} {
  const all = targets(doc),
    planets: Planet[] = [];
  const roomList = rooms(doc, events);
  const sorted = [...doc.voices].sort(
    (a, b) =>
      roomList.findIndex((r) => r.voices.includes(a.id)) -
      roomList.findIndex((r) => r.voices.includes(b.id)),
  );
  let i = 0;
  let previousRoom = "";
  for (const v of sorted) {
    const room = roomList.find((r) => r.voices.includes(v.id))?.id ?? "none";
    if (previousRoom && room !== previousRoom && i % columns)
      i += columns - (i % columns);
    previousRoom = room;
    const children: { p: Pattern; id: string; name: string; group?: string }[] =
      [];
    const leaf = (
      p: Pattern,
      name: string,
      parentLayers: Pattern["layers"] = [],
      groups: string[] = [],
    ) => {
      if (p.core.kind === "group") {
        p.core.parts.forEach((x, j) =>
          leaf(
            x.pattern,
            `${name} · ${j + 1}`,
            [...p.layers, ...parentLayers],
            [...groups, p.core.kind === "group" ? p.core.how : "group"],
          ),
        );
      } else
        children.push({
          p: { ...p, layers: [...p.layers, ...parentLayers] },
          id: p === v.pattern ? v.id : p.id,
          name,
          group: groups.join(" / ") || undefined,
        });
    };
    leaf(v.pattern, v.name);
    for (const child of children) {
      const x = 205 + (i % columns) * 400,
        y = 215 + Math.floor(i / columns) * 410;
      i++;
      const shells = child.p.layers.flatMap((l, k) =>
        l.kind !== "settings"
          ? [
              {
                id: l.id,
                name:
                  l.kind === "rewrite"
                    ? `${k + 1} · ${l.name}`
                    : "source shell",
                r: 63 + k * 15,
              },
            ]
          : [],
      );
      const nodes: Moon[] = [];
      if (!collapsed.has(child.id)) {
        let j = 0;
        for (const [k, l] of child.p.layers.entries())
          if (l.kind === "settings")
            for (const s of l.settings) {
              const angle =
                  -Math.PI / 2 +
                  (j++ /
                    Math.max(5, settings({ ...v, pattern: child.p }).length)) *
                    Math.PI *
                    2,
                r = 74 + k * 16;
              const mx = x + Math.cos(angle) * r,
                my = y + Math.sin(angle) * r;
              nodes.push({
                id: s.id,
                label: s.name,
                x: mx,
                y: my,
                r: 20,
                level: k,
                tier: s.tier,
                kind: "setting",
                owner: child.id,
              });
              const descend = (
                p: Pattern,
                depth: number,
                px: number,
                py: number,
                owner: string,
              ) => {
                if (depth > 5) return;
                const choices = Array.from({ length: 24 }, (_, k) => {
                  const a = angle + (k * Math.PI) / 12,
                    dx = px + Math.cos(a) * 55,
                    dy = py + Math.sin(a) * 55;
                  const overflow =
                    Math.max(0, Math.abs(dx - x) - 175) +
                    Math.max(0, Math.abs(dy - y) - 155);
                  const collision =
                    nodes.reduce(
                      (n, q) =>
                        n + Math.max(0, 38 - Math.hypot(dx - q.x, dy - q.y)),
                      0,
                    ) + Math.max(0, 88 - Math.hypot(dx - x, dy - y));
                  return {
                    dx,
                    dy,
                    cost: overflow * 20 + collision * 4 + k * 0.03,
                  };
                }).sort((a, b) => a.cost - b.cost);
                const { dx, dy } = choices[0]!;
                nodes.push({
                  id: p.id,
                  label:
                    p.core.kind === "signal"
                      ? p.core.shape
                      : p.core.kind === "sequence"
                        ? "steps"
                        : p.core.kind,
                  x: dx,
                  y: dy,
                  r: 14,
                  level: depth,
                  tier: p.tier,
                  kind: "driver",
                  owner,
                });
                for (const t of all.filter(
                  (t) => t.parent?.id === p.id && "core" in t.node,
                ))
                  descend(t.pattern, depth + 1, dx, dy, p.id);
              };
              if (s.value.core.kind !== "constant")
                descend(s.value, 1, mx, my, s.id);
            }
      }
      planets.push({
        id: child.id,
        voice: v.id,
        name: child.name,
        x,
        y,
        radius: 54,
        nodes,
        shells,
        events: (events[v.id] ?? []).filter(
          (e) => !child.group || String(valueAt(e, "__planet")) === child.id,
        ),
        tier: child.p.tier,
        group: child.group,
        collapsed: collapsed.has(child.id),
        pattern: child.p,
      });
    }
  }
  return {
    planets,
    rooms: roomList,
    width: columns * 400,
    height: Math.max(430, Math.ceil(i / columns) * 410),
  };
}
export function sheet(doc: Doc, events: EventMap) {
  const columns = [
    ...new Set(
      targets(doc)
        .filter((t) => "value" in t.node && "name" in t.node)
        .map((t) => t.label),
    ),
  ];
  const byId = new Map(doc.voices.map((v) => [v.id, v]));
  return {
    columns,
    rows: constellation(doc, events).planets.map((p) => {
      const root = byId.get(p.voice)!;
      const v = {
        ...root,
        id: p.id,
        name: p.name,
        pattern: p.pattern,
        muted:
          root.muted || p.pattern.layers.some((l) => l.id === "mute-" + p.id),
      };
      return { voice: v, events: p.events, settings: settings(v) };
    }),
  };
}
export function searchTargets(doc: Doc, q: string): Target[] {
  return targets(doc).filter(
    (t) =>
      !("kind" in t.node && t.node.kind === "settings") &&
      t.path.join(" ").toLowerCase().includes(q.toLowerCase()),
  );
}
