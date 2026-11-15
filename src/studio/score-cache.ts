import type { AppState } from '../app/state';
import type { QueryEvents } from '../contract';
import { generate } from '../generate';
import { walk } from '../document';
import { viewNotes, type ScoreWindow } from './frame';

/** One latest request per stage; no worker questions during an unchanged range. */
export function createScoreCache(query: QueryEvents) {
  let doc: AppState['doc'] = null;
  let score: ScoreWindow = { from: 0, to: 0, events: {} };
  let notes = viewNotes(score);
  let requested = '';
  let revision = 0;
  let error = '';
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
    request(state: AppState, range: { from: number; to: number }) {
      if (doc !== state.doc) {
        doc = state.doc;
        requested = '';
        score = { ...range, events: {} };
        notes = [];
        error = '';
        ++revision;
      }
      if (!doc) return;
      const key = `${String(range.from)}:${String(range.to)}`;
      if (requested === key) return;
      requested = key;
      const current = ++revision;
      const visual = structuredClone(doc);
      walk(visual, (node) => {
        if ('muted' in node) node.muted = false;
      });
      void Promise.all(
        state.rows.map(
          async (row) =>
            [
              row.id,
              await query(generate(visual, { only: row.id }), range.from, range.to),
            ] as const,
        ),
      )
        .then((results) => {
          if (current !== revision) return;
          score = { ...range, events: Object.fromEntries(results) };
          notes = viewNotes(score);
          error = results
            .flatMap(([id, result]) => (result.error ? [`${id}: ${result.error.message}`] : []))
            .join('; ');
        })
        .catch((reason: unknown) => {
          if (current === revision)
            error = reason instanceof Error ? reason.message : String(reason);
        });
    },
    dispose() {
      ++revision;
    },
  };
}
