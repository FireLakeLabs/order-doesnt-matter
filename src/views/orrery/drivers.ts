import type {
  ViewFrame,
  ViewProgramStructure,
  ViewSnapshot,
  ViewUseTiming,
  ViewNote,
} from '../types';
import { indexOrrery, orbitPhase, rational, type Rational } from './model';

type Rate = Extract<
  ViewProgramStructure['steps'][number],
  { kind: 'setting' }
>['driver']['rates'][number];
export interface DriverOrbit {
  instrument: string;
  setting: string;
  notation: string;
  status: 'pending' | 'known' | 'unknown';
  reason: string;
  period: Rational | null;
  segments: { from: number; to: number; rate: number; weight: number }[];
  total: number;
  timing: ViewUseTiming;
}
const unknownTiming: ViewUseTiming = { status: 'unavailable', reason: 'Driver timing unavailable' };

/** Numeric argument events are evidence, not a guessed mini-notation parser.
 * Reuse the note-orbit rational/multiset proof for their period, then require a
 * complete, non-overlapping numeric partition of that period. */
export function establishDriver(
  moon: DriverOrbit,
  rate: Rate,
  answer: ViewSnapshot,
  frame: ViewFrame,
): DriverOrbit {
  const unknown = (reason: string): DriverOrbit => ({ ...moon, status: 'unknown', reason });
  if (answer.status === 'unavailable') return unknown(answer.reason);
  if (answer.result.error || answer.result.opaqueValues)
    return unknown(answer.result.error?.message ?? 'Opaque rate values');
  const events = answer.result.events;
  if (
    events.some(
      (event) =>
        !event.whole ||
        typeof event.value !== 'number' ||
        !Number.isFinite(event.value) ||
        event.value <= 0 ||
        !rational(event.value),
    )
  )
    return unknown('Rate is not a positive rational event pattern');
  const notes: ViewNote[] = [];
  for (const event of events) {
    if (!event.whole) return unknown('Continuous rate is unavailable');
    notes.push({
      instrument: moon.instrument,
      start: event.whole[0],
      end: event.whole[1],
      hasOnset: event.hasOnset,
      value: { value: event.value },
    });
  }
  const orbit = indexOrrery({
    ...frame,
    sections: [],
    notes,
    instruments: frame.instruments.filter((i) => i.id === moon.instrument),
  }).orbits.at(0);
  if (!orbit?.period) return unknown(orbit?.reason ?? 'Rate period unavailable');
  const period = orbit.period.n / orbit.period.d;
  if (
    moon.timing.status !== 'available' ||
    moon.timing.spans.some((span) => !rational(period * span.scale))
  )
    return unknown('Song-time rate period is not a recoverable rational');
  const segments: DriverOrbit['segments'] = [];
  for (const note of notes.filter((note) => note.hasOnset)) {
    const from = orbitPhase(orbit.period, note.start) * period;
    const to = from + note.end - note.start;
    const value = note.value.value as number;
    const speed = rate.name === 'slow' ? 1 / value : value;
    if (!segments.some((segment) => Math.abs(segment.from - from) < 1e-10))
      segments.push({ from, to, rate: value, weight: (to - from) * speed });
  }
  segments.sort((a, b) => a.from - b.from);
  if (
    !segments.length ||
    Math.abs(segments[0].from) > 1e-10 ||
    Math.abs(segments[segments.length - 1].to - period) > 1e-10 ||
    segments.some((s, i) => i > 0 && Math.abs(s.from - segments[i - 1].to) > 1e-10)
  )
    return unknown('Rate pattern does not partition its loop');
  const total = segments.reduce((sum, segment) => sum + segment.weight, 0);
  if (!rational(total) || total <= 0) return unknown('Rate weights are not recoverable rationals');
  return { ...moon, status: 'known', reason: '', period: orbit.period, segments, total };
}

/** One lap per rate-pattern loop; angular distance apportioned by actual rate.
 * No accumulated frame time: backwards seeks use the same integral. */
export function driverPhase(moon: DriverOrbit, now: number) {
  if (moon.status !== 'known' || !moon.period || moon.timing.status !== 'available') return null;
  const spans = moon.timing.spans.filter((span) => span.from <= now && now < span.to);
  if (
    !spans.length ||
    spans.some((span) => span.offset !== spans[0].offset || span.scale !== spans[0].scale)
  )
    return null;
  const span = spans[0];
  const local = (now - span.offset) / span.scale;
  const time = (orbitPhase(moon.period, local) * moon.period.n) / moon.period.d;
  let weight = 0;
  for (const [index, segment] of moon.segments.entries()) {
    if (time < segment.to)
      return {
        phase:
          (weight + (segment.weight * (time - segment.from)) / (segment.to - segment.from)) /
          moon.total,
        rate: segment.rate,
        segment: index,
        local,
        period: rational((moon.period.n / moon.period.d) * span.scale),
      };
    weight += segment.weight;
  }
  return null;
}
export function driverTicks(moon: DriverOrbit) {
  let weight = 0;
  return moon.segments.flatMap((segment, index) => {
    const phase = weight / moon.total;
    weight += segment.weight;
    return segment.rate ===
      moon.segments[(index + moon.segments.length - 1) % moon.segments.length].rate
      ? []
      : [phase];
  });
}

/** Cache only asynchronous answers by immutable structure identity, never motion. */
export function createDriverOrbits() {
  const current = new Map<string, { structure: ViewProgramStructure; moons: DriverOrbit[] }>();
  let active = true;
  return {
    get(frame: ViewFrame): DriverOrbit[] {
      const ids = new Set(frame.instruments.map((instrument) => instrument.id));
      for (const id of current.keys()) if (!ids.has(id)) current.delete(id);
      return frame.instruments.flatMap((instrument) => {
        const structure = frame.structure?.get(instrument.id);
        if (!structure) {
          current.delete(instrument.id);
          return [];
        }
        const cached = current.get(instrument.id);
        if (cached?.structure === structure) return cached.moons;
        const moons: DriverOrbit[] = [];
        current.set(instrument.id, { structure, moons });
        structure.steps.forEach((step, index) => {
          if (step.kind !== 'setting' || !['signal', 'opaque'].includes(step.driver.kind)) return;
          if (
            structure.steps
              .slice(index + 1)
              .some((later) => later.kind === 'setting' && later.name === step.name)
          )
            return;
          for (const rate of step.driver.rates) {
            const argument = rate.args.length ? rate.args[0] : undefined;
            if (
              (argument?.kind === 'literal' && typeof argument.value === 'number') ||
              (argument?.kind === 'pattern' &&
                argument.pattern.core.kind === 'constant' &&
                !argument.pattern.layers.length)
            )
              continue;
            const timings = structure.context.uses.map((use) => use.timing ?? unknownTiming);
            const badTiming = timings.find((timing) => timing.status === 'unavailable');
            const timing: ViewUseTiming =
              badTiming ??
              (timings.length
                ? {
                    status: 'available',
                    spans: timings.flatMap((timing) =>
                      timing.status === 'available' ? timing.spans : [],
                    ),
                  }
                : unknownTiming);
            const timingReason =
              timing.status === 'available' &&
              (timing.spans.some((span) => !rational(span.scale) || !rational(span.offset)) ||
                timing.spans.some((span, index) =>
                  timing.spans
                    .slice(index + 1)
                    .some(
                      (other) =>
                        span.from < other.to &&
                        other.from < span.to &&
                        (span.offset !== other.offset || span.scale !== other.scale),
                    ),
                ))
                ? 'Ambiguous or nonrational use-site timing'
                : null;
            const overridden = structure.context.uses.some((use) =>
              use.layers.some(
                (layer) =>
                  layer.kind === 'settings' &&
                  layer.settings.some((setting) => setting.name === step.name),
              ),
            );
            const reason =
              (overridden ? 'Use-site setting replaces this driver' : null) ??
              timingReason ??
              step.opaque ??
              step.driver.opaque ??
              rate.opaque ??
              (step.driver.rates.length > 1 ? 'Combined driver rates are unavailable' : null) ??
              (structure.steps
                .slice(index + 1)
                .some((later) => later.kind === 'rewrite' || later.kind === 'opaque')
                ? 'Later score rewrite has no established driver timing'
                : null) ??
              (timing.status === 'unavailable' ? timing.reason : null);
            const moon: DriverOrbit = {
              instrument: instrument.id,
              setting: step.name === 'cutoff' ? 'lpf' : step.name,
              notation:
                argument?.kind === 'pattern' && argument.pattern.core.kind === 'sequence'
                  ? argument.pattern.core.notation
                  : 'pattern',
              status: reason ? 'unknown' : 'pending',
              reason: reason ?? '',
              period: null,
              segments: [],
              total: 0,
              timing,
            };
            const slot = moons.push(moon) - 1;
            if (!reason)
              void rate
                .events()
                .then((answer) => {
                  if (active) moons[slot] = establishDriver(moon, rate, answer, frame);
                })
                .catch((error: unknown) => {
                  if (active) moons[slot] = { ...moon, status: 'unknown', reason: String(error) };
                });
          }
        });
        return moons;
      });
    },
    dispose() {
      active = false;
      current.clear();
    },
  };
}
