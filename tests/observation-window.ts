import type { SongSection } from '../src/document';

/** Select before inspecting callbacks: never replace a failed observed bag. */
export function futureInstrumentCycle(sections: SongSection[], instrument: string, now: number) {
  const last = sections.at(-1),
    length = last ? last.start + last.cycles : 0;
  if (!Number.isFinite(now) || !Number.isFinite(length) || length <= 0)
    throw Error('Expected a finite clock and arrangement');
  const first = Math.ceil(now) + 1,
    loop = Math.floor(first / length);
  for (let repeat = loop; repeat <= loop + 1; repeat++)
    for (const section of sections) {
      const start = repeat * length + section.start,
        cycle = Math.ceil(Math.max(first, start));
      if (section.instrumentIds.includes(instrument) && cycle + 1 <= start + section.cycles)
        return cycle;
    }
  throw Error('No complete future cycle contains this instrument');
}
