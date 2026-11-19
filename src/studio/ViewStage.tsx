import { useCallback, useEffect, useRef, useState } from 'react';
import { Expand, Shrink, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { createBrowserQueries } from '../strudel/evaluate-browser';
import { views } from '../views';
import type { ViewTheme } from '../views/types';
import type { StudioClock } from './clock';
import { buildFrame, createAudioFrames, neededRange } from './frame';
import { runtime } from './runtime';
import { createScoreCache } from './score-cache';
import { mountView } from './view-lifecycle';
import { ViewShelf, viewDragType } from './ViewShelf';
import type { Layout, Stage } from './session';

const audioFrame = createAudioFrames();

function Drawing({
  viewId,
  theme,
  lookAhead,
  trails,
  clock,
  metadata,
  cache,
}: {
  viewId: string;
  theme: ViewTheme;
  lookAhead: number;
  trails: 0 | 1 | 2;
  clock: StudioClock;
  metadata: (name: string, tag: string) => void;
  cache: ReturnType<typeof createScoreCache>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const options = useRef({ theme, lookAhead, trails });
  useEffect(() => {
    options.current = { theme, lookAhead, trails };
  }, [theme, lookAhead, trails]);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const entry = views.find((view) => view.id === viewId);
    const owned = document.createElement('div');
    owned.className = 'view-owned';
    container.append(owned);
    let active = true,
      broken = false;
    let size = { width: container.clientWidth, height: container.clientHeight };
    const failed = (reason: unknown) => {
      broken = true;
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    };
    const mounted = mountView(
      async () => {
        if (!entry) throw Error(`Unknown view: ${viewId}`);
        const definition = await entry.load();
        if (active) metadata(definition.name, definition.tag);
        return definition;
      },
      owned,
      failed,
    );
    const observer = new ResizeObserver(([entry]) => {
      size = { width: entry.contentRect.width, height: entry.contentRect.height };
    });
    observer.observe(container);
    const unsubscribe = clock.subscribe((sample) => {
      const { now, cps, playing } = sample;
      if (broken || !mounted.definition || size.width <= 0 || size.height <= 0) return;
      try {
        const { theme, lookAhead, trails } = options.current;
        const state = runtime.app.state;
        const range = neededRange(mounted.definition.span, now, lookAhead, state.sections);
        cache.request(state, range);
        const covers = cache.score.from <= range.from && cache.score.to >= range.to;
        const answered = state.rows.every((row) => Object.hasOwn(cache.score.events, row.id));
        const ready = covers && state.rows.length > 0 && answered;
        if (container.dataset.scoreReady !== String(ready))
          container.dataset.scoreReady = String(ready);
        const message = cache.error || (!ready ? 'Asking the score…' : '');
        if (status.current && status.current.textContent !== message)
          status.current.textContent = message;
        if (!covers || !answered) return;
        mounted.frame(
          buildFrame({
            state,
            audio:
              mounted.definition.needs === 'audio'
                ? audioFrame(runtime.app.engine?.tap(), sample)
                : undefined,
            score: cache.score,
            notes: cache.notes,
            now,
            cps,
            playing,
            theme,
            lookAhead,
            trails,
            ...size,
            dpr: window.devicePixelRatio,
          }),
        );
      } catch (reason) {
        mounted.dispose();
        owned.replaceChildren();
        failed(reason);
      }
    });
    return () => {
      active = false;
      unsubscribe();
      observer.disconnect();
      mounted.dispose();
      owned.remove();
    };
  }, [viewId, attempt, clock, metadata, cache]);
  return (
    <div className="view-stage">
      <div ref={host} className="view-host" data-score-ready="false" />
      {error ? (
        <div className="view-failure" role="alert">
          <strong>View failed</strong>
          <p>{error}</p>
          <Button
            variant="outline"
            onClick={() => {
              setError('');
              setAttempt((value) => value + 1);
            }}
          >
            Retry view
          </Button>
        </div>
      ) : (
        <p className="view-status" ref={status} role="status">
          Asking the score…
        </p>
      )}
    </div>
  );
}
export function ViewStage({
  stage,
  viewId,
  theme,
  lookAhead,
  trails,
  clock,
  filled,
  onFill,
  onSelect,
  choices,
}: {
  stage: Stage;
  viewId: string | null;
  theme: ViewTheme;
  lookAhead: number;
  trails: 0 | 1 | 2;
  clock: StudioClock;
  filled: boolean;
  onFill: () => void;
  onSelect: (stage: Stage, id: string | null) => void;
  choices: Pick<Layout, 'a' | 'b'>;
}) {
  // Allocation is inert; workers start only when a drawing requests a score.
  const [{ cache, queries }] = useState(() => {
    const queries = createBrowserQueries();
    return { cache: createScoreCache(queries.query), queries };
  });
  useEffect(
    () => () => {
      cache.dispose();
      queries.cancel();
    },
    [cache, queries],
  );
  const [metadata, setMetadata] = useState({ id: '', name: '', tag: '' });
  const [shelfOpen, setShelfOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const popover = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const metadataCallback = useCallback(
    (name: string, tag: string) => {
      setMetadata({ id: viewId ?? '', name, tag });
    },
    [viewId],
  );
  useEffect(() => {
    if (!shelfOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShelfOpen(false);
    };
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !popover.current?.contains(event.target) &&
        !opener.current?.contains(event.target)
      )
        setShelfOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', close);
    };
  }, [shelfOpen]);
  return (
    <section
      className={`stage-${stage} region stage`}
      data-region={`stage-${stage}`}
      data-dragging={dragging}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(viewDragType)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const id = event.dataTransfer.getData(viewDragType);
        if (views.some((view) => view.id === id)) onSelect(stage, id);
      }}
    >
      <header className="stage-header">
        <div>
          <span className="stage-label">Stage {stage.toUpperCase()}</span>
          <h2>{viewId ? (metadata.id === viewId ? metadata.name : viewId) : 'Choose a view'}</h2>
          {viewId && metadata.id === viewId && <small>{metadata.tag}</small>}
        </div>
        <div className="stage-actions">
          <Button
            ref={opener}
            className="compact-shelf"
            variant="outline"
            size="sm"
            onClick={() => {
              setShelfOpen(!shelfOpen);
            }}
            aria-expanded={shelfOpen}
          >
            Views
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onFill}
            aria-label={
              filled
                ? `Restore Stage ${stage.toUpperCase()}`
                : `Fill window with Stage ${stage.toUpperCase()}`
            }
          >
            {filled ? <Shrink /> : <Expand />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={!viewId}
            onClick={() => {
              onSelect(stage, null);
            }}
            aria-label={`Clear Stage ${stage.toUpperCase()}`}
          >
            <X />
          </Button>
        </div>
      </header>
      {viewId ? (
        <Drawing
          key={viewId}
          viewId={viewId}
          theme={theme}
          lookAhead={lookAhead}
          trails={trails}
          clock={clock}
          metadata={metadataCallback}
          cache={cache}
        />
      ) : (
        <div className="empty-stage">
          <span>{stage.toUpperCase()}</span>
          <p>Drop a view here</p>
          <small>Choose one from Views</small>
        </div>
      )}
      {shelfOpen && (
        <div ref={popover} className="shelf-popover">
          <ViewShelf
            choices={choices}
            onSelect={(target, id) => {
              onSelect(target, id);
              setShelfOpen(false);
            }}
          />
        </div>
      )}
    </section>
  );
}
