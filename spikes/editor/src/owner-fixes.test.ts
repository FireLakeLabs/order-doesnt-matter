import { expect, it } from "vitest";
import techno from "../../../corpus/programs/real-techno.strudel?raw";
import houseSketch from "../../../corpus/programs/real-house.strudel?raw";
import house from "../../../corpus/programs/real-house-vocals.strudel?raw";
import { importStrudel, generate, queryEvents } from "./adapter";
import { History, toggleMute, addSetting, targets } from "./document";
import { song } from "./song";
import { sheet, constellation } from "./scene";
import { tagVoices, atBoundary } from "./query-document";

for (const name of ["real-techno", "real-house-vocals"]) {
  it(`${name}: mute is instrument state, survives editing/history, and removes exactly its events in every section`, async () => {
    const d = importStrudel(name === "real-techno" ? techno : house).doc;
    const instruments = song(d).instruments;
    const a = instruments[0]!,
      b = instruments[1]!;
    const history = new History(d);
    const query = async (doc: typeof d) => {
      const r = await queryEvents(
        generate(tagVoices(doc)),
        0,
        name === "real-techno" ? 4 : 28,
      );
      expect(r.error).toBeNull();
      return r.events;
    };
    const baseline = await query(d);
    const tag = (e: (typeof baseline)[number]) =>
      Reflect.get(e.value as object, "__planet");
    const check = async (muted: string[]) => {
      expect(await query(history.doc)).toEqual(
        baseline.filter((e) => !muted.includes(String(tag(e)))),
      );
      for (const cycle of name === "real-techno" ? [0, 2] : [0, 4, 8, 16, 20]) {
        expect(
          sheet(history.doc, {}, cycle)
            .rows.filter((r) => r.voice.muted)
            .map((r) => r.voice.id)
            .sort(),
        ).toEqual([...muted].sort());
        expect(
          constellation(history.doc, {}, new Set(), 3, cycle)
            .planets.filter((p) => p.muted)
            .map((p) => p.id)
            .sort(),
        ).toEqual([...muted].sort());
      }
    };
    history.set(toggleMute(history.doc, a.id));
    expect(song(history.doc).instruments[0]!.pattern.muted).toBe(true);
    expect(song(history.doc).instruments[0]!.pattern.layers).toEqual(
      a.pattern.layers,
    );
    await check([a.id]);
    history.set(toggleMute(history.doc, b.id));
    await check([a.id, b.id]);
    history.set(toggleMute(history.doc, a.id));
    await check([b.id]);
    // A real control edit on the muted instrument keeps its identity/state,
    // and leaves the other instruments' audible events unchanged.
    history.set(addSetting(history.doc, b.id, "gain"));
    expect(generate(history.doc)).toContain(".gain(0.3)");
    await check([b.id]);
    history.undo();
    history.undo();
    await check([a.id, b.id]);
    history.redo();
    await check([b.id]);
    const boundary = await queryEvents(
      generate(atBoundary(tagVoices(d), tagVoices(history.doc), 1)),
      0,
      2,
    );
    expect(boundary.error).toBeNull();
    expect(
      boundary.events
        .filter((e) => e.part[0] >= 1)
        .some((e) => tag(e) === b.id),
    ).toBe(false);
  });
}

it("generated instrument mute survives import and can then be removed", async () => {
  let d = importStrudel(
    'const kick=s("bd*4"); arrange([2,stack(kick,s("hh*4"))],[2,kick])',
  ).doc;
  d = toggleMute(d, song(d).instruments[0]!.id);
  const roundtrip = importStrudel(generate(d)).doc;
  expect(song(roundtrip).instruments[0]!.pattern.muted).toBe(true);
  const unmuted = toggleMute(roundtrip, song(roundtrip).instruments[0]!.id);
  const q = await queryEvents(generate(unmuted), 0, 4);
  expect(q.error).toBeNull();
  expect(
    q.events.filter((e) => Reflect.get(e.value as object, "s") === "bd"),
  ).toHaveLength(16);
});

it("rejects a stale row ID which now names a driver in another document", () => {
  const old = importStrudel(houseSketch).doc;
  const next = importStrudel(techno).doc;
  const staleRow = song(old).instruments[1]!;
  expect(targets(next).find((t) => t.id === staleRow.id)?.setting?.name).toBe(
    "shape",
  );
  const before = generate(next);
  expect(() => toggleMute(next, staleRow.id)).toThrow(
    "Instrument no longer exists",
  );
  expect(generate(next)).toBe(before);
  expect(old).not.toEqual(next);
});
