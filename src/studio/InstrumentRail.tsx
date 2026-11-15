import { instrumentNames, viewNotes } from './frame';
import { instrumentColour } from './themes';
import type { AppState } from '../app/state';
export function InstrumentRail({ state, theme }: { state: AppState; theme: string }) {
  const notes = viewNotes({ from: 0, to: Infinity, events: state.events });
  const names = instrumentNames(state, notes);
  const errors = new Map(Object.entries(state.events).map(([id, result]) => [id, result.error]));
  return (
    <aside className="instrument-rail region" data-region="instrument-rail">
      <h2>
        Instruments <small>{state.rows.length}</small>
      </h2>
      <ol data-testid="instruments">
        {state.rows.map((row, index) => {
          const sound = notes.find((note) => note.instrument === row.id)?.value.s;
          return (
            <li key={row.id}>
              <span
                className="instrument-dot"
                style={{ background: instrumentColour(theme, index) }}
              />
              <div>
                <strong>{names[index]}</strong>
                <small>{typeof sound === 'string' ? sound : '—'}</small>
              </div>
              {errors.get(row.id) && <span title={errors.get(row.id)?.message}>Score error</span>}
            </li>
          );
        })}
      </ol>
      <footer>
        Window <b>4 cycles</b>
        <br />
        Trails <b>short</b>
      </footer>
    </aside>
  );
}
