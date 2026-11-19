import type { ViewFrame, ViewProgramStructure, ViewSnapshot, ViewStructureStep } from '../types';
import { pitch, noteName } from '../shared/pitch';

export interface PaperNote {
  start: number;
  end: number;
  onset: boolean;
  value: Record<string, unknown>;
  fragments?: number;
}
export type Answer = ViewSnapshot | undefined;
export function paperWindow(frame: ViewFrame) {
  const period = frame.sections.at(-1)?.to ?? 0;
  const offset = period ? Math.floor(frame.now / period) * period : 0;
  const section = frame.sections.find(
    (s) => frame.now >= s.from + offset && frame.now < s.to + offset,
  );
  const origin = section ? section.from + offset : 0;
  const from = origin + Math.floor((frame.now - origin) / 4) * 4;
  return {
    from,
    to: Math.min(from + 4, section ? section.to + offset : from + 4),
    section,
    offset,
  };
}
export function focusPart(frame: ViewFrame, manual?: string) {
  if (manual && frame.instruments.some((i) => i.id === manual)) return manual;
  const { section, offset } = paperWindow(frame);
  const from = section ? section.from + offset : Math.floor(frame.now / 4) * 4;
  const to = section ? section.to + offset : from + 4;
  const active = new Set(
    frame.notes.filter((n) => n.start < to && n.end > from).map((n) => n.instrument),
  );
  const candidates = frame.instruments.filter((i) => active.has(i.id));
  return (candidates.length ? candidates : frame.instruments)
    .slice()
    .sort(
      (a, b) =>
        (frame.structure?.get(b.id)?.steps.length ?? 0) -
          (frame.structure?.get(a.id)?.steps.length ?? 0) || a.index - b.index,
    )[0]?.id;
}
export function visibleSteps(count: number, open: number) {
  if (!count) return [];
  const revealed = Math.round(Math.max(0, Math.min(1, open)) * (count - 1));
  return [...Array.from({ length: revealed }, (_, i) => i), count - 1];
}
export function sealedReason(structure: ViewProgramStructure, index: number) {
  return structure.steps.slice(0, index + 1).find((s) => s.opaque)?.opaque ?? null;
}
export function snapshotNotes(answer: Answer, from: number, to: number): PaperNote[] {
  if (answer?.status !== 'available' || answer.result.error) return [];
  const runs = new Map<string, { note: PaperNote; partEnd: number }[]>();
  const notes: PaperNote[] = [];
  for (const event of answer.result.events
    .slice()
    .sort((a, b) => a.part[0] - b.part[0] || a.part[1] - b.part[1])) {
    const span = event.whole ?? event.part;
    if (span[0] >= to || span[1] <= from) continue;
    const value =
      event.value !== null && typeof event.value === 'object' && !Array.isArray(event.value)
        ? (event.value as Record<string, unknown>)
        : { value: event.value };
    const key = JSON.stringify([event.whole, value]);
    const candidates = runs.get(key) ?? [];
    // Only stitch touching continuations; two simultaneous onsets remain two notes.
    const previous =
      event.whole && !event.hasOnset
        ? candidates.find((run) => Math.abs(run.partEnd - event.part[0]) < 1e-9)
        : undefined;
    if (previous) {
      previous.partEnd = event.part[1];
      previous.note.fragments = (previous.note.fragments ?? 1) + 1;
    } else {
      const note = { start: span[0], end: span[1], onset: event.hasOnset, value, fragments: 1 };
      notes.push(note);
      candidates.push({ note, partEnd: event.part[1] });
      runs.set(key, candidates);
    }
  }
  return notes;
}
export function answerReason(answer: Answer) {
  return answer?.status === 'unavailable' ? answer.reason : answer?.result.error?.message;
}
export function scalar(value: unknown): string {
  if (typeof value === 'number') return String(Math.round(value * 1000) / 1000);
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  if (value === undefined) return 'undefined';
  return JSON.stringify(value);
}
type Core = Extract<ViewStructureStep, { kind: 'phrase' }>['core'];
type Arg = Extract<ViewStructureStep, { kind: 'setting' }>['args'][number];
type Pattern = Extract<Arg, { kind: 'pattern' }>['pattern'];
export function coreLabel(core: Core): string {
  switch (core.kind) {
    case 'sequence':
      return core.notation;
    case 'signal':
      return core.shape;
    case 'constant':
    case 'data':
      return scalar(core.value);
    case 'generator':
      return `${core.name}(${core.args.map(argLabel).join(', ')})`;
    case 'group':
      return `${core.how} · ${String(core.parts.length)} parts`;
    case 'ref':
      return core.name;
    case 'opaque':
      return core.code;
    case 'hole':
      return 'callback parameter';
  }
}
export function argLabel(arg: Arg): string {
  if (arg.kind === 'pattern') return patternLabel(arg.pattern);
  if (arg.kind === 'literal') return scalar(arg.value);
  if (arg.kind === 'callback') return `callback: ${patternLabel(arg.body)}`;
  return arg.code;
}
export function patternLabel(pattern: Pattern): string {
  return (
    coreLabel(pattern.core) +
    pattern.layers
      .map((layer) =>
        layer.kind === 'rewrite'
          ? ` · ${layer.name} ${layer.args.map(argLabel).join(', ')}`
          : layer.kind === 'opaque'
            ? ' · source'
            : layer.settings.map((s) => ` · ${s.name} ${patternLabel(s.value)}`).join(''),
      )
      .join('')
  );
}
export function stepLabel(step: ViewStructureStep) {
  return step.kind === 'phrase' ? 'phrase' : step.kind === 'opaque' ? 'source' : step.name;
}
export function stepDetail(step: ViewStructureStep) {
  return step.kind === 'phrase'
    ? coreLabel(step.core)
    : step.kind === 'opaque'
      ? step.code
      : step.args.map(argLabel).join(', ');
}
/** Compare actual score identities, ignoring the settings collected on each note. */
export function noteIdentity(notes: PaperNote[]) {
  return notes
    .map((n) =>
      JSON.stringify([
        n.start,
        n.end,
        n.onset,
        n.value.note,
        n.value.n,
        n.value.freq,
        n.value.value,
        pitch(n.value) === undefined && n.value.value === undefined ? n.value.s : null,
      ]),
    )
    .sort()
    .join('|');
}
export function noteLabel(note: PaperNote) {
  const p = pitch(note.value);
  return typeof note.value.note === 'string'
    ? note.value.note.replace(/^([a-g])b/i, '$1♭').toUpperCase()
    : p !== undefined
      ? noteName(p)
      : scalar(note.value.s ?? note.value.value ?? '•');
}
/** Fixed time/pitch bins: siblings never affect a note's slot. Every mark retains its multiplicity. */
export function printMarks(notes: PaperNote[], from: number, to: number, width: number) {
  const columns = Math.max(1, Math.floor(width / 26));
  const bins = new Map<
    string,
    { x: number; lane: number; end: number; count: number; label: string }
  >();
  for (const note of notes) {
    const p = pitch(note.value);
    const lane = p === undefined ? 2 : ((Math.round(p) % 24) + 24) % 24;
    const x = Math.max(0, (note.start - from) / (to - from));
    const key = `${String(Math.floor(x * columns))}:${String(Math.floor(lane / 3))}`;
    const mark = bins.get(key);
    if (mark) {
      mark.count++;
      mark.end = Math.max(mark.end, Math.min(1, (note.end - from) / (to - from)));
    } else
      bins.set(key, {
        x,
        lane,
        end: Math.min(1, (note.end - from) / (to - from)),
        count: 1,
        label: noteLabel(note),
      });
  }
  return [...bins.values()];
}
/** One outstanding question per mount, only requested by visible paper. Results are inert cached answers. */
export function answerBook() {
  const books = new Map<ViewProgramStructure, Map<string, Answer>>();
  let pending = false,
    disposed = false;
  return {
    read(structure: ViewProgramStructure, key: string, ask: () => Promise<ViewSnapshot>): Answer {
      let book = books.get(structure);
      if (!book) {
        book = new Map();
        books.set(structure, book);
        const oldest = books.keys().next().value;
        if (books.size > 4 && oldest) books.delete(oldest);
      }
      if (!book.has(key) && !pending && !disposed) {
        book.set(key, undefined);
        pending = true;
        const target = book;
        void ask()
          .catch(
            (e: unknown): ViewSnapshot => ({
              status: 'unavailable',
              reason: e instanceof Error ? e.message : String(e),
            }),
          )
          .then((answer) => {
            pending = false;
            if (!disposed) target.set(key, answer);
          });
      }
      return book.get(key);
    },
    dispose() {
      disposed = true;
      books.clear();
    },
  };
}
export function contextLabels(structure: ViewProgramStructure) {
  return [
    ...structure.context.uses.map(
      (use, i) =>
        `use ${String(i + 1)}: ${use.layers.length ? use.layers.map((layer) => (layer.kind === 'rewrite' ? `${layer.name} ${layer.args.map(argLabel).join(', ')}` : layer.kind === 'opaque' ? 'source' : layer.settings.map((s) => `${s.name} ${patternLabel(s.value)}`).join(' · '))).join(' → ') : 'placement'}`,
    ),
    ...structure.context.transforms.map(
      (transform, i) => `all ${String(i + 1)}: ${transform.args.map(argLabel).join(', ')}`,
    ),
  ];
}
