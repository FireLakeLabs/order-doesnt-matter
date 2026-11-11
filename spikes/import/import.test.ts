import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { importStrudel, generate, queryEvents } from "./src/index.ts";
import { documentIdentity, eventIdentity } from "./src/compare.ts";
import { controlNames } from "./src/registry.ts";

async function equivalent(source: string, cycles = 2) {
  const imported = importStrudel(source),
    fresh = generate(imported.doc);
  const [original, result] = await Promise.all([
    queryEvents(source, 0, cycles),
    queryEvents(fresh, 0, cycles),
  ]);
  expect(original.error, source).toBeNull();
  expect(result.error, fresh).toBeNull();
  expect(eventIdentity(result), fresh).toBe(eventIdentity(original));
  expect(documentIdentity(importStrudel(fresh).doc), fresh).toBe(
    documentIdentity(imported.doc),
  );
  return { doc: imported.doc, result, fresh };
}
describe("document import and fresh generation", () => {
  it("discovers the installed control registry and canonicalises aliases", async () => {
    expect(controlNames.size).toBeGreaterThan(400);
    const { doc, fresh, result } = await equivalent(
      'note("c3").sound("sine").lpf(800).velocity(.7)',
    );
    const layers = doc.voices[0].pattern.layers;
    expect(layers).toHaveLength(1);
    expect(
      layers[0].kind === "settings" && layers[0].settings.map((s) => s.name),
    ).toEqual(["s", "cutoff", "velocity"]);
    expect(fresh).toContain(".cutoff(800)");
    expect(result.events[0].value).toMatchObject({
      cutoff: 800,
      velocity: 0.7,
    });
  });
  it("keeps a rhythmic setting between rewrites at its original shell", async () => {
    const { doc, result } = await equivalent(
      'note("c3 d3").fast(2).gain(".1 .5 .9").slow(3)',
    );
    expect(
      doc.voices[0].pattern.layers.map((l) =>
        l.kind === "rewrite" ? l.name : l.kind,
      ),
    ).toEqual(["fast", "settings", "slow"]);
    const hoisted = await queryEvents(
      'note("c3 d3").fast(2).slow(3).gain(".1 .5 .9")',
      0,
      2,
    );
    expect(eventIdentity(result)).not.toBe(eventIdentity(hoisted));
  });
  it("preserves both assignments of the same canonical control", async () => {
    const { doc, result } = await equivalent(
      "note(60).gain(.2).pan(.3).gain(.8)",
    );
    expect(
      doc.voices[0].pattern.layers.filter((l) => l.kind === "settings"),
    ).toHaveLength(2);
    expect(result.events[0].value).toMatchObject({ gain: 0.8, pan: 0.3 });
  });
  it("keeps the implicit lfo target ordered", async () => {
    const { doc, fresh, result } = await equivalent(
      "note(60).lpf(800).gain(.5).lfo({rate:4,depth:.8})",
    );
    expect(
      doc.voices[0].pattern.layers.map((l) =>
        l.kind === "rewrite" ? l.name : l.kind,
      ),
    ).toEqual(["settings", "gain", "lfo"]);
    expect(fresh).toContain(".gain(0.5).lfo(");
    expect(JSON.stringify(result.events[0].value)).toContain("gain");
  });
  it.each(["stack", "cat", "seq"])("models %s as a group", async (name) => {
    const { doc } = await equivalent(`${name}(note(60),note(64))`);
    expect(doc.voices[0].pattern.core).toMatchObject({
      kind: "group",
      how: name,
    });
  });
  it("models arrangement durations without flattening", async () => {
    const { doc } = await equivalent("arrange([2,note(60)],[3,note(64)])", 6);
    expect(doc.voices[0].pattern.core).toMatchObject({
      kind: "group",
      how: "arrange",
      parts: [{ cycles: 2 }, { cycles: 3 }],
    });
  });
  it("inlines single use and retains reused patterns by reference", async () => {
    const { doc } = await equivalent(
      "const one=note(60); const motif=note(64); stack(one,motif,motif.fast(2))",
    );
    expect(Object.keys(doc.shared)).toEqual(["motif"]);
    expect(generate(doc)).not.toContain("const one");
  });
  it("retains tempo, opaque setup, voice names and muting, and all()", async () => {
    const { doc, result } = await equivalent(
      'setcps(.5); await samples(\'github:test\'); hats: s("hh"); _$: s("cp"); all(p=>p.slow(2))',
    );
    expect(doc.tempo).toEqual({ cpm: 30 });
    expect(doc.setup[0].code).toContain("await samples");
    expect(doc.voices.map((v) => [v.name, v.muted])).toEqual([
      ["hats", false],
      ["_$", true],
    ]);
    expect(result.events).toHaveLength(2);
  });
  it("keeps ordered FX stages and their factory arguments", async () => {
    const { doc } = await equivalent(
      "note(60).FX(lpf(500),distort(1)).FX(gain(.5)).delay(.3)",
    );
    expect(
      doc.voices[0].pattern.layers.map((l) =>
        l.kind === "rewrite" ? l.name : l.kind,
      ),
    ).toEqual(["FX", "FX", "settings"]);
  });
  it("models nested simple callbacks with holes", async () => {
    const { doc } = await equivalent(
      "note(60).off(1/8,p=>p.superimpose(q=>q.rev().off(1/16,r=>r.fast(2))))",
    );
    expect(JSON.stringify(doc)).toContain('"kind":"hole"');
    expect(JSON.stringify(doc)).not.toContain('"kind":"opaque"');
  });
  it("models a Pattern argument to fast and settings three levels deep", async () => {
    const { doc } = await equivalent(
      "note(60).fast(sine.range(1,3).segment(4)).gain(sine.range(.1,.9).slow(sine.range(1,3).segment(2)))",
    );
    expect(JSON.stringify(doc)).toContain('"shape":"sine"');
    expect(JSON.stringify(doc)).not.toContain('"kind":"opaque"');
  });
  it.each([
    "a@2 b!3 c?",
    "[a b] <c d>",
    "{a b c}%4",
    "bd(3,8)",
    "a|b",
    "[a,b]",
    "a*2 b/3",
    "[a b,c d]",
    "<a [b c]>",
    "a [b|c] d",
  ])("parses and preserves mini %s", async (notation) => {
    const { doc } = await equivalent(`s(${JSON.stringify(notation)})`, 4);
    const core = doc.voices[0].pattern.core;
    expect(
      core.kind === "generator" &&
        core.args[0].kind === "pattern" &&
        core.args[0].pattern.core.kind,
    ).toBe("sequence");
  });
  it("keeps computed args and non-chain callbacks verbatim", async () => {
    const source =
      "note(60).withValue(v => ({...v, gain: .4})).fast(Math.max(1,2))";
    const { doc, fresh } = await equivalent(source);
    expect(JSON.stringify(doc)).toContain("v => ({...v, gain: .4})");
    expect(fresh).toContain("Math.max(1,2)");
  });
  it("preserves eval and a register body", async () => {
    const { doc, fresh } = await equivalent(
      "register('myGhost',(n,p)=>p.ply(n)); eval('note(60)').myGhost(2)",
    );
    expect(doc.setup[0].code).toContain("register('myGhost'");
    expect(fresh).toContain("eval('note(60)')");
  });
  it("generates edits from the document alone", async () => {
    const doc = importStrudel("note(60).gain(.2)").doc;
    const layer = doc.voices[0].pattern.layers[0];
    if (layer.kind !== "settings") throw Error("Expected settings");
    layer.settings[0].value.core = { kind: "constant", value: 0.9 };
    const result = await queryEvents(
      generate(JSON.parse(JSON.stringify(doc))),
      0,
      1,
    );
    expect(result.error).toBeNull();
    expect(result.events[0].value).toMatchObject({ gain: 0.9 });
  });
  it("preserves template substitutions, mutable setup and compiler directives", async () => {
    for (const source of [
      "const x='bd'; s(`xx${x}`)",
      "let x=60; x+=2; note(x)",
      "const x='bd'; s(x.toUpperCase())",
      '// mini-off\n note("60 64")\n// mini-on',
    ])
      await equivalent(source);
  });
  it("does not count shadowed callback parameters as shared references", async () => {
    const { doc } = await equivalent(
      "const p=note(60); note(64).jux(p=>p.rev())",
    );
    expect(Object.keys(doc.shared)).toEqual([]);
    expect(doc.setup[0].code).toBe("const p=note(60);");
  });
  it("preserves setup effects and the REPL choice of root expressions", async () => {
    await equivalent("console.log('setup'); note(60); note(64)");
    await equivalent('hats: s("hh"); hats: s("cp"); note(60)');
  });
  it("includes a newly appended voice even with an imported execution map", async () => {
    const doc = importStrudel("note(60)").doc;
    const voice = importStrudel("note(64)").doc.voices[0];
    doc.voices.push({ ...voice, id: "new-voice" });
    const result = await queryEvents(generate(doc), 0, 1);
    expect(result.error).toBeNull();
    expect(result.events.map((e) => e.value)).toEqual([
      { note: 60 },
      { note: 64 },
    ]);
  });
  it("retains pattern strings inside plain objects as opaque arguments", async () => {
    const { doc } = await equivalent('note(60).lfo({target: "gain", rate: 2})');
    expect(JSON.stringify(doc)).toContain('"kind":"opaque"');
  });
  it("retains setup and callback dependencies without moving them across setup", async () => {
    await equivalent("const x='bd'; console.log(x); note(60)");
    await equivalent(
      "console.log('before'); const x=60; note(64).withValue(v=>({...v,note:x}))",
    );
    await equivalent("const f=p=>p.rev(); note(60).jux(f)");
  });
  it("reports invalid input without discarding it", () => {
    const source = "note(";
    const { doc, warnings } = importStrudel(source);
    expect(doc.setup[0].code).toBe(source);
    expect(warnings[0]).toContain("parse error");
  });
});
describe("event queries", () => {
  it("can be called from Node --input-type=module", async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `import {queryEvents} from './src/index.ts'; const r=await queryEvents('note(60)',0,1);console.log(JSON.stringify({error:r.error,value:r.events[0]?.value}));`,
    ]);
    expect(JSON.parse(stdout)).toEqual({ error: null, value: { note: 60 } });
  });
  it("distinguishes silence from a thrown query", async () => {
    expect(await queryEvents("silence", 0, 1)).toMatchObject({
      error: null,
      events: [],
    });
    const failure = await queryEvents(
      "new Pattern(()=>{throw Error('broken')})",
      0,
      1,
    );
    expect(failure.error).toBe("broken");
    expect(failure.phase).toBe("query");
  });
  it("returns plain numeric spans, values and onsets", async () => {
    const r = await queryEvents("note(60).slow(2)", 0, 2);
    expect(r.error).toBeNull();
    expect(r.events).toMatchObject([
      { whole: [0, 2], part: [0, 1], value: { note: 60 }, hasOnset: true },
      { whole: [0, 2], part: [1, 2], value: { note: 60 }, hasOnset: false },
    ]);
    expect(() => structuredClone(r)).not.toThrow();
  });
  it("interrupts synchronous infinite queries", async () => {
    const r = await queryEvents("new Pattern(()=>{while(true){}})", 0, 1);
    expect(r.error).toContain("timed out");
    expect(r.events).toEqual([]);
  });
});

describe("author vocabulary", () => {
  it("retains single-use const names and section comments through generation", async () => {
    const source = `const kick=s("bd*4");
// Intro: only the kick
const intro=stack(kick);
arrange([4,intro],[4,stack(s("hh"))])`;
    const { doc, fresh } = await equivalent(source, 9);
    expect(JSON.stringify(doc)).toContain('"label":"intro"');
    expect(JSON.stringify(doc)).toContain("Intro: only the kick");
    expect(JSON.stringify(doc)).toContain('"label":"kick"');
    expect(fresh).toContain("Intro: only the kick");
  });
  it("retains comments naming anonymous stack parts", async () => {
    const { doc } = await equivalent(`stack(
// Four-on-the-floor kick
s("bd*4"),
// Piano chords
note("[c4,e4,g4]").s("piano"))`);
    expect(JSON.stringify(doc)).toContain("Four-on-the-floor kick");
    expect(JSON.stringify(doc)).toContain("Piano chords");
  });
});
it("recognises setCpm tempo and the time signal used by the local trance piece", async () => {
  const { doc } = await equivalent(
    'setCpm(140/4); s("pulse!16").fm(time).fmh(time)',
  );
  expect(doc.tempo).toEqual({ cpm: 35 });
  expect(JSON.stringify(doc)).toContain('"shape":"time"');
});
it("queries the draw fill parameter used by registered gates without initializing a canvas", async () => {
  const { result } = await equivalent('s("bd").fill(.8).clip(.8)');
  expect(result.events[0]?.value).toMatchObject({
    s: "bd",
    fill: 0.8,
    clip: 0.8,
  });
});
it("recognises an explicit silent part without an unresolved-identifier warning", async () => {
  const source = 'cat(silence,s("bd"))';
  expect(importStrudel(source).warnings).toEqual([]);
  await equivalent(source, 4);
});
