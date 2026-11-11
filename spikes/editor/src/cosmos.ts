import type { Doc, Pattern, Setting } from "../../import/src/document";
import type { PlainEvent } from "./adapter";
import { constellation, valueAt, type Planet, type EventMap } from "./scene";
import { humanName } from "./song";
import { staticValue } from "./miniature";
export type Detail = "far" | "middle" | "near";
export interface Disk {
  x: number;
  y: number;
  r: number;
}
export interface Satellite extends Disk {
  id: string;
  name: string;
  value: Pattern;
  children: Satellite[];
  layer: number;
  shells?: System["shells"];
}
export interface System extends Disk {
  planet: Planet;
  moons: Satellite[];
  shells: { id: string; name: string; r: number }[];
  outer: number;
}
export interface Room {
  id: string;
  members: string[];
  conflict: boolean;
  settings: string[];
}
const roomKeys = [
  "roomsize",
  "roomfade",
  "roomlp",
  "roomdim",
  "delaytime",
  "delayfeedback",
];
function children(p: Pattern): Pattern[] {
  return p.layers.flatMap((l) =>
    l.kind === "rewrite"
      ? l.args.flatMap((a) =>
          a.kind === "pattern"
            ? [a.pattern]
            : a.kind === "callback"
              ? [a.body]
              : [],
        )
      : [],
  );
}
function satellite(
  id: string,
  name: string,
  p: Pattern,
  layer: number,
  seen = new Set<string>(),
): Satellite {
  if (seen.has(p.id))
    return { id, name, value: p, x: 0, y: 0, r: 30, children: [], layer };
  const next = new Set(seen).add(p.id);
  const nested = children(p).map((c) =>
    satellite(
      c.id,
      c.core.kind === "signal" ? c.core.shape : c.core.kind,
      c,
      layer,
      next,
    ),
  );
  // Nested disks contain their children. Ownership is spatial, never a wire.
  const r = nested.length
    ? Math.max(30, ...nested.map((c) => c.r)) + 44
    : p.core.kind === "signal"
      ? 42
      : 27;
  if (nested.length === 1) {
    nested[0]!.x = 0;
    nested[0]!.y = 16;
  } else if (nested.length > 1) {
    const width = nested.reduce((n, c) => n + 2 * c.r + 8, 0);
    let cursor = -width / 2;
    for (const c of nested) {
      c.x = cursor + c.r;
      c.y = 22;
      cursor += 2 * c.r + 8;
    }
    return {
      id,
      name,
      value: p,
      x: 0,
      y: 0,
      r: Math.max(r, width / 2 + 20),
      children: nested,
      layer,
    };
  }
  return { id, name, value: p, x: 0, y: 0, r, children: nested, layer };
}
export function system(p: Planet): System {
  const constants: Satellite[] = [],
    bands: Satellite[][] = [[]],
    shells: System["shells"] = [];
  for (const [layer, l] of p.pattern.layers.entries()) {
    if (l.kind === "settings")
      for (const s of l.settings) {
        const moon = satellite(s.id, s.name, s.value, layer);
        (staticValue(s.value) !== undefined ? constants : bands.at(-1)!).push(
          moon,
        );
      }
    else {
      shells.push({
        id: l.id,
        name: l.kind === "rewrite" ? l.name : "source",
        r: 0,
      });
      bands.push([]);
    }
  }
  let inner = 38;
  function orbit(nodes: Satellite[], minimum: number) {
    if (!nodes.length) return minimum;
    const max = Math.max(...nodes.map((n) => n.r));
    let radius = Math.max(
      minimum + max + 10,
      nodes.reduce((a, n) => a + 2 * n.r + 18, 0) / (Math.PI * 1.65),
    );
    // Adjacent arc distances depend on preceding contents, not the total count.
    // Appending a small setting leaves existing angles alone until the ring fills.
    for (let attempt = 0; attempt < 100; attempt++) {
      let angle = -Math.PI / 2;
      for (const [j, n] of nodes.entries()) {
        if (j) {
          const previous = nodes[j - 1]!;
          angle +=
            2 *
            Math.asin(Math.min(0.99, (previous.r + n.r + 14) / (2 * radius)));
        }
        n.x = Math.cos(angle) * radius;
        n.y = Math.sin(angle) * radius;
      }
      if (
        nodes.every((n, j) =>
          nodes.slice(j + 1).every((other) => !overlaps(n, other, 10)),
        )
      )
        return radius + max;
      radius += 10;
    }
    throw Error("Unable to place setting moons");
  }
  for (const [index, band] of bands.entries()) {
    inner = orbit(band, inner);
    const sh = shells[index];
    if (sh) {
      sh.r = inner + 24;
      inner = sh.r + 12;
    }
  }
  if (p.pattern.core.kind === "group") {
    for (const part of p.pattern.core.parts) {
      const childPattern = part.pattern;
      const child = {
          ...p,
          id: part.pattern.id,
          pattern: childPattern,
          name: humanName(childPattern),
        },
        geometry = system(child);
      const nodes = geometry.moons;
      let radius = 27;
      if (geometry.shells.length) radius = geometry.r;
      else if (nodes.length === 1) {
        const node = nodes[0]!;
        node.x = 0;
        node.y = 20;
        radius = node.r + 52;
      } else if (nodes.length > 1) {
        const biggest = Math.max(...nodes.map((n) => n.r));
        const orbit = Math.max(
          biggest + 18,
          nodes.reduce((a, n) => a + n.r * 2 + 14, 0) / (Math.PI * 1.6),
        );
        for (const [j, n] of nodes.entries()) {
          const a = -Math.PI / 2 + (j * 2 * Math.PI) / nodes.length;
          n.x = Math.cos(a) * orbit;
          n.y = Math.sin(a) * orbit + 10;
        }
        radius = orbit + biggest + 38;
      }
      constants.push({
        id: part.pattern.id,
        name: humanName(childPattern),
        value: childPattern,
        layer: -1,
        x: 0,
        y: 0,
        r: radius,
        children: nodes,
        shells: geometry.shells,
      });
    }
  }
  const outer = orbit(constants, inner),
    moons = [...bands.flat(), ...constants];
  return {
    planet: p,
    x: 0,
    y: 0,
    r: Math.max(64, outer + 48),
    moons,
    shells,
    outer: constants.length
      ? Math.hypot(constants[0]!.x, constants[0]!.y)
      : outer,
  };
}
function allSettings(
  p: Pattern,
  doc: Doc,
  seen = new Set<string>(),
): Setting[] {
  if (seen.has(p.id)) return [];
  seen.add(p.id);
  return [
    ...p.layers.flatMap((l) => (l.kind === "settings" ? l.settings : [])),
    ...(p.core.kind === "group"
      ? p.core.parts.flatMap((c) => allSettings(c.pattern, doc, seen))
      : p.core.kind === "ref" && doc.shared[p.core.name]
        ? allSettings(doc.shared[p.core.name]!, doc, seen)
        : []),
  ];
}
export function sharedRooms(systems: System[], doc: Doc): Room[] {
  const rooms = new Map<
    string,
    { members: Set<string>; values: Map<string, Set<string>> }
  >();
  for (const s of systems) {
    const ss = allSettings(s.planet.pattern, doc);
    const senders = s.planet.events.filter(
      (e) => Number(valueAt(e, "room")) > 0 || Number(valueAt(e, "delay")) > 0,
    );
    const staticSend = ss.some(
      (x) =>
        ["room", "delay"].includes(x.name) &&
        Number(staticValue(x.value) ?? 1) > 0,
    );
    const ids = new Set(senders.map((e) => String(valueAt(e, "orbit") ?? 1)));
    if (!s.planet.events.length && staticSend)
      for (const v of ss.filter((x) => x.name === "orbit"))
        ids.add(String(staticValue(v.value) ?? 1));
    if (!ids.size && staticSend && !s.planet.events.length) ids.add("1");
    for (const id of ids) {
      let room = rooms.get(id);
      if (!room) {
        room = { members: new Set(), values: new Map() };
        rooms.set(id, room);
      }
      room.members.add(s.planet.id);
      for (const key of roomKeys) {
        const vals = senders
          .filter((e) => String(valueAt(e, "orbit") ?? 1) === id)
          .map((e) => String(valueAt(e, key) ?? "default"));
        if (!vals.length)
          vals.push(
            ...ss
              .filter((x) => x.name === key)
              .map((x) => String(staticValue(x.value) ?? "pattern")),
          );
        if (!vals.length) vals.push("default");
        const set = room.values.get(key) ?? new Set<string>();
        for (const v of vals) set.add(v);
        room.values.set(key, set);
      }
    }
  }
  return [...rooms].map(([id, r]) => ({
    id,
    members: [...r.members],
    conflict: [...r.values.values()].some((v) => v.size > 1),
    settings: [...r.values]
      .filter(([, v]) => ![...v].every((x) => x === "default"))
      .map(([k, v]) => `${k} ${[...v].join(" / ")}`),
  }));
}
export const overlaps = (a: Disk, b: Disk, gap = 0) =>
  Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r + gap - 0.01;
export function pack(
  items: { id: string; r: number; room: string }[],
  previous = new Map<string, Disk>(),
): Map<string, Disk> {
  const placed = new Map<string, Disk>();
  for (const item of items) {
    const old = previous.get(item.id);
    if (old && !overlapAny({ ...old, r: item.r }))
      placed.set(item.id, { ...old, r: item.r });
  }
  function overlapAny(d: Disk) {
    return [...placed.values()].some((p) => overlaps(d, p, 44));
  }
  for (const item of items.filter((i) => !placed.has(i.id))) {
    const peers = items
      .filter((i) => i.room === item.room)
      .flatMap((i) => (placed.get(i.id) ? [placed.get(i.id)!] : []));
    const anchor = peers.length
      ? {
          x: peers.reduce((n, p) => n + p.x, 0) / peers.length,
          y: peers.reduce((n, p) => n + p.y, 0) / peers.length,
        }
      : { x: 0, y: 0 };
    let best: Disk | undefined,
      score = Infinity;
    for (
      let ring = 0;
      ring < 180 && ring * 24 <= score + item.r * 2 + 100;
      ring++
    )
      for (let j = 0; j < (ring ? 48 : 1); j++) {
        const a = (j / 48) * Math.PI * 2,
          d = {
            x: anchor.x + Math.cos(a) * ring * 24,
            y: anchor.y + Math.sin(a) * ring * 24,
            r: item.r,
          };
        if (overlapAny(d)) continue;
        const cost =
          Math.hypot(d.x, d.y) * 0.4 +
          Math.hypot(d.x - anchor.x, d.y - anchor.y);
        if (cost < score) {
          best = d;
          score = cost;
        }
      }
    if (!best) throw Error("Unable to pack systems");
    placed.set(item.id, best);
  }
  return placed;
}
export function bounds(disks: Disk[]) {
  if (!disks.length) return { x: -100, y: -100, width: 200, height: 200 };
  const x = Math.min(...disks.map((d) => d.x - d.r)),
    y = Math.min(...disks.map((d) => d.y - d.r));
  return {
    x,
    y,
    width: Math.max(...disks.map((d) => d.x + d.r)) - x,
    height: Math.max(...disks.map((d) => d.y + d.r)) - y,
  };
}
export function cosmos(
  doc: Doc,
  events: EventMap,
  detail: Detail,
  cycle = 0,
  previous = new Map<string, Disk>(),
) {
  const systems = constellation(doc, events, new Set(), 3, cycle).planets.map(
      system,
    ),
    rooms = sharedRooms(systems, doc);
  const items = systems.map((s) => ({
    id: s.planet.id,
    r: detail === "far" ? 68 : s.r,
    room: rooms
      .filter((r) => r.members.includes(s.planet.id))
      .map((r) => r.id)
      .join(","),
  }));
  // Stable document order inside each room; a value edit cannot reshuffle peers.
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const list = groups.get(item.room) ?? [];
    list.push(item);
    groups.set(item.room, list);
  }
  const positions = new Map<string, Disk>();
  // Previous placements win if an edit has not changed the footprint.
  const proposed = items.flatMap((i) => {
    const p = previous.get(i.id);
    return p ? [{ ...p, r: i.r }] : [];
  });
  const reuse =
    proposed.length === items.length &&
    previous.size === items.length &&
    proposed.every((p, i) =>
      proposed.slice(i + 1).every((other) => !overlaps(p, other, 32)),
    );
  if (reuse)
    for (const item of items)
      positions.set(item.id, { ...previous.get(item.id)!, r: item.r });
  else {
    const clusters = [...groups].map(([room, list]) => {
      const local = pack(list);
      const box = bounds([...local.values()]);
      return { room, list, local, box };
    });
    const area = clusters.reduce(
      (n, c) => n + (c.box.width + 64) * (c.box.height + 64),
      0,
    );
    const target = Math.max(
      ...clusters.map((c) => c.box.width + 64),
      Math.sqrt(area * 1.6),
    );
    let x = 0,
      y = 0,
      rowHeight = 0;
    for (const c of clusters) {
      if (x && x + c.box.width + 64 > target) {
        x = 0;
        y += rowHeight + 64;
        rowHeight = 0;
      }
      for (const item of c.list) {
        const p = c.local.get(item.id)!;
        positions.set(item.id, {
          x: p.x - c.box.x + x,
          y: p.y - c.box.y + y,
          r: item.r,
        });
      }
      x += c.box.width + 64;
      rowHeight = Math.max(rowHeight, c.box.height);
    }
  }
  const extent = bounds([...positions.values()]);
  const center = {
    x: extent.x + extent.width / 2,
    y: extent.y + extent.height / 2,
  };
  for (const s of systems) {
    const p = positions.get(s.planet.id)!;
    s.x = p.x;
    s.y = p.y;
    if (!s.planet.active) {
      const a = Math.atan2(s.y - center.y, s.x - center.x);
      s.x += Math.cos(a) * 12;
      s.y += Math.sin(a) * 12;
    }
    if (detail === "far") s.r = 68;
  }
  return { systems, rooms, positions, bounds: bounds(systems) };
}
export function hull(points: { x: number; y: number }[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: (typeof points)[number], a: typeof o, b: typeof o) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (ps: typeof points) => {
    const out: typeof points = [];
    for (const p of ps) {
      while (out.length > 1 && cross(out.at(-2)!, out.at(-1)!, p) <= 0)
        out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.reverse())];
}
export function territory(members: System[]) {
  return hull(
    members.flatMap((s) =>
      Array.from({ length: 32 }, (_, i) => ({
        x: s.x + Math.cos((i * Math.PI) / 16) * (s.r + 16),
        y: s.y + Math.sin((i * Math.PI) / 16) * (s.r + 16),
      })),
    ),
  );
}
export function roomContains(
  room: Room,
  systems: System[],
  point: { x: number; y: number },
): boolean {
  const polygon = territory(
    systems.filter((s) => room.members.includes(s.planet.id)),
  );
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!,
      b = polygon[j]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
export function pulse(
  events: PlainEvent[],
  phase: number,
  cpm: number,
): number {
  const age = events.reduce((best, e) => {
    const onset = e.whole?.[0];
    return e.hasOnset && onset !== undefined && onset <= phase
      ? Math.min(best, ((phase - onset) * 60) / cpm)
      : best;
  }, Infinity);
  return Math.max(0, 1 - age / 0.16);
}
export function driverValue(events: PlainEvent[], phase: number): unknown {
  const sample = events.find((e) => e.part[0] <= phase && e.part[1] > phase);
  return sample ? valueAt(sample, "value") : undefined;
}
