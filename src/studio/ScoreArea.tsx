import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import type { StudioClock } from './clock';
import { session } from './session';
import { runtime } from './runtime';
import { instrumentInventory } from './instrument-names';
import { instrumentColour } from './themes';
import type { ViewTheme } from '../views/types';
import type { StudioScore } from './lanes/use-score';
import {
  hitRow,
  hitNote,
  LABEL_WIDTH,
  laneRows,
  noteRects,
  settingLaneId,
  rulerTicks,
  timeX,
} from './lanes/model';
import { drawScore } from './lanes/draw';
import { markedLoop, pointerCycle } from './transport';

export function ScoreArea({
  score,
  theme,
  clock,
  children,
}: {
  score: StudioScore;
  theme: ViewTheme;
  clock: StudioClock;
  children?: React.ReactNode;
}) {
  const { selectedInstrument, expandedSettings } = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
  );
  const time = useSyncExternalStore(runtime.transport.subscribe, runtime.transport.getSnapshot);
  const scroll = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    playhead = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0, dpr: 1 });
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const physical = entry.devicePixelContentBoxSize.at(0)?.inlineSize;
      const dpr =
        physical && entry.contentRect.width
          ? physical / entry.contentRect.width
          : window.devicePixelRatio || 1;
      setSize({ width: el.clientWidth, height: el.clientHeight, dpr });
    });
    observer.observe(el, { box: 'device-pixel-content-box' });
    return () => {
      observer.disconnect();
    };
  }, []);
  const lanes = laneRows(score.model?.rows ?? [], size.height, expandedSettings);
  const height = Math.max(size.height, (lanes.at(-1)?.y ?? 0) + (lanes.at(-1)?.height ?? 0));
  const width = Math.max(0, size.width - LABEL_WIDTH);
  const inventory = instrumentInventory(runtime.app.state);
  useEffect(() => {
    const el = canvas.current,
      model = score.model;
    if (!el || !model || width <= 0 || height <= 0) return;
    const dpr = size.dpr;
    el.width = Math.round(width * dpr);
    el.height = Math.round(height * dpr);
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const backing = document.createElement('canvas');
    backing.width = el.width;
    backing.height = el.height;
    const staticCtx = backing.getContext('2d');
    if (!staticCtx) return;
    staticCtx.scale(dpr, dpr);
    drawScore(staticCtx, lanes, model, score.events, width, height, theme, selectedInstrument);
    return clock.subscribe(({ now }) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(backing, 0, 0, width, height);
      const loop = runtime.transport.getSnapshot().loop;
      if (loop) {
        const x = Math.max(0, timeX(loop.from, score.from, score.to, width));
        const end = Math.min(width, timeX(loop.to, score.from, score.to, width));
        if (end > x) {
          ctx.globalAlpha = 0.1;
          ctx.fillStyle = theme.accent;
          ctx.fillRect(x, 0, end - x, height);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = theme.accent;
          ctx.strokeRect(x + 1, 0, Math.max(0, end - x - 2), height);
        }
      }
      const x = timeX(now, score.from, score.to, width);
      if (x >= 0 && x < width) {
        ctx.fillStyle = theme.text;
        ctx.fillRect(x, 0, 2, height);
      }
      if (playhead.current) playhead.current.style.left = `${String(LABEL_WIDTH + x)}px`;
    });
  });
  const drag = useRef<{
    id: number;
    start: number;
    from: number;
    to: number;
    marking: boolean;
  } | null>(null);
  const position = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(),
      range = drag.current ?? score;
    return pointerCycle(event.clientX, rect.left, rect.width, range.from, range.to);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    if (!drag.current.marking) runtime.scrubTo(position(event));
  };
  const finish = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const gesture = drag.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    move(event);
    const end = position(event);
    drag.current = null;
    if (gesture.marking) {
      if (!cancelled) void runtime.setLoop(markedLoop(gesture.start, end));
    } else void runtime.endScrub();
  };
  return (
    <section className="score-area region" data-region="score" data-score-ready={score.ready}>
      <header className="score-heading">
        <h2>
          {score.name.replaceAll('$', '')}{' '}
          <small>
            cycles {score.from + 1}–{score.to}
          </small>
        </h2>
        <div
          className="score-ruler"
          data-testid="score-ruler"
          onPointerDown={(event) => {
            if (event.button !== 0 || drag.current) return;
            event.preventDefault();
            drag.current = {
              id: event.pointerId,
              start: position(event),
              from: score.from,
              to: score.to,
              marking: event.shiftKey || time.marking,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            if (!drag.current.marking) runtime.beginScrub();
            move(event);
          }}
          onPointerMove={move}
          onPointerUp={(event) => {
            finish(event);
          }}
          onPointerCancel={(event) => {
            finish(event, true);
          }}
          onLostPointerCapture={(event) => {
            finish(event, true);
          }}
        >
          {rulerTicks(score.from, score.to, width).map((cycle) => (
            <span
              key={cycle}
              style={{ left: `${String(timeX(cycle, score.from, score.to, 100))}%` }}
            >
              {cycle + 1}
            </span>
          ))}
        </div>
        <div className="score-ruler-playhead" ref={playhead} />
      </header>
      <div className="score-scroll" ref={scroll}>
        <div className="lane-content" style={{ height }}>
          <div className="lane-labels">
            {lanes.map((lane) => {
              const index = (score.model?.rows ?? []).findIndex((row) => row.id === lane.row.id);
              const colour = instrumentColour(theme.name, index);
              const name = inventory.names[index] ?? lane.row.name;
              const cell = lane.row.cells.find(
                (cell) => settingLaneId(lane.row.id, cell) === lane.setting,
              );
              return (
                <button
                  key={lane.setting ?? lane.row.id}
                  className="lane-label"
                  data-instrument={lane.row.id}
                  data-setting={lane.setting}
                  data-resting={lane.row.absent}
                  data-selected={selectedInstrument === lane.row.id}
                  style={{ height: lane.height, '--instrument-colour': colour } as CSSProperties}
                  onClick={() => {
                    session.selectInstrument(lane.row.id);
                    if (cell) session.openEditor(cell.nodeId);
                  }}
                >
                  <span className="lane-dot" />
                  <strong>{cell ? cell.name : name}</strong>
                  {cell ? (
                    <small>values</small>
                  ) : lane.row.absent ? (
                    <span className="section-mini-map">
                      {(score.model?.sections ?? []).map((section) => (
                        <i
                          key={section.nodeId}
                          title={section.name}
                          data-present={section.instruments.some(
                            (inst) => inst.id === lane.row.id && inst.state === 'present',
                          )}
                        />
                      ))}
                    </span>
                  ) : (
                    <span className="lane-counts">
                      <small>{lane.row.rewrites.length} rewrites</small>
                      <small>
                        {
                          lane.row.cells.filter(
                            (cell) => cell.name !== 'rhythm' && cell.kind !== 'unused',
                          ).length
                        }{' '}
                        settings
                      </small>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <canvas
            ref={canvas}
            className="score-canvas"
            aria-label="Instrument time lanes"
            style={{ left: LABEL_WIDTH, width, height }}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect(),
                x = event.clientX - rect.left,
                y = event.clientY - rect.top;
              const lane = hitRow(lanes, y);
              if (!lane) return;
              session.selectInstrument(lane.row.id);
              if (lane.setting) {
                const cell = lane.row.cells.find(
                  (cell) => settingLaneId(lane.row.id, cell) === lane.setting,
                );
                if (cell) session.openEditor(cell.nodeId);
              }
              // Model hit testing also identifies the actual note for inspection.
              const note = hitNote(
                noteRects(score.events[lane.row.id], lane, score.from, score.to, width),
                x,
                y,
              );
              event.currentTarget.title = note ? JSON.stringify(note.value) : lane.row.status;
            }}
          />
        </div>
      </div>
      <footer className="score-caption">
        {score.error ||
          'Scored spans · 18 rows fit with six playing at 1080p · resting rows compress before scrolling'}
      </footer>
      {children}
    </section>
  );
}
