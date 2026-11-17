import type { ViewFrame, ViewNote } from '../types';
import { pitch } from '../shared/pitch';
import { clamp } from '../shared/math';
import { roleEvidence, lowestPitchedPart, mostRegularDrum, drumEvidence } from '../shared/roles';
import { settingRanges } from '../shared/settings';
import { previousOnset, nextOnset, noteProgress } from '../shared/timing';

export interface Event {
  note: ViewNote;
  midi: number | undefined;
  seed: number;
}
export function analyse(notes: ViewNote[]) {
  const evidence = roleEvidence(notes);
  const parts = new Map<string, Event[]>();
  for (const [id, part] of evidence) {
    const key = (n: ViewNote) => JSON.stringify([n.start, n.end, pitch(n.value), n.value.s]);
    const onsets = new Set(part.hits.map((e) => key(e.note))),
      fragments = new Set<string>();
    const events: Event[] = [];
    for (const e of part.events) {
      const identity = key(e.note);
      if (!e.note.hasOnset) {
        if (onsets.has(identity) || fragments.has(identity)) continue;
        fragments.add(identity);
      }
      let seed = Math.round(e.note.start * 1e6);
      for (const char of id + identity) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
      events.push({ note: e.note, midi: e.pitch, seed });
    }
    parts.set(id, events);
  }
  const ranges = new Map(
    [...parts].map(([id, events]) => [id, settingRanges(events.map((e) => e.note))]),
  );
  const explicit = new Set(
    notes
      .filter((n) => pitch({ note: n.value.note, freq: n.value.freq }) !== undefined)
      .map((n) => n.instrument),
  );
  return { evidence, parts, ranges, explicit };
}
export type Data = ReturnType<typeof analyse>;
export function district(frame: Pick<ViewFrame, 'now' | 'sections'>) {
  const length = frame.sections.at(-1)?.to ?? 0;
  const local = length > 0 ? ((frame.now % length) + length) % length : frame.now;
  const index = frame.sections.findIndex((s) => s.from <= local && local < s.to);
  return { index: Math.max(0, index), name: frame.sections[index]?.name ?? 'Uncharted' };
}
/** Majority backbeats/downbeats/offbeats earn drum roles; unmatched notes become generic debris. */
export function roles(frame: ViewFrame, data: Data) {
  const eligible = frame.instruments
    .filter((i) => i.inSection)
    .sort((a, b) => a.index - b.index)
    .map((i) => i.id);
  // Explicit note/frequency evidence disambiguates melodic pitch from sample-index n.
  const rooftops = lowestPitchedPart(data.evidence, data.explicit.size ? data.explicit : undefined);
  const footfalls = mostRegularDrum(data.evidence, 'regular', eligible);
  const drums = eligible.flatMap((id) => {
    const p = data.evidence.get(id),
      d = p && drumEvidence(p);
    if (!p || !d) return [];
    // Mirror drumEvidence's unique unpitched onsets for the local beat-phase rules.
    const starts = [
      ...new Set(
        p.events.filter((e) => e.note.hasOnset && e.pitch === undefined).map((e) => e.note.start),
      ),
    ];
    const ratio = (test: (phase: number) => boolean) =>
      starts.filter((t) => test(((t % 1) + 1) % 1)).length / starts.length;
    return [
      {
        ...d,
        regularity: p.regularity,
        duration: p.duration,
        strong: ratio((p) => Math.abs(p) < 1e-6 || Math.abs(p - 0.5) < 1e-6),
        halfBack: ratio((p) => Math.abs(p - 0.5) < 1e-6),
        back: ratio((p) => [0.25, 0.5, 0.75].some((beat) => Math.abs(p - beat) < 1e-6)),
        off: ratio(
          (p) => Math.abs(p * 8 - Math.round(p * 8)) < 1e-6 && Math.round(p * 8) % 2 === 1,
        ),
        halfOff: ratio((p) => Math.abs(p - 0.25) < 1e-6 || Math.abs(p - 0.75) < 1e-6),
      },
    ];
  });
  const kick = drums
    .filter((d) => d.strong >= 0.5 && d.regularity <= 0.15)
    .sort(
      (a, b) =>
        a.regularity - b.regularity ||
        b.strong - a.strong ||
        b.downbeats - a.downbeats ||
        a.density - b.density,
    )
    .at(0)?.id;
  const snare = drums
    .filter((d) => d.id !== kick && d.back >= 0.6)
    .sort((a, b) => b.back - a.back || a.density - b.density)
    .at(0)?.id;
  const halfTime = (drums.find((d) => d.id === snare)?.halfBack ?? 0) >= 0.6;
  const offbeats = (d: (typeof drums)[number]) => Math.max(d.off, halfTime ? d.halfOff : 0);
  const openHat = drums
    .filter(
      (d) =>
        d.id !== kick &&
        d.id !== snare &&
        (offbeats(d) >= 0.5 || (d.duration > 0.2 && d.strong < 0.5)),
    )
    .sort((a, b) => offbeats(b) - offbeats(a) || b.duration - a.duration || a.density - b.density)
    .at(0)?.id;
  return { rooftops, footfalls, kick, snare, openHat };
}
export type Roles = ReturnType<typeof roles>;
export function kind(id: string, r: Roles) {
  return id === r.rooftops
    ? 'roof'
    : id === r.snare
      ? 'snare'
      : id === r.kick
        ? 'kick'
        : id === r.openHat
          ? 'cable'
          : 'generic';
}
export function roofY(midi: number | undefined, height: number) {
  return height * (0.64 - 0.22 * Math.tanh(((midi ?? 24) - 36) / 20));
}
export function roofAt(events: Event[], time: number): Event | undefined {
  return events
    .filter((e) => e.note.start <= time && time < e.note.end)
    .sort((a, b) => (b.midi ?? -Infinity) - (a.midi ?? -Infinity) || b.note.start - a.note.start)
    .at(0);
}
const identitySettings = new Set([
  'note',
  'n',
  'freq',
  's',
  'sound',
  'orbit',
  'cps',
  'cycle',
  'begin',
  'end',
  'unit',
]);
const preferred = ['cutoff', 'lpf', 'hcutoff', 'hpf', 'resonance', 'pan', 'gain'];
export function searchlight(frame: ViewFrame, data: Data) {
  const candidates = frame.instruments
    .filter((i) => i.inSection)
    .flatMap((i) => {
      const events = data.parts.get(i.id) ?? [];
      return [...(data.ranges.get(i.id) ?? [])].flatMap(([key, r]) =>
        !identitySettings.has(key) &&
        r.min !== undefined &&
        r.max !== undefined &&
        r.max - r.min > 1e-6 * Math.max(1, Math.abs(r.min), Math.abs(r.max))
          ? [
              {
                instrument: i.id,
                key,
                events,
                priority: preferred.includes(key) ? preferred.indexOf(key) : preferred.length,
                index: i.index,
              },
            ]
          : [],
      );
    })
    .sort((a, b) => a.priority - b.priority || a.index - b.index || a.key.localeCompare(b.key));
  const driver = candidates.at(0);
  if (!driver) return undefined;
  const notes = driver.events.map((e) => e.note);
  const note =
    notes
      .filter((n) => n.start <= frame.now && frame.now < n.end)
      .sort((a, b) => b.start - a.start)
      .at(0) ?? previousOnset(notes, driver.instrument, frame.now);
  const value = note?.value[driver.key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const unit = /cutoff|lpf|hpf/i.test(driver.key)
    ? clamp(Math.log10(Math.max(20, value) / 20) / 3)
    : driver.key === 'gain' || driver.key === 'pan'
      ? clamp(value)
      : 0.5 + Math.atan(value) / Math.PI;
  return { instrument: driver.instrument, key: driver.key, note, value, angle: 2.2 + unit * 0.7 };
}
export function scene(frame: ViewFrame, data: Data) {
  const r = roles(frame, data);
  const gate = frame.width * 0.32;
  const scale = (frame.width - gate - 24) / Math.max(0.001, frame.lookAhead);
  const x = (time: number) => gate + (time - frame.now) * scale;
  const roofs = data.parts.get(r.rooftops ?? '') ?? [];
  const current = roofAt(roofs, frame.now);
  const size = clamp(frame.height * 0.13, 58, 102);
  let feet: number, leap: number;
  if (current) {
    const duration = Math.min(0.25, Math.max(0.001, (current.note.end - current.note.start) / 2));
    const u = noteProgress(
      { start: current.note.start, end: current.note.start + duration },
      frame.now,
    );
    const before = roofAt(roofs, current.note.start - 1e-7);
    leap = Math.sin(Math.PI * u) * size * 0.65;
    feet =
      roofY(before?.midi ?? current.midi, frame.height) * (1 - u) +
      roofY(current.midi, frame.height) * u -
      leap;
  } else {
    const before = roofs
      .filter((e) => e.note.end <= frame.now)
      .sort((a, b) => b.note.end - a.note.end)
      .at(0);
    const after = roofs
      .filter((e) => e.note.start > frame.now)
      .sort((a, b) => a.note.start - b.note.start)
      .at(0);
    const u = noteProgress(
      {
        start: before?.note.end ?? Math.floor(frame.now),
        end: after?.note.start ?? Math.floor(frame.now) + 1,
      },
      frame.now,
    );
    leap = Math.sin(Math.PI * u) * frame.height * 0.16;
    feet =
      roofY(before?.midi, frame.height) * (1 - u) + roofY(after?.midi, frame.height) * u - leap;
  }
  const steps = (data.parts.get(r.footfalls ?? '') ?? []).map((e) => e.note);
  const prev = previousOnset(steps, r.footfalls ?? '', frame.now),
    next = nextOnset(steps, r.footfalls ?? '', frame.now);
  const stride = prev && next ? noteProgress({ start: prev.start, end: next.start }, frame.now) : 0;
  return {
    roles: r,
    gate,
    scale,
    x,
    roofs,
    current,
    size,
    feet,
    leap,
    chasm: !current,
    stride,
    speed: scale * Math.max(0, frame.cps),
    district: district(frame),
    light: searchlight(frame, data),
  };
}
export const parallaxRates = [0.06, 0.17, 0.38, 1] as const;
