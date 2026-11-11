import { describe, it, expect } from "vitest";
import {
  cosmos,
  overlaps,
  roomContains,
  pulse,
  driverValue,
  type Detail,
} from "./cosmos";
import { fixtures, constant, setting, bag } from "./fixtures";
import {
  importStrudel,
  generate,
  queryEvents,
  type PlainEvent,
} from "./adapter";
import { tagVoices } from "./query-document";
const sources = import.meta.glob("../../../corpus/programs/*.strudel", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const levels: Detail[] = ["far", "middle", "near"];
const pieces = [
  "real-techno",
  "real-house-vocals",
  "real-dnb-arranged",
  "real-dubstep-arranged",
  "micro-orbit-conflict",
];
async function material(name: string) {
  const doc = importStrudel(
    sources[`../../../corpus/programs/${name}.strudel`]!,
  ).doc;
  const q = await queryEvents(generate(tagVoices(doc, true)), 0, 1);
  expect(q.error).toBeNull();
  return {
    doc,
    events: Object.fromEntries(
      doc.voices.map((v) => [
        v.id,
        q.events.filter(
          (e) =>
            e.value &&
            typeof e.value === "object" &&
            Reflect.get(e.value, "__voice") === v.id,
        ),
      ]),
    ),
  };
}
describe("a continuous space with honest containment", () => {
  it("fits every far planet within the declared camera bounds, including twenty voices", () => {
    const scene = cosmos(fixtures[2]!.doc, {}, "far"),
      b = scene.bounds;
    expect(scene.systems).toHaveLength(20);
    for (const viewport of [
      { width: 1200, height: 640, minRadius: 14 },
      { width: 390, height: 500, minRadius: 8 },
    ]) {
      const scale = Math.min(
        viewport.width / (b.width + 96),
        viewport.height / (b.height + 96),
      );
      expect(30 * scale).toBeGreaterThanOrEqual(viewport.minRadius);
    }
    for (const [i, a] of scene.systems.entries())
      for (const other of scene.systems.slice(i + 1))
        expect(overlaps(a, other)).toBe(false);
    for (const s of scene.systems) {
      expect(s.x - s.r).toBeGreaterThanOrEqual(b.x);
      expect(s.y - s.r).toBeGreaterThanOrEqual(b.y);
      expect(s.x + s.r).toBeLessThanOrEqual(b.x + b.width);
      expect(s.y + s.r).toBeLessThanOrEqual(b.y + b.height);
    }
  });
  it("keeps systems apart and room territories exclude every nonmember in real pieces", async () => {
    for (const name of pieces) {
      const { doc, events } = await material(name);
      for (const detail of levels) {
        const s = cosmos(doc, events, detail);
        for (const [i, a] of s.systems.entries())
          for (const b of s.systems.slice(i + 1))
            expect(
              overlaps(a, b),
              `${name}/${detail}: ${a.planet.name}, ${b.planet.name}`,
            ).toBe(false);
        for (const room of s.rooms)
          for (const system of s.systems)
            expect(
              roomContains(room, s.systems, system),
              `${name}/${detail}/room ${room.id}/${system.planet.name}`,
            ).toBe(room.members.includes(system.planet.id));
        for (const room of s.rooms)
          for (const sys of s.systems)
            for (let i = 0; i < 16; i++) {
              const a = (i * Math.PI) / 8;
              const point = {
                x: sys.x + Math.cos(a) * sys.r,
                y: sys.y + Math.sin(a) * sys.r,
              };
              expect(
                roomContains(room, s.systems, point),
                `${name}/${detail}/room ${room.id}: full ${sys.planet.name} footprint`,
              ).toBe(room.members.includes(sys.planet.id));
            }
        const inspect = (nodes: (typeof s.systems)[number]["moons"]) => {
          for (const [i, n] of nodes.entries()) {
            for (const other of nodes.slice(i + 1))
              expect(
                overlaps(n, other),
                `${name}: ${n.name} / ${other.name}`,
              ).toBe(false);
            inspect(n.children);
          }
        };
        for (const sys of s.systems) inspect(sys.moons);
      }
    }
  });
  it("does not move existing systems on value edits, mute, or adding one constant", () => {
    const doc = structuredClone(fixtures[2]!.doc),
      a = cosmos(doc, {}, "middle");
    const v = doc.voices[0]!;
    v.muted = true;
    const first = v.pattern.layers.find((l) => l.kind === "settings");
    if (first?.kind === "settings")
      first.settings.find((s) => s.name === "gain")!.value = constant(0.73);
    const b = cosmos(doc, {}, "middle", 0, a.positions);
    expect(b.systems.map((s) => [s.x, s.y])).toEqual(
      a.systems.map((s) => [s.x, s.y]),
    );
    v.pattern.layers.push(bag([setting("attack", constant(0.01))]));
    const c = cosmos(doc, {}, "middle", 0, b.positions);
    expect(c.systems.slice(1).map((s) => [s.x, s.y])).toEqual(
      b.systems.slice(1).map((s) => [s.x, s.y]),
    );
  });
  it("keeps settings inside the correct ordered shell and constants on one outer orbit", () => {
    const scene = cosmos(fixtures[0]!.doc, {}, "near");
    for (const s of scene.systems) {
      for (const m of s.moons) {
        const d = Math.hypot(m.x, m.y);
        const stat = m.value.core.kind === "constant";
        if (stat) expect(d).toBeCloseTo(s.outer);
        else {
          const next = s.planet.pattern.layers
            .slice(m.layer)
            .find((l) => l.kind !== "settings");
          const shell = s.shells.find((sh) => sh.id === next?.id);
          if (shell) expect(d + m.r).toBeLessThan(shell.r);
        }
      }
    }
  });
  it("nests driver disks fully inside their owner and keeps sibling moons apart", () => {
    const scene = cosmos(fixtures[4]!.doc, {}, "near");
    for (const s of scene.systems)
      for (const [i, m] of s.moons.entries()) {
        for (const b of s.moons.slice(i + 1))
          expect(overlaps(m, b), m.name + " / " + b.name).toBe(false);
        const visit = (n: typeof m) => {
          for (const c of n.children) {
            expect(Math.hypot(c.x, c.y) + c.r).toBeLessThanOrEqual(n.r);
            visit(c);
          }
        };
        visit(m);
      }
  });
  it("shows room conflict without choosing an outcome and excludes zero sends", async () => {
    const { doc, events } = await material("micro-orbit-conflict");
    const s = cosmos(doc, events, "far");
    expect(s.rooms).toHaveLength(1);
    expect(s.rooms[0]).toMatchObject({ id: "0", conflict: true });
    expect(s.rooms[0]).not.toHaveProperty("winner");
    const noSend = importStrudel("s('bd').room(0).delay(0).orbit(0)").doc;
    expect(cosmos(noSend, {}, "far").rooms).toEqual([]);
  });
  it("pulses on actual onsets, not continuations or invented subdivisions", () => {
    const e: PlainEvent = {
      whole: [0.37, 0.81],
      part: [0.37, 0.81],
      value: { s: "bd" },
      hasOnset: true,
      cycle: 0,
    };
    expect(pulse([e], 0.36, 60)).toBe(0);
    expect(pulse([e], 0.37, 60)).toBe(1);
    expect(pulse([e], 0.5, 60)).toBeLessThan(0.2);
    expect(pulse([e], 0.75, 60)).toBe(0);
    expect(pulse([{ ...e, hasOnset: false, part: [0.5, 0.81] }], 0.5, 60)).toBe(
      0,
    );
    expect(
      driverValue(
        [
          {
            part: [0.37, 0.4],
            whole: null,
            value: { value: 237 },
            hasOnset: false,
            cycle: 0,
          },
        ],
        0.38,
      ),
    ).toBe(237);
  });
  it("keeps one planet per reused instrument while dimming section absences", async () => {
    const { doc } = await material("real-dnb-arranged"),
      a = cosmos(doc, {}, "far", 0),
      b = cosmos(doc, {}, "far", 8, a.positions);
    expect(b.systems.map((s) => s.planet.id)).toEqual(
      a.systems.map((s) => s.planet.id),
    );
    expect(a.systems.some((s) => !s.planet.active)).toBe(true);
    expect(b.systems.filter((s) => s.planet.active).length).toBeGreaterThan(
      a.systems.filter((s) => s.planet.active).length,
    );
  });
});
