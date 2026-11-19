import type { ViewFrame, ViewNote } from '../types';
import { pitch } from '../shared/pitch';
import { clamp } from '../shared/math';
import { roleEvidence, lowestPitchedPart, drumEvidence } from '../shared/roles';
import { settingRanges } from '../shared/settings';
import { previousOnset, nextOnset, noteProgress } from '../shared/timing';
import { building, buildingAt, crossing, route, world } from './city';

export interface Event {
  note: ViewNote;
  midi: number | undefined;
  seed: number;
  identity: string;
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
      events.push({ note: e.note, midi: e.pitch, seed, identity: id + identity });
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
  const section = frame.sections.find((s) => s.from <= local && local < s.to);
  const names = [...new Set(frame.sections.map((s) => s.name))];
  const index = Math.max(0, names.indexOf(section?.name ?? ''));
  return {
    index: index % 4,
    name: ['old town', 'construction', 'downtown', 'docks'][index % 4],
    section: section?.name,
  };
}
/** Majority backbeats/downbeats/offbeats earn drum roles; unmatched notes light windows. */
export function roles(frame: ViewFrame, data: Data) {
  const eligible = frame.instruments
    .filter((i) => i.inSection)
    .sort((a, b) => a.index - b.index)
    .map((i) => i.id);
  // Explicit note/frequency evidence disambiguates melodic pitch from sample-index n.
  const walker = lowestPitchedPart(data.evidence, data.explicit.size ? data.explicit : undefined);
  // Footfalls favour dense subdivisions when drums are equally steady, to keep a running cadence.
  const steady = eligible
    .flatMap((id) => {
      const p = data.evidence.get(id);
      return p && drumEvidence(p) ? [p] : [];
    })
    .sort((a, b) => a.regularity - b.regularity || b.density - a.density);
  const footfalls = steady.at(0)?.id;
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
    .filter((d) => d.downbeats > 0 && d.strong >= 0.5 && d.regularity <= 0.15)
    .sort(
      (a, b) =>
        a.regularity - b.regularity ||
        b.strong - a.strong ||
        b.downbeats - a.downbeats ||
        a.density - b.density,
    )
    .at(0)?.id;
  const snare =
    drums
      .filter((d) => d.id !== kick && d.back >= 0.6)
      .sort((a, b) => b.back - a.back || a.density - b.density)
      .at(0)?.id ??
    drums
      .filter((d) => d.id !== kick && d.density >= 4 && d.duration <= 0.25)
      .sort((a, b) => b.duration - a.duration)
      .at(0)?.id;
  const halfTime = (drums.find((d) => d.id === snare)?.halfBack ?? 0) >= 0.6;
  const offbeats = (d: (typeof drums)[number]) => Math.max(d.off, halfTime ? d.halfOff : 0);
  const openHat =
    drums
      .filter(
        (d) =>
          d.id !== kick &&
          d.id !== snare &&
          (offbeats(d) > 0.5 || (d.duration > 0.2 && d.strong < 0.5)),
      )
      .sort((a, b) => offbeats(b) - offbeats(a) || b.duration - a.duration || a.density - b.density)
      .at(0)?.id ??
    [...data.evidence.values()]
      .filter(
        (p) =>
          eligible.includes(p.id) &&
          p.id !== kick &&
          p.id !== snare &&
          p.duration <= 0.5 &&
          data.explicit.has(p.id) &&
          Number.isFinite(p.meanPitch),
      )
      .sort((a, b) => b.meanPitch - a.meanPitch)
      .at(0)?.id;
  return { walker, footfalls, kick, snare, openHat };
}
export type Roles = ReturnType<typeof roles>;
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
const filters = ['cutoff', 'hcutoff', 'bandf', 'resonance', 'hresonance', 'bandq', 'ftype'];
const aliases: Record<string, string> = {
  lpf: 'cutoff',
  lp: 'cutoff',
  ctf: 'cutoff',
  hpf: 'hcutoff',
  hp: 'hcutoff',
  bpf: 'bandf',
  bp: 'bandf',
  lpq: 'resonance',
  hpq: 'hresonance',
  bpq: 'bandq',
};
const preferred = [...filters, 'pan', 'gain'];
/** Scored setting units; ratios and pan positions are dimensionless. */
export function settingValue(key: string, value: number): string {
  const name = aliases[key] ?? key;
  const units: Record<string, string> = {
    cutoff: 'Hz',
    hcutoff: 'Hz',
    bandf: 'Hz',
    resonance: 'Q',
    hresonance: 'Q',
    bandq: 'Q',
    attack: 's',
    decay: 's',
    release: 's',
    delaytime: 's',
    crush: 'bits',
    speed: '×',
  };
  const unit = units[name];
  const digits = unit === 'Hz' || unit === 'bits' ? 0 : 2;
  return `${String(Number(value.toFixed(digits)))}${unit ? ` ${unit}` : ''}`;
}
export function searchlight(frame: ViewFrame, data: Data) {
  const candidates = frame.instruments
    .filter((i) => i.inSection)
    .flatMap((i) => {
      const events = data.parts.get(i.id) ?? [];
      const ranges = data.ranges.get(i.id);
      const keys = new Set([
        ...(ranges?.keys() ?? []),
        ...i.settings.map((setting) =>
          ranges?.has(setting.name) ? setting.name : (aliases[setting.name] ?? setting.name),
        ),
      ]);
      return [...keys].flatMap((key) => {
        if (identitySettings.has(key)) return [];
        const r = ranges?.get(key);
        const moving =
          i.settings.some(
            (setting) =>
              (aliases[setting.name] ?? setting.name) === (aliases[key] ?? key) &&
              (setting.kind === 'signal' || setting.kind === 'values'),
          ) ||
          (r?.min !== undefined &&
            r.max !== undefined &&
            r.max - r.min > 1e-6 * Math.max(1, Math.abs(r.min), Math.abs(r.max)));
        const canonical = aliases[key] ?? key;
        const filter = filters.includes(canonical);
        if (!filter && !moving) return [];
        return [
          {
            instrument: i.id,
            key,
            events,
            filter,
            moving,
            priority: preferred.includes(canonical)
              ? preferred.indexOf(canonical)
              : preferred.length,
            index: i.index,
          },
        ];
      });
    })
    .sort(
      (a, b) =>
        Number(b.filter) - Number(a.filter) ||
        Number(b.moving) - Number(a.moving) ||
        a.priority - b.priority ||
        a.index - b.index ||
        a.key.localeCompare(b.key),
    );
  const hasFilter = candidates.some((candidate) => candidate.filter);
  for (const driver of candidates) {
    if (hasFilter && !driver.filter) continue;
    const notes = driver.events.map((e) => e.note);
    const note =
      notes
        .filter((n) => n.start <= frame.now && frame.now < n.end)
        .sort((a, b) => b.start - a.start)
        .at(0) ?? previousOnset(notes, driver.instrument, frame.now);
    const value = note?.value[driver.key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const key = aliases[driver.key] ?? driver.key;
    const unit = ['cutoff', 'hcutoff', 'bandf'].includes(key)
      ? clamp(Math.log10(Math.max(20, value) / 20) / 3)
      : key === 'gain' || key === 'pan'
        ? clamp(value)
        : 0.5 + Math.atan(value) / Math.PI;
    return { instrument: driver.instrument, key: driver.key, note, value, angle: 2.2 + unit * 0.7 };
  }
  return undefined;
}
/** Contact phase spans consecutive actual onsets; silence falls back to a tempo cadence. */
export function strideAt(frame: ViewFrame, data: Data, id: string | undefined) {
  const notes = (data.parts.get(id ?? '') ?? []).map((e) => e.note);
  const prev = previousOnset(notes, id ?? '', frame.now);
  const next = nextOnset(notes, id ?? '', frame.now);
  if (prev && next && next.start - prev.start <= 1) {
    const index = Math.round(prev.start / (next.start - prev.start));
    return {
      phase: noteProgress({ start: prev.start, end: next.start }, frame.now),
      side: index % 2,
    };
  }
  const beat = frame.now * 4;
  return { phase: ((beat % 1) + 1) % 1, side: ((Math.floor(beat) % 2) + 2) % 2 };
}
export function accented(event: Event, data: Data) {
  const gain = event.note.value.gain;
  const range = data.ranges.get(event.note.instrument)?.get('gain');
  return (
    typeof gain === 'number' &&
    range?.min !== undefined &&
    range.max !== undefined &&
    range.max > range.min + 1e-6 &&
    gain >= range.min + (range.max - range.min) * 0.75
  );
}
export function scene(frame: ViewFrame, data: Data) {
  const r = roles(frame, data);
  const w = world(frame);
  const motion = route(w, frame.now);
  const snare = [
    ...new Map(
      (data.parts.get(r.snare ?? '') ?? [])
        .filter((e) => e.note.hasOnset)
        .map((e) => [e.note.start, e]),
    ).values(),
  ];
  const vault = snare
    .flatMap((e, index) => {
      if (route(w, e.note.start).airborne || accented(e, data)) return [];
      const b = buildingAt((e.note.start * w.pace) / w.size, w.maxGap);
      const start = Math.max(
        e.note.start - 0.085,
        crossing(w, building(b.index - 1, w.maxGap)).landing,
        index ? (snare[index - 1].note.start + e.note.start) / 2 : -Infinity,
      );
      const end = Math.min(
        e.note.start + 0.085,
        crossing(w, b).takeoff,
        index + 1 < snare.length ? (snare[index + 1].note.start + e.note.start) / 2 : Infinity,
      );
      if (frame.now <= start || frame.now >= end) return [];
      const phase =
        frame.now <= e.note.start
          ? (0.5 * (frame.now - start)) / (e.note.start - start)
          : 0.5 + (0.5 * (frame.now - e.note.start)) / (end - e.note.start);
      return [phase];
    })
    .at(0);
  const vaultLift = vault !== undefined ? Math.sin(vault * Math.PI) * w.size * 0.08 : 0;
  const walkerNotes = (data.parts.get(r.walker ?? '') ?? []).map((e) => e.note);
  const step = previousOnset(walkerNotes, r.walker ?? '', frame.now);
  const next = nextOnset(walkerNotes, r.walker ?? '', frame.now);
  return {
    ...w,
    ...motion,
    roles: r,
    district: district(frame),
    feet: motion.feet - vaultLift,
    vault,
    stride: strideAt(frame, data, r.footfalls),
    light: searchlight(frame, data),
    lamp: walkerNotes.some((n) => n.start <= frame.now && frame.now < n.end),
    walkerStep: step
      ? clamp((frame.now - step.start) / Math.min(0.3, next ? next.start - step.start : 0.3))
      : 1,
    walkerSide: step ? Math.round(step.start * 8) % 2 : 0,
    speed: w.pace * Math.max(0, frame.cps),
  };
}
export type Scene = ReturnType<typeof scene>;
export const parallaxRates = [0.06, 0.17, 0.38] as const;
