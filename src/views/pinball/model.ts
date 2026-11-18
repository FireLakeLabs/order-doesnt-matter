import type { ViewFrame, ViewNote } from '../types';
import { mostRegularDrum, roleEvidence } from '../shared/roles';
import { pitch } from '../shared/pitch';
import { sectionAt } from '../shared/ring-model';
import { routeAt, routeBetween, captivePoint } from './table';
import type { PinballLayout, Target } from './table';
export { pinballLayout, routeBetween, pointOnRoute, captivePoint } from './table';
export type { PinballLayout, Target } from './table';

export interface Point {
  x: number;
  y: number;
}
export type TargetKind = 'bumper' | 'rollover' | 'ramp' | 'spinner';
export function indexPinball(notes: ViewNote[]) {
  const roles = roleEvidence(notes);
  const kinds = new Map<string, TargetKind>();
  for (const part of roles.values()) {
    const duration = part.hits.length
      ? part.duration
      : part.events.reduce((max, e) => Math.max(max, e.note.end - e.note.start), 0);
    kinds.set(
      part.id,
      Number.isFinite(part.meanPitch)
        ? part.meanPitch <= 48
          ? 'ramp'
          : 'spinner'
        : part.density >= 3 && duration < 0.25
          ? 'rollover'
          : duration > 0.25
            ? 'spinner'
            : 'bumper',
    );
  }
  const groups = new Map<number, ViewNote[]>();
  for (const n of notes) {
    if (!n.hasOnset) continue;
    const group = groups.get(n.start) ?? [];
    group.push(n);
    groups.set(n.start, group);
  }
  // A signal can split one whole note into several no-onset fragments. Keep
  // true polyphony, but attach continuations to their whole span instead of
  // inventing new balls. The fragment count remains visible in the HUD.
  const spans = new Map<string, ViewNote[]>();
  for (const n of notes) {
    const key = JSON.stringify([n.instrument, n.start, n.end]);
    const list = spans.get(key) ?? [];
    list.push(n);
    spans.set(key, list);
  }
  const wholeNotes = [...spans.values()].flatMap((span) => {
    const onsets = span.filter((n) => n.hasOnset);
    // An onset owns all its control fragments, even if a sampled value changes.
    // With no onset in the window, preserve the distinct carried pitches.
    return onsets.length ? onsets : [...new Map(span.map((n) => [pitch(n.value), n])).values()];
  });
  return {
    kinds,
    groups: [...groups]
      .sort(([a], [b]) => a - b)
      .map(([time, notes]) => ({
        time,
        notes: notes
          .slice()
          .sort((a, b) => a.instrument.localeCompare(b.instrument) || a.end - b.end),
      })),
    spans: wholeNotes,
    holds: wholeNotes.filter((n) => Number.isFinite(pitch(n.value)) || n.end - n.start > 0.25),
    fragments: notes.filter((n) => !n.hasOnset),
  };
}
export type PinballScore = ReturnType<typeof indexPinball>;
/** Section gaps must not make a steady downbeat lose to an unrelated earlier part.
 * Without sections the complete supplied window is the available evidence. */
export function flipperAt(frame: Pick<ViewFrame, 'now' | 'notes' | 'sections'>) {
  const section = sectionAt(frame);
  const notes = section
    ? frame.notes.filter((n) => n.start >= section.from && n.start < section.to)
    : frame.notes;
  return mostRegularDrum(roleEvidence(notes));
}

export function pinballState(score: PinballScore, layout: PinballLayout, now: number) {
  const targets = new Map(layout.targets.map((t) => [t.instrument.id, t]));
  const groups = score.groups;
  let at = -1;
  for (let i = 0; i < groups.length && groups[i].time <= now; i++) at = i;
  const previous = at >= 0 ? groups.at(at) : undefined,
    next = groups.at(at + 1);
  // Coincident notes on a target share a ball with a count. No dense note is discarded.
  const destination = next ?? (previous?.time === now ? previous : undefined);
  const routes: {
    target: Target;
    points: Point[];
    ahead: Point[];
    position: Point;
    count: number;
    arrival: number;
  }[] = [];
  if (destination) {
    const buckets = new Map<string, number>();
    for (const n of destination.notes)
      buckets.set(n.instrument, (buckets.get(n.instrument) ?? 0) + 1);
    const sources = previous?.notes.flatMap((n) => targets.get(n.instrument) ?? []) ?? [];
    let i = 0;
    for (const [id, count] of buckets) {
      const target = targets.get(id);
      if (!target) continue;
      const source = sources.at(i++ % Math.max(1, sources.length)) ?? target;
      const points = routeBetween(source, target, layout);
      const start = previous?.time ?? destination.time - 1;
      const progress = destination.time > start ? (now - start) / (destination.time - start) : 1;
      const { position, ahead } = routeAt(points, progress);
      routes.push({
        target,
        points,
        ahead,
        position,
        count,
        arrival: destination.time,
      });
    }
  }
  // A captive whose end falls between onsets rejoins the route at that exact
  // end, rather than disappearing until the next hit. Coincident releases count.
  if (next) {
    const releases = new Map<string, { note: ViewNote; count: number }>();
    for (const note of score.holds) {
      if (note.end > now || (previous && note.end <= previous.time)) continue;
      const key = JSON.stringify([note.instrument, note.end]);
      const release = releases.get(key);
      if (release) release.count++;
      else releases.set(key, { note, count: 1 });
    }
    const target = next.notes.flatMap((n) => targets.get(n.instrument) ?? []).at(0);
    if (target)
      for (const { note, count } of releases.values()) {
        const source = targets.get(note.instrument);
        if (!source) continue;
        const points = routeBetween(source, target, layout);
        const { position, ahead } = routeAt(points, (now - note.end) / (next.time - note.end));
        routes.push({ target, points, position, ahead, count, arrival: next.time });
      }
  }
  const holds = layout.targets.flatMap((target) => {
    const notes = score.holds.filter(
      (n) => n.instrument === target.instrument.id && n.start <= now && now < n.end,
    );
    // Keep each note's trajectory independent of its siblings. Coincident balls are counted below.
    const positions = notes.map((n) => captivePoint(target, n, now));
    return notes.length ? [{ target, notes, positions, count: notes.length }] : [];
  });
  const current = groups.find((g) => g.time === now);
  return {
    routes,
    holds,
    next,
    current,
    fragments: score.fragments.filter((n) => n.start <= now && now < n.end).length,
    held: holds.reduce((n, h) => n + h.count, 0),
    travelling: routes.reduce((n, r) => n + r.count, 0),
    multiball: next?.notes.length ?? 0,
    barNotes: groups
      .filter((g) => g.time >= Math.floor(now) && g.time < Math.floor(now) + 1)
      .reduce((n, g) => n + g.notes.length, 0),
    reached: groups
      .filter((g) => g.time >= Math.floor(now) && g.time <= now)
      .reduce((n, g) => n + g.notes.length, 0),
  };
}
