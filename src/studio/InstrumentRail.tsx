import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { Button } from '../components/ui/button';
import { definitionMuted } from '../document/edits/set-muted';
import type { Instrument } from '../document';
import { createBrowserQueries } from '../strudel/evaluate-browser';
import type { ViewTheme } from '../views/types';
import { instrumentInventory } from './instrument-names';
import { instrumentColour } from './themes';
import { neededRange, noteLevel, playingSplit } from './frame';
import { createScoreCache } from './score-cache';
import type { createFrameClock } from './clock';
import { runtime } from './runtime';
import { session, muteEdit, soloEdit, soloedInstrument } from './session';
import type { AppState } from '../app/state';

export function InstrumentRail({
  state,
  theme,
  clock,
}: {
  state: AppState;
  theme: ViewTheme;
  clock: ReturnType<typeof createFrameClock>;
}) {
  const rail = useRef<HTMLElement>(null);
  const { layout, selectedInstrument } = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
  );
  const [sectionCycle, setSectionCycle] = useState(0);
  const { names, sounds, groups } = instrumentInventory(state);
  const { playing, resting } = playingSplit(state, sectionCycle);
  const solo = soloedInstrument(state.doc);
  useEffect(() => {
    const container = rail.current;
    if (!container) return;
    const queries = createBrowserQueries();
    const cache = createScoreCache(queries.query);
    let membership = '';
    const off = clock.subscribe((cycle) => {
      const state = runtime.app.state;
      const split = playingSplit(state, cycle);
      const key = split.playing.map((row) => row.id).join(':');
      // Section transitions change React structure; dots and meters never do.
      if (membership !== key) {
        membership = key;
        setSectionCycle(cycle);
      }
      cache.request(state, neededRange('window', cycle, 4, state.sections));
      const errors = new Map(
        Object.entries(cache.score.events).map(([id, result]) => [id, result.error?.message]),
      );
      for (const row of state.rows) {
        const element = container.querySelector<HTMLElement>(`[data-instrument="${row.id}"]`);
        if (!element) continue;
        const silenced = row.muted || (state.solo !== null && state.solo !== row.id);
        const level = state.playing && !silenced ? noteLevel(cache.notes, row.id, cycle) : 0;
        const sounding = String(level > 0);
        if (element.dataset.sounding !== sounding) element.dataset.sounding = sounding;
        const meter = element.querySelector<HTMLElement>('.meter-fill');
        if (meter) meter.style.transform = `scaleX(${String(level)})`;
        const problem = errors.get(row.id) ?? '';
        const error = element.querySelector<HTMLElement>('.instrument-error');
        if (error && error.textContent !== problem) error.textContent = problem;
      }
    });
    return () => {
      off();
      cache.dispose();
      queries.cancel();
    };
  }, [clock]);
  const mute = (row: Instrument) => {
    const doc = runtime.app.state.doc;
    if (!doc) return;
    runtime.app.editor?.apply(muteEdit(doc, row.id), {}, row.id);
  };
  const isolate = (row: Instrument) => {
    const doc = runtime.app.state.doc;
    if (doc) runtime.app.editor?.apply(soloEdit(doc, row.id));
  };
  const indexOf = (row: Instrument) => state.rows.findIndex((value) => value.id === row.id);
  const grouped = new Map<string | undefined, Instrument[]>();
  for (const row of playing) {
    const group = groups[indexOf(row)];
    const members = grouped.get(group) ?? [];
    members.push(row);
    grouped.set(group, members);
  }
  return (
    <aside
      ref={rail}
      className="instrument-rail region"
      data-region="instrument-rail"
      data-dense={playing.length > 8}
    >
      <header>
        <h2>
          Instruments <small>{state.rows.length}</small>
        </h2>
        <p>{playing.length} playing</p>
      </header>
      <div className="rail-lists" data-testid="instruments">
        <div className="playing-list" data-testid="playing-instruments">
          {[...grouped].map(([group, rows]) => (
            <div className="instrument-group" key={group ?? '_'}>
              {group && <h3>{group}</h3>}
              <ol>
                {rows.map((row) => {
                  const index = indexOf(row);
                  const muted = state.doc ? definitionMuted(state.doc, row.id) : false;
                  return (
                    <li
                      key={row.id}
                      className="instrument-row"
                      data-instrument={row.id}
                      data-selected={selectedInstrument === row.id}
                      data-muted={row.muted}
                      onClick={() => {
                        session.selectInstrument(row.id);
                      }}
                      style={
                        {
                          '--instrument-colour': instrumentColour(theme.name, index),
                        } as CSSProperties
                      }
                    >
                      <button className="instrument-select" title={names[index]}>
                        <span className="instrument-dot" />
                        <span className="instrument-name">
                          <strong>{names[index]}</strong>
                          <small>{sounds[index] ?? 'sound'}</small>
                        </span>
                      </button>
                      <span className="instrument-meter" title="Scored note level">
                        <i className="meter-fill" />
                      </span>
                      <Button
                        className="mute-button"
                        variant="ghost"
                        size="icon"
                        aria-label={`${muted ? 'Unmute' : 'Mute'} ${names[index]}`}
                        aria-pressed={muted}
                        title="Mute · modifier-click to solo"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey)
                            isolate(row);
                          else mute(row);
                        }}
                      >
                        {muted ? <VolumeX /> : <Volume2 />}
                      </Button>
                      <Button
                        className="solo-button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Solo ${names[index]}`}
                        aria-pressed={solo === row.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          isolate(row);
                        }}
                      >
                        S
                      </Button>
                      <span className="instrument-error" role="status" />
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
        {resting.length > 0 && (
          <section className="resting-list">
            <h3>
              Resting <small>{resting.length}</small>
            </h3>
            <div>
              {resting.map((row) => {
                const index = indexOf(row);
                return (
                  <button
                    key={row.id}
                    className="resting-chip"
                    data-instrument={row.id}
                    data-selected={selectedInstrument === row.id}
                    style={
                      {
                        '--instrument-colour': instrumentColour(theme.name, index),
                      } as CSSProperties
                    }
                    onClick={() => {
                      session.selectInstrument(row.id);
                    }}
                    title={groups[index] ? `${groups[index]} · ${names[index]}` : names[index]}
                  >
                    <span />
                    {names[index]}
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
      <footer>
        <label>
          Window <output>{layout.lookAhead} cycles</output>
        </label>
        <div className="rail-segments" role="group" aria-label="Window">
          {([1, 2, 4, 8] as const).map((value) => (
            <button
              key={value}
              aria-pressed={layout.lookAhead === value}
              onClick={() => {
                session.layout({ lookAhead: value });
              }}
            >
              {value}
            </button>
          ))}
        </div>
        <label>
          Trails <output>{['off', 'short', 'long'][layout.trails]}</output>
        </label>
        <div className="rail-segments" role="group" aria-label="Trails">
          {(['off', 'short', 'long'] as const).map((value, index) => (
            <button
              key={value}
              aria-pressed={layout.trails === index}
              onClick={() => {
                session.layout({ trails: index as 0 | 1 | 2 });
              }}
            >
              {value}
            </button>
          ))}
        </div>
        <p>Window and Trails change only the picture.</p>
      </footer>
    </aside>
  );
}
