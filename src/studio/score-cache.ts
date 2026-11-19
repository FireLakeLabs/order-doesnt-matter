import type { AppState } from '../app/state';
import type { QueryEvents } from '../contract';
import { generate } from '../generate';
import { walk } from '../document';
import { viewNotes, type ScoreWindow } from './frame';

interface Questions {
  query: QueryEvents;
  cancel(): void;
}
/** One latest request per purpose. Promotion keeps an in-flight answer alive. */
export function createScoreCache(
  query: QueryEvents,
  options: { cancel?: () => void; ahead?: Questions } = {},
) {
  const slot = (questions: Questions) => ({
    ...questions,
    key: '',
    revision: 0,
    answer: null as ScoreWindow | null,
    notes: [] as ReturnType<typeof viewNotes>,
    error: '',
  });
  let current = slot({ query, cancel: options.cancel ?? (() => undefined) });
  let ahead = slot(options.ahead ?? { query, cancel: () => undefined });
  let doc: AppState['doc'] = null;
  let score: ScoreWindow = { from: 0, to: 0, events: {} };
  let notes = viewNotes(score);
  let error = '';
  const key = (range: { from: number; to: number }) => `${String(range.from)}:${String(range.to)}`;
  const clear = (request: typeof current) => {
    ++request.revision;
    request.cancel();
    request.key = '';
    request.answer = null;
    request.notes = [];
    request.error = '';
  };
  const publish = () => {
    if (current.answer) {
      score = current.answer;
      notes = current.notes;
    }
    error = current.error;
  };
  const ask = (request: typeof current, state: AppState, range: { from: number; to: number }) => {
    if (!doc || request.key === key(range)) return;
    clear(request);
    request.key = key(range);
    const revision = request.revision;
    const visual = structuredClone(doc);
    walk(visual, (node) => {
      if ('muted' in node) node.muted = false;
    });
    void Promise.all(
      state.rows.map(
        async (row) =>
          [
            row.id,
            await request.query(generate(visual, { only: row.id }), range.from, range.to),
          ] as const,
      ),
    )
      .then((results) => {
        if (revision !== request.revision) return;
        request.answer = { ...range, events: Object.fromEntries(results) };
        request.notes = viewNotes(request.answer);
        request.error = results
          .flatMap(([id, result]) => (result.error ? [`${id}: ${result.error.message}`] : []))
          .join('; ');
        if (request === current) publish();
      })
      .catch((reason: unknown) => {
        if (revision !== request.revision) return;
        request.error = reason instanceof Error ? reason.message : String(reason);
        if (request === current) publish();
      });
  };
  return {
    get score() {
      return score;
    },
    get notes() {
      return notes;
    },
    get error() {
      return error;
    },
    request(
      state: AppState,
      range: { from: number; to: number },
      next: { from: number; to: number } | null = null,
    ) {
      if (doc !== state.doc) {
        clear(current);
        clear(ahead);
        doc = state.doc;
        score = { ...range, events: {} };
        notes = [];
        error = '';
      }
      if (!doc) return;
      if (current.key !== key(range) && ahead.key === key(range)) {
        [current, ahead] = [ahead, current];
        publish();
      }
      ask(current, state, range);
      // Keep a covering answer during refresh, but never publish a previous
      // window as the answer to a wider or disjoint question.
      if (score.from > range.from || score.to < range.to) {
        score = { ...range, events: {} };
        notes = [];
        error = '';
      }
      if (next && key(next) !== key(range)) ask(ahead, state, next);
      else if (ahead.key) clear(ahead);
    },
    dispose() {
      clear(current);
      clear(ahead);
    },
  };
}
