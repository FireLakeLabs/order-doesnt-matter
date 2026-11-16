import { useMemo, useSyncExternalStore, type CSSProperties } from 'react';
import { sourceFragment } from '../document/edits/source-shared';
import { describeTarget, rhythmTargetId } from '../document/edit';
import { runtime } from './runtime';
import { session } from './session';
import { instrumentInventory } from './instrument-names';
import { instrumentColour } from './themes';
import { settingLaneId } from './lanes/model';
import type { StudioScore } from './lanes/use-score';
import type { EditorContext } from '../editor/kind';
import { pendingFor } from './tray/context';
import { EditorHost, kindFor } from './tray/EditorHost';
import { customWords, plainName, sparkline } from './tray/model';

export function Tray({
  score,
  theme,
  context,
  editorName,
}: {
  score: StudioScore;
  theme: string;
  context: EditorContext | null;
  editorName: string;
}) {
  const { selectedInstrument, expandedSettings } = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
  );
  const state = runtime.app.state,
    doc = state.doc;
  const words = useMemo(() => (doc ? customWords(doc) : []), [doc]);
  const row = score.model?.rows.find((row) => row.id === selectedInstrument);
  const index = state.rows.findIndex((row) => row.id === selectedInstrument);
  const instrument = state.rows.find((row) => row.id === selectedInstrument);
  const name = instrumentInventory(state).names[index] ?? '';
  const colour = instrumentColour(theme, Math.max(0, index));
  const close = () => {
    session.openEditor(null);
  };
  if (context && kindFor(context).layout !== 'wide')
    return (
      <aside className="tray region" data-region="tray">
        <EditorHost
          context={context}
          name={editorName}
          entry={runtime.app.editor?.state.entries[context.target.nodeId]}
          close={close}
        />
      </aside>
    );
  if (!doc || !row || !instrument)
    return (
      <aside className="tray region tray-empty" data-region="tray">
        <h2>Tray</h2>
        <p>Select an instrument to explore its score.</p>
      </aside>
    );
  const settings = row.cells.filter((cell) => cell.name !== 'rhythm');
  const rewrites = row.rewrites;
  const sourceOnly = instrument.pattern.core.kind === 'opaque';
  const source = sourceOnly ? sourceFragment(doc, `${instrument.pattern.id}:source`) : null;
  return (
    <aside
      className="tray region"
      data-region="tray"
      style={{ '--instrument-colour': colour } as CSSProperties}
    >
      <header className="tray-heading">
        <span className="lane-dot" />
        <h2>{name}</h2>
        {!sourceOnly && (
          <button
            onClick={() => {
              session.openEditor(`${instrument.pattern.id}:source`);
            }}
          >
            Edit as source
          </button>
        )}
      </header>
      <div className="tray-content">
        {sourceOnly && (
          <section className="tray-source">
            <h3>Source text</h3>
            <pre>{source}</pre>
            <button
              onClick={() => {
                session.openEditor(`${instrument.pattern.id}:source`);
              }}
            >
              Edit as source
            </button>
          </section>
        )}
        <section className="tray-group">
          <h3>
            Order matters <small>rewrites run in this order</small>
          </h3>
          <ol className="rewrite-chain">
            {rewrites.map((rewrite, i) => (
              <li key={rewrite.nodeId}>
                {i > 0 && <span className="rewrite-arrow">→</span>}
                <button
                  data-target={rewrite.nodeId}
                  data-edit-state={pendingFor(rewrite.nodeId)?.status ?? ''}
                  title={rewrite.summary}
                  onClick={() => {
                    session.openEditor(rewrite.nodeId);
                  }}
                >
                  <b>{i + 1}</b>
                  <span>
                    {rewrite.source
                      ? (/\.([\w]+)\(/.exec(rewrite.summary)?.[1] ?? rewrite.name)
                      : rewrite.name}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {!rewrites.length && <p className="tray-quiet">No rewrites</p>}
        </section>
        <section className="tray-group">
          <h3>
            Order doesn’t matter <small>settings</small>
          </h3>
          <div className="setting-grid">
            {settings.map((cell) => {
              const target = describeTarget(doc, cell.nodeId);
              const moving = cell.kind === 'curve' || target.kind === 'setting-signal',
                varied = moving || cell.values.length > 1;
              const pending = pendingFor(cell.nodeId);
              return (
                <div
                  className="setting-tile"
                  key={`${cell.name}:${cell.nodeId}`}
                  data-edit-state={pending?.status ?? ''}
                  data-setting-name={cell.name}
                >
                  <button
                    className="setting-open"
                    onClick={() => {
                      session.openEditor(cell.nodeId);
                    }}
                    aria-label={`Edit ${plainName(cell.name)}`}
                    title={cell.summary}
                  >
                    <b>{plainName(cell.name)}</b>
                    {varied && (
                      <svg viewBox="0 0 100 35" preserveAspectRatio="none" aria-label="Real values">
                        <path d={sparkline(cell)} />
                      </svg>
                    )}
                    <span>
                      {moving
                        ? 'moving'
                        : !varied && target.kind === 'setting-constant'
                          ? target.displayValue
                          : cell.label || target.displayValue || 'No values in this section'}
                    </span>
                    {pending?.status === 'pending' && <small>pending</small>}
                    {pending?.status === 'failed' && <small>Change failed</small>}
                  </button>
                  {varied && (
                    <button
                      className="show-lane"
                      aria-label={`Show ${plainName(cell.name)} as lane`}
                      aria-pressed={expandedSettings.includes(settingLaneId(row.id, cell))}
                      onClick={() => {
                        session.toggleLane(settingLaneId(row.id, cell));
                      }}
                    >
                      {expandedSettings.includes(settingLaneId(row.id, cell))
                        ? 'Hide lane'
                        : 'Show as lane'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <button
            className="rhythm-open"
            onClick={() => {
              session.openEditor(rhythmTargetId(instrument.pattern));
            }}
          >
            Edit rhythm ↗
          </button>
        </section>
        <section className="tray-group custom-words">
          <h3>Words this piece made up</h3>
          <div>
            {words.map((word) => (
              <button
                key={word.name}
                onClick={() => {
                  session.openEditor(word.nodeId);
                }}
                title={word.source}
              >
                {word.name} <small>custom</small>
              </button>
            ))}
            {!words.length && <p className="tray-quiet">No custom words</p>}
          </div>
        </section>
      </div>
    </aside>
  );
}
