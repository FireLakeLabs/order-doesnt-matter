import { describe, it, expect } from "vitest";
import {
  fixtures,
  pattern,
  bag,
  setting,
  constant,
  shell,
  sequence,
} from "./fixtures";
import {
  History,
  targets,
  update,
  changeStep,
  moveShell,
  addSetting,
  addVoice,
  paintSequence,
  toggleMute,
} from "./document";
import { generate, queryEvents, importStrudel } from "./adapter";
import { tagVoices, atBoundary } from "./query-document";
import { constellation, sheet, rooms, span, searchTargets } from "./scene";
const small = () => structuredClone(fixtures[0]!.doc);
const one = () => {
  const d = small();
  d.voices = d.voices.slice(0, 1);
  const v = d.voices[0]!;
  v.pattern = pattern(
    {
      kind: "generator",
      name: "note",
      args: [
        {
          kind: "pattern",
          pattern: sequence([
            { kind: "value", value: "60", weight: 2 },
            {
              kind: "sub",
              steps: [{ kind: "value", value: "64" }, { kind: "rest" }],
            },
          ]),
        },
      ],
    },
    [bag([setting("s", constant("sine"))])],
  );
  return d;
};
async function query(d: ReturnType<typeof small>) {
  const r = await queryEvents(generate(d), 0, 1);
  expect(r.error).toBeNull();
  return r.events;
}
describe("document to real Strudel events", () => {
  it("queries all six fixtures including unequal weights, alternation, rules, opaque code and nested signals", async () => {
    for (const f of fixtures) {
      const r = await queryEvents(generate(f.doc), 0, 1);
      expect(r.error, f.id).toBeNull();
      expect(r.events.length, f.id).toBeGreaterThan(0);
    }
  });
  it("preserves unequal spans and rests without an equal-step grid", async () => {
    expect((await query(one())).map((e) => e.whole)).toEqual([
      [0, 2 / 3],
      [2 / 3, 5 / 6],
    ]);
  });
  it("splits, merges, rests, changes and stretches typed structure and the resulting score", async () => {
    let d = one(),
      id = targets(d).find((t) => t.label === "typed sequence")!.id;
    d = update(d, id, (t) => changeStep(t.pattern, [0], "split"));
    expect((await query(d)).map((e) => e.whole)).toEqual([
      [0, 1 / 3],
      [1 / 3, 2 / 3],
      [2 / 3, 5 / 6],
    ]);
    d = update(d, id, (t) => changeStep(t.pattern, [0], "merge"));
    expect((await query(d)).map((e) => e.whole)).toEqual([
      [0, 2 / 3],
      [2 / 3, 5 / 6],
    ]);
    d = update(d, id, (t) => changeStep(t.pattern, [0], "rest"));
    expect((await query(d)).length).toBe(1);
  });
  it("weight editing and alternate cycles change queried timing and values", async () => {
    let d = one(),
      id = targets(d).find((t) => t.label === "typed sequence")!.id;
    d = update(d, id, (t) => changeStep(t.pattern, [0], "weight", "1"));
    expect((await query(d))[0]!.whole).toEqual([0, 0.5]);
    d = update(d, id, (t) => changeStep(t.pattern, [0], "alternate"));
    const a = await queryEvents(generate(d), 0, 2);
    expect(a.error).toBeNull();
    expect(
      a.events.some(
        (e) =>
          typeof e.value === "object" &&
          e.value !== null &&
          Number(Reflect.get(e.value, "note")) === 72,
      ),
    ).toBe(true);
  });
  it("rewrite order changes events and keeps settings at their own layer", async () => {
    const d = one(),
      v = d.voices[0]!;
    v.pattern.layers.push(shell("late", [0.25]), shell("fast", [2]));
    const fast = v.pattern.layers.at(-1)!;
    const before = await query(d);
    const moved = moveShell(d, fast.id, -1);
    expect((await query(moved)).map((e) => e.whole)).not.toEqual(
      before.map((e) => e.whole),
    );
    expect(v.pattern.layers.at(-1)!.id).toBe(fast.id);
  });
  it("reports evaluation and query errors as broken, not a successful empty score", async () => {
    expect((await queryEvents("this is broken", 0, 1)).error).toBeTruthy();
    expect(
      (
        await queryEvents(
          "note('60').fmap(()=>{throw Error('intentional')})",
          0,
          1,
        )
      ).error,
    ).toContain("intentional");
    expect(await queryEvents("silence", 0, 1)).toMatchObject({
      events: [],
      error: null,
    });
  });
  it("undo/redo restores the generated score", () => {
    const d = small(),
      h = new History(d),
      initial = generate(d);
    h.set(addSetting(d, d.voices[0]!.id, "crush"));
    expect(generate(h.doc)).not.toBe(initial);
    h.undo();
    expect(generate(h.doc)).toBe(initial);
    h.redo();
    expect(generate(h.doc)).toContain(".crush(");
  });
});
describe("pure maps and selection", () => {
  it("makes all 20 voices discoverable with a one-query specific-setting search", () => {
    const d = fixtures[2]!.doc;
    expect(
      searchTargets(d, "shore lpf").filter((t) => t.label === "lpf"),
    ).toHaveLength(1);
    expect(sheet(d, {}).rows).toHaveLength(20);
    expect(constellation(d, {}).planets).toHaveLength(20);
  });
  it("retains setting shell-level identity; collapsing hides moons but not rhythm or shells", () => {
    const d = small(),
      v = d.voices[0]!,
      a = constellation(d, {}),
      p = a.planets.find((p) => p.id === v.id)!;
    const room = settingsFor(v, "room");
    expect(p.nodes.find((n) => n.id === room.id)!.level).toBe(2);
    const c = constellation(d, {}, new Set([v.id])).planets.find(
      (p) => p.id === v.id,
    )!;
    expect(c.nodes).toHaveLength(0);
    expect(c.shells).toHaveLength(2);
  });
  it("uses actual fractional event spans for cells", async () => {
    const d = one(),
      es = await query(d),
      s = sheet(d, { [d.voices[0]!.id]: es });
    expect(span(s.rows[0]!.events[1]!, 0)).toEqual([2 / 3, 5 / 6]);
  });
  it("marks shared-room disagreement as conflict without predicting a winner", async () => {
    const d = small(),
      ev: Record<string, Awaited<ReturnType<typeof query>>> = {};
    for (const v of d.voices) {
      const one = { ...d, voices: [v] };
      ev[v.id] = await query(one);
    }
    const room = rooms(d, ev)[0]!;
    expect(room.voices).toHaveLength(3);
    expect(room.conflict).toBe(true);
    expect(room).not.toHaveProperty("winner");
  });
  it("gives three-deep drivers stable targets and labels and renders opaque nodes distinctly", () => {
    const d = fixtures[4]!.doc,
      t = targets(d);
    expect(
      t.filter((t) => "core" in t.node && t.node.core.kind === "signal"),
    ).toHaveLength(2);
    const s = constellation(d, {});
    expect(
      s.planets[0]!.nodes.filter((n) => n.kind === "driver").length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      targets(fixtures[3]!.doc).some(
        (t) => t.node.tier === 3 && t.label.includes("source"),
      ),
    ).toBe(true);
  });
});
function settingsFor(
  v: ReturnType<typeof small>["voices"][number],
  name: string,
) {
  return v.pattern.layers
    .flatMap((l) => (l.kind === "settings" ? l.settings : []))
    .find((s) => s.name === name)!;
}

it("cycle-boundary swaps preserve old events before the boundary and new ones afterward", async () => {
  const a = one(),
    b = structuredClone(a),
    v = b.voices[0]!;
  v.pattern.layers.push(bag([setting("gain", constant(0.8))]));
  const previous = tagVoices(a),
    next = tagVoices(b);
  const r = await queryEvents(generate(atBoundary(previous, next, 1)), 0, 2);
  expect(r.error).toBeNull();
  const value = (e: (typeof r.events)[number], k: string) =>
    typeof e.value === "object" && e.value !== null
      ? Reflect.get(e.value, k)
      : undefined;
  expect(
    r.events
      .filter((e) => e.part[0] < 1)
      .every((e) => value(e, "gain") === undefined),
  ).toBe(true);
  expect(
    r.events
      .filter((e) => e.part[0] >= 1)
      .every((e) => value(e, "gain") === 0.8),
  ).toBe(true);
});

it("both maps expand grouped voices, retain true branch timing, and mute only the selected leaf", async () => {
  const d = importStrudel(
    "stack(note('60').s('sine'),note('72').s('triangle'))",
  ).doc;
  const r = await queryEvents(generate(tagVoices(d)), 0, 1);
  expect(r.error).toBeNull();
  const v = d.voices[0]!,
    es = { [v.id]: r.events };
  const rows = sheet(d, es).rows;
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.events.length)).toEqual([1, 1]);
  const muted = toggleMute(d, rows[0]!.voice.id);
  const q = await queryEvents(generate(tagVoices(muted)), 0, 1);
  expect(q.error).toBeNull();
  expect(q.events).toHaveLength(1);
  expect(
    typeof q.events[0]!.value === "object" &&
      q.events[0]!.value !== null &&
      Reflect.get(q.events[0]!.value, "note"),
  ).toBe(72);
});

it("weights an existing subgroup without losing its nested rhythm", async () => {
  const d = one(),
    id = targets(d).find((t) => t.label === "typed sequence")!.id;
  const changed = update(d, id, (t) =>
    changeStep(t.pattern, [1], "weight", "3"),
  );
  expect((await query(changed)).map((e) => e.whole)).toEqual([
    [0, 0.4],
    [0.4, 0.7],
  ]);
});
it("adding a voice to an imported document is deterministic and adds real events", async () => {
  const d = importStrudel("note('60').s('sine')").doc;
  const a = addVoice(d),
    b = addVoice(d);
  expect(d.voices).toHaveLength(1);
  const r = await queryEvents(generate(a), 0, 1);
  expect(r.error).toBeNull();
  expect(r.events.length).toBeGreaterThan(1);
  expect(a).toEqual(b);
});

it("painting a weighted driver changes the queried setting at its real boundary", async () => {
  const d = one(),
    driver = sequence([
      { kind: "value", value: "300", weight: 2 },
      { kind: "value", value: "1200" },
    ]);
  paintSequence(driver, 0.7, 2600);
  d.voices[0]!.pattern.layers.push(bag([setting("lpf", driver)]));
  const e = await query(d);
  expect(
    e.map((x) =>
      typeof x.value === "object" && x.value !== null
        ? Reflect.get(x.value, "cutoff")
        : undefined,
    ),
  ).toEqual([300, 2600]);
});
