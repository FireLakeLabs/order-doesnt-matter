import { expect, it } from "vitest";
import { Sounds } from "./sounds";
import { importStrudel } from "./adapter";

it("shows a registered sample as loading until it decodes, then ready", async () => {
  let release: () => void = () => {};
  let loading: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    loading = resolve;
  });
  const decoded = new Promise<void>((resolve) => {
    release = resolve;
  });
  const library = new Sounds(
    {
      getSound: () => ({
        data: { type: "sample", samples: ["https://test.invalid/bd.wav"] },
      }),
      getSampleInfo: () => ({ url: "https://test.invalid/bd.wav" }),
      getAudioContext: () => undefined,
      loadBuffer: () => {
        loading();
        return decoded;
      },
    },
    () => {},
  );
  const d = importStrudel('s("bd")').doc;
  const inspection = library.inspect(d);
  await started;
  expect(Object.values(library.reports)).toEqual([
    { state: "loading", sounds: [{ state: "loading", name: "bd" }] },
  ]);
  release();
  await inspection;
  expect(Object.values(library.reports)).toEqual([
    {
      state: "ready",
      sounds: [
        { state: "ready", name: "bd", url: "https://test.invalid/bd.wav" },
      ],
      error: undefined,
    },
  ]);
});
it("names missing registration and failed decoding instead of reporting ready", async () => {
  const missing = new Sounds({ getSound: () => undefined }, () => {});
  expect(await missing.check({ s: "unknown", bank: "tr909" })).toMatchObject({
    state: "missing",
    name: "tr909_unknown",
    reason: "not registered",
  });
  const broken = new Sounds(
    {
      getSound: () => ({ data: { type: "sample", samples: ["bad.wav"] } }),
      getSampleInfo: () => ({ url: "bad.wav" }),
      getAudioContext: () => undefined,
      loadBuffer: () => Promise.reject(Error("cannot decode")),
    },
    () => {},
  );
  expect(await broken.check({ s: "bd" })).toMatchObject({
    state: "missing",
    name: "bd",
    reason: "Error: cannot decode",
  });
});

it("checks sample selections that first appear after the preview window at dispatch", async () => {
  const library = new Sounds(
    {
      getSound: () => ({
        data: { type: "sample", samples: ["kick.wav", "hat.wav"] },
      }),
      getSampleInfo: (v: { n: number }) => ({
        url: v.n === 1 ? "hat.wav" : "kick.wav",
      }),
      getAudioContext: () => undefined,
      loadBuffer: (url: string) =>
        url === "hat.wav"
          ? Promise.reject(Error("offline"))
          : Promise.resolve(),
    },
    () => {},
  );
  library.reports["instrument"] = {
    state: "ready",
    sounds: [{ state: "ready", name: "kit", url: "kick.wav" }],
  };
  await library.observe({ s: "kit", n: 1, __planet: "instrument" });
  expect(library.reports["instrument"]?.state).toBe("missing");
  expect(library.reports["instrument"]?.sounds).toContainEqual({
    state: "missing",
    name: "kit",
    url: "hat.wav",
    reason: "Error: offline",
  });
});
