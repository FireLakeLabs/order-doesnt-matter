import { expect, it } from "vitest";
import { importStrudel, generate, queryEvents } from "./adapter";
import { constellation, searchTargets } from "./scene";
import { song, currentSection, instrumentEvents } from "./song";
import { tagVoices } from "./query-document";
import { targets, update } from "./document";
it("shows one named instrument reused in sections and edits every occurrence", async () => {
  const d = importStrudel(
    `const kick=s("bd*4").gain(.5); const intro=stack(kick); const drop=stack(kick,s("hh*8")); arrange([4,intro],[8,drop],[4,intro])`,
  ).doc;
  const s = song(d);
  expect(s.sections.map((s) => [s.name, s.start, s.cycles])).toEqual([
    ["intro", 0, 4],
    ["drop", 4, 8],
    ["intro", 12, 4],
  ]);
  expect(s.instruments.map((i) => i.name)).toEqual(["kick", "hi-hat"]);
  expect(s.instruments[0]?.sections).toEqual([0, 1, 2]);
  expect(currentSection(s.sections, 17, s.total)?.name).toBe("intro");
  const t = targets(d).find((t) => t.setting?.name === "gain");
  expect(t).toBeDefined();
  const edited = update(d, t!.id, (t) => {
    t.pattern.core = { kind: "constant", value: 0.8 };
  });
  const r = await queryEvents(generate(tagVoices(edited)), 0, 16);
  expect(r.error).toBeNull();
  const kicks = instrumentEvents(song(edited).instruments[0]!, {
    [d.voices[0]!.id]: r.events,
  });
  expect(kicks).toHaveLength(64);
  expect(
    kicks.every(
      (e) =>
        typeof e.value === "object" &&
        e.value !== null &&
        Reflect.get(e.value, "gain") === 0.8,
    ),
  ).toBe(true);
});

it("keeps simultaneous pitches in separate miniature lanes", async () => {
  const { eventLanes } = await import("./miniature");
  const r = await queryEvents('note("[c4,eb4,g4,bb4]").s("piano")', 0, 1);
  expect(r.error).toBeNull();
  const drawing = eventLanes(r.events);
  expect(drawing.keys).toHaveLength(4);
  expect(new Set(drawing.parts.map((p) => p.track)).size).toBe(4);
  expect(
    drawing.parts.every((p) => p.event.part[0] === 0 && p.event.part[1] === 1),
  ).toBe(true);
});

it("keeps moon circles and shell labels apart in a dense constellation", () => {
  const d = importStrudel(
    'note("c3").s("sawtooth").fast(2).gain(".2 .8").slow(3).pan(.3).room(.4).delay(.2).attack(.1).release(.5).cut(2).lpf(800).ply(2).late(.1).rev().early(.1).slow(2)',
  ).doc;
  const { planets } = constellation(d, {});
  for (const p of planets) {
    const moons = p.nodes.filter((n) => n.kind === "setting");
    for (let j = 0; j < moons.length; j++) {
      const a = moons[j]!;
      expect(Math.hypot(a.x - p.x, a.y - p.y)).toBeGreaterThan(
        p.radius + a.r + 3,
      );
      expect(Math.abs(a.x - p.x) + a.r).toBeLessThan(200);
      for (const b of moons.slice(j + 1))
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r + 5);
    }
  }
});
it("retains old shared values before an aligned edit and new values after it", async () => {
  const { atBoundary } = await import("./query-document");
  const before = importStrudel(
    'const bass=note("c2").gain(.2); arrange([4,bass],[4,bass])',
  ).doc;
  const t = targets(before).find((t) => t.setting?.name === "gain")!;
  const after = update(before, t.id, (t) => {
    t.pattern.core = { kind: "constant", value: 0.9 };
  });
  const r = await queryEvents(generate(atBoundary(before, after, 1)), 0, 2);
  expect(r.error).toBeNull();
  expect(r.events.map((e) => e.value)).toEqual([
    { gain: 0.2, note: "c2" },
    { gain: 0.9, note: "c2" },
  ]);
});
it("finds section-specific settings by their author instrument and human setting name", () => {
  const { doc } = importStrudel(
    'const chords=note("[c4,e4,g4]").s("piano"); arrange([4,chords.lpf(600)],[4,chords])',
  );
  expect(
    searchTargets(doc, "chords filter").some(
      (t) => t.setting?.name === "cutoff",
    ),
  ).toBe(true);
});
it("gives canonical imported cutoff names the frequency control units and range", async () => {
  const { controlInfo } = await import("./controls");
  expect(controlInfo("cutoff")).toMatchObject({
    unit: "Hz",
    min: 20,
    max: 16000,
  });
  expect(controlInfo("hcutoff")).toMatchObject({
    unit: "Hz",
    min: 20,
    max: 16000,
  });
});
