import { useEffect, useRef, useSyncExternalStore } from 'react';
import { TopBar } from './TopBar';
import { ScrubStrip } from './ScrubStrip';
import { InstrumentRail } from './InstrumentRail';
import { ViewStage } from './ViewStage';
import { ViewShelf } from './ViewShelf';
import { ScoreArea } from './ScoreArea';
import { Tray } from './Tray';
import { runtime, store } from './runtime';
import { useStudioStore } from './store';
import { resolveTheme } from './themes';
import { useScore } from './lanes/use-score';
import { editorContext } from './tray/context';
import { EditorHost, kindFor } from './tray/EditorHost';
import { instrumentInventory } from './instrument-names';
import { createFrameClock } from './clock';
import { session, type Stage } from './session';

// All subscribers receive one latency-corrected sample from one page RAF.
const clock = createFrameClock(
  () => runtime.sample(),
  (callback) => requestAnimationFrame(callback),
  (id) => {
    cancelAnimationFrame(id);
  },
);
export function Studio() {
  const snapshot = useStudioStore(store);
  const { layout, filledStage, editorTarget } = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
  );
  const score = useScore(clock);
  const context = editorContext(editorTarget, score);
  const theme = resolveTheme(layout.theme);
  const editorIndex = snapshot.state.rows.findIndex(
    (row) => row.id === context?.target.instrumentId,
  );
  const editorName =
    editorIndex >= 0 ? instrumentInventory(snapshot.state).names[editorIndex] : 'Piece';
  const activation = useRef(runtime.app.activation);
  useEffect(() => {
    if (activation.current !== runtime.app.activation) {
      activation.current = runtime.app.activation;
      session.resetSelection();
    }
  }, [snapshot.state.doc]);
  useEffect(() => {
    const selected = session.getSnapshot().selectedInstrument;
    if (selected && !snapshot.state.rows.some((row) => row.id === selected))
      session.selectInstrument(null);
  }, [snapshot.state.rows]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme.name;
  }, [theme]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') session.fill(null);
    };
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('keydown', escape);
    };
  }, []);
  const choose = (stage: Stage, id: string | null) => {
    session.layout({ [stage]: id });
  };
  return (
    <main className="studio" data-filled={filledStage ?? undefined}>
      <TopBar
        clock={clock}
        snapshot={snapshot}
        theme={theme.name}
        setTheme={(name) => {
          session.layout({ theme: name });
        }}
      />
      <ScrubStrip clock={clock} />
      <div className="workspace">
        <InstrumentRail state={snapshot.state} theme={theme} clock={clock} />
        {(['a', 'b'] as const).map((stage) => (
          <ViewStage
            key={stage}
            stage={stage}
            viewId={layout[stage]}
            theme={theme}
            lookAhead={layout.lookAhead}
            trails={layout.trails}
            clock={clock}
            filled={filledStage === stage}
            onFill={() => {
              session.fill(filledStage === stage ? null : stage);
            }}
            onSelect={choose}
            choices={layout}
          />
        ))}
        <div className="wide-shelf">
          <ViewShelf onSelect={choose} choices={layout} />
        </div>
      </div>
      <div className="bottom-regions">
        <ScoreArea score={score} theme={theme} clock={clock}>
          {context && kindFor(context).layout === 'wide' && (
            <div className="wide-editor">
              <EditorHost
                context={context}
                name={editorName}
                entry={runtime.app.editor?.state.entries[context.target.nodeId]}
                close={() => {
                  session.openEditor(null);
                }}
              />
            </div>
          )}
        </ScoreArea>
        <Tray score={score} theme={theme.name} context={context} editorName={editorName} />
      </div>
    </main>
  );
}
