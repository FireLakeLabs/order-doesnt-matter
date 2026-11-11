import type { Doc } from "../../import/src/document";
import { evaluate } from "@strudel/core";
import { generate, queryEvents } from "./adapter";
import { tagVoices } from "./query-document";
import { song } from "./song";

export type SoundState =
  | { state: "loading"; name: string }
  | { state: "ready"; name: string; url?: string }
  | { state: "missing"; name: string; reason: string; url?: string };
export interface SoundReport {
  state: "loading" | "ready" | "missing";
  sounds: SoundState[];
  error?: string;
}
export const defaultSampleSets = [
  ...[
    "tidal-drum-machines",
    "piano",
    "Dirt-Samples",
    "EmuSP12",
    "vcsl",
    "mridangam",
  ].map(
    (name) =>
      `https://raw.githubusercontent.com/felixroos/dough-samples/main/${name}.json`,
  ),
  "github:tidalcycles/dirt-samples",
];
type Web = typeof import("@strudel/web");
export function soundName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return;
  const s: unknown = Reflect.get(value, "s") ?? "triangle";
  if (typeof s !== "string") return;
  const bank: unknown = Reflect.get(value, "bank");
  return (bank ? `${String(bank)}_${s}` : s).toLowerCase();
}
async function bounded<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(Error(`${label}: network timeout`)),
          7000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve actual Strudel event values through Superdough's registry and sample
 * selector. Registration alone is not readiness: every selected file is decoded. */
export class Sounds {
  reports: Record<string, SoundReport> = {};
  defaultErrors: string[] = [];
  private inspections = new Map<string, Promise<void>>();
  private setups = new Map<string, Promise<void>>();
  private buffers = new Map<string, Promise<void>>();
  private current = "";
  private reportCache = new Map<string, Record<string, SoundReport>>();
  constructor(
    private web: Web,
    private changed: () => void,
  ) {}
  async defaults() {
    // Fetch in parallel for bounded offline behavior; register in a fixed order.
    // The full Dirt set wins duplicate names, independent of network timing.
    const results = await Promise.allSettled(
      defaultSampleSets.map((url) =>
        bounded(
          (async () => {
            const resolved =
              url === "github:tidalcycles/dirt-samples"
                ? "https://raw.githubusercontent.com/tidalcycles/dirt-samples/main/strudel.json"
                : url;
            const response = await fetch(resolved, {
              signal: AbortSignal.timeout(6500),
            });
            if (!response.ok) throw Error(`${url}: HTTP ${response.status}`);
            const map: unknown = await response.json();
            if (!map || typeof map !== "object" || Array.isArray(map))
              throw Error(`${url}: invalid sample map`);
            const base =
              "_base" in map && typeof map._base === "string"
                ? map._base
                : new URL(".", resolved).href;
            return { map, base };
          })(),
          url,
        ),
      ),
    );
    this.defaultErrors = [];
    for (const result of results) {
      if (result.status === "rejected") {
        this.defaultErrors.push(String(result.reason));
        continue;
      }
      const { map, base } = result.value;
      try {
        await this.web.samples(map, base);
      } catch (e) {
        this.defaultErrors.push(String(e));
      }
    }
  }
  async setup(d: Doc) {
    if (!d.setup.length) return;
    const source = generate({
      ...d,
      tempo: undefined,
      voices: [],
      transforms: [],
      order: d.order?.filter((e) => e.kind === "setup" || e.kind === "shared"),
    });
    let work = this.setups.get(source);
    if (!work) {
      // Use Strudel's transpiler: it awaits even unadorned samples(...) calls.
      // Helpers and custom sample expressions keep their lexical order.
      work = bounded(
        evaluate(source, this.web.transpiler),
        "Program sample setup",
      ).then(() => undefined);
      this.setups.set(source, work);
    }
    await work;
  }
  async inspect(d: Doc) {
    const unmuted = tagVoices(d, true),
      source = generate(unmuted);
    this.current = source;
    let work = this.inspections.get(source);
    const cached = this.reportCache.get(source);
    if (cached) this.reports = cached;
    if (!work) {
      const structure = song(d);
      const reports: Record<string, SoundReport> = Object.fromEntries(
        structure.instruments.map((i) => [
          i.id,
          { state: "loading", sounds: [] },
        ]),
      );
      this.reportCache.set(source, reports);
      this.reports = reports;
      this.changed();
      work = (async () => {
        let setupError: string | undefined;
        try {
          await this.setup(d);
        } catch (e) {
          setupError = String(e);
        }
        const end = Math.min(512, Math.max(16, structure.total));
        const result = await queryEvents(source, 0, end);
        const values = new Map<string, Map<string, unknown>>();
        for (const event of result.events) {
          const v = event.value,
            name = soundName(v);
          if (!v || typeof v !== "object" || !name) continue;
          const id = String(
            Reflect.get(v, "__planet") ?? Reflect.get(v, "__voice"),
          );
          const sounds = values.get(id) ?? new Map<string, unknown>();
          // n and pitch select different files inside one sound bank.
          sounds.set(
            JSON.stringify([name, Reflect.get(v, "n"), Reflect.get(v, "note")]),
            v,
          );
          values.set(id, sounds);
        }
        await Promise.all(
          Object.entries(reports).map(async ([id, report]) => {
            const used = [...(values.get(id)?.values() ?? [])];
            report.sounds = used.map((v) => ({
              state: "loading",
              name: soundName(v) ?? "unknown",
            }));
            if (this.current === source) this.changed();
            report.sounds = await Promise.all(used.map((v) => this.check(v)));
            report.error =
              result.error ??
              (used.length
                ? undefined
                : "No sound events checked in the first " + end + " cycles");
            if (setupError) report.error = setupError;
            report.state =
              report.error || report.sounds.some((s) => s.state === "missing")
                ? "missing"
                : "ready";
          }),
        );
        if (this.current === source) {
          this.reports = reports;
          this.changed();
        }
      })();
      this.inspections.set(source, work);
      work
        .then(() => {
          if (this.current === source) this.reports = reports;
        })
        .catch(() => undefined);
    }
    await work;
  }
  async check(value: unknown): Promise<SoundState> {
    const name = soundName(value) ?? "unknown";
    const sound = this.web.getSound(name);
    if (!sound)
      return {
        state: "missing",
        name,
        reason:
          "not registered" +
          (this.defaultErrors.length
            ? "; default samples unavailable (offline or network error)"
            : ""),
      };
    if (sound.data.type !== "sample") return { state: "ready", name };
    let url: string | undefined;
    try {
      const info = this.web.getSampleInfo(value, sound.data.samples);
      url = info.url;
      if (!url) throw Error("empty sample bank");
      let work = this.buffers.get(url);
      if (!work) {
        work = bounded(
          this.web.loadBuffer(url, this.web.getAudioContext(), name),
          name,
        ).then(() => undefined);
        this.buffers.set(url, work);
      }
      await work;
      return { state: "ready", name, url };
    } catch (e) {
      return { state: "missing", name, url, reason: String(e) };
    }
  }
  /** Patterns can choose a new sound or sample index after the inspection
   * window. Check the actual dispatched value as well as the preview. */
  async observe(value: unknown) {
    if (!value || typeof value !== "object") return;
    const id = String(
      Reflect.get(value, "__planet") ?? Reflect.get(value, "__voice"),
    );
    const name = soundName(value) ?? "unknown";
    const report = (this.reports[id] ??= { state: "loading", sounds: [] });
    let url: string | undefined;
    try {
      const sound = this.web.getSound(name);
      if (sound?.data.type === "sample")
        url = this.web.getSampleInfo(value, sound.data.samples).url;
    } catch (e) {
      this.failed(value, e);
      return;
    }
    if (
      report.sounds.some(
        (s) => s.state !== "loading" && s.name === name && s.url === url,
      )
    )
      return;
    const entry: SoundState = { state: "loading", name };
    report.sounds.push(entry);
    report.state = report.sounds.some((s) => s.state === "missing")
      ? "missing"
      : "loading";
    this.changed();
    const checked = await this.check(value);
    const index = report.sounds.indexOf(entry);
    if (index >= 0) report.sounds[index] = checked;
    report.state =
      report.error || report.sounds.some((s) => s.state === "missing")
        ? "missing"
        : report.sounds.some((s) => s.state === "loading")
          ? "loading"
          : "ready";
    this.changed();
  }
  failed(value: unknown, error: unknown) {
    if (!value || typeof value !== "object") return;
    const id = String(
      Reflect.get(value, "__planet") ?? Reflect.get(value, "__voice"),
    );
    const report = this.reports[id] ?? { state: "missing", sounds: [] };
    report.state = "missing";
    const name = soundName(value) ?? "unknown",
      reason = String(error);
    if (
      !report.sounds.some(
        (s) => s.state === "missing" && s.name === name && s.reason === reason,
      )
    )
      report.sounds.push({ state: "missing", name, reason });
    this.reports[id] = report;
    this.changed();
  }
}
