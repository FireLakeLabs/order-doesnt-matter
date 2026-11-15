import { useEffect, useRef } from 'react';
import { createBrowserQueries } from '../strudel/evaluate-browser';
import { views } from '../views';
import type { ViewTheme } from '../views/types';
import { createFrameClock } from './clock';
import { buildFrame, neededRange } from './frame';
import { runtime } from './runtime';
import { createScoreCache } from './score-cache';
import { mountView } from './view-lifecycle';

const clock = createFrameClock(
  () => runtime.getPlayhead(),
  (callback) => requestAnimationFrame(callback),
  (id) => {
    cancelAnimationFrame(id);
  },
);
export function ViewStage({
  viewId,
  theme,
  lookAhead = 4,
  trails = 1,
}: {
  viewId: string;
  theme: ViewTheme;
  lookAhead?: number;
  trails?: 0 | 1 | 2;
}) {
  const host = useRef<HTMLDivElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const options = useRef({ theme, lookAhead, trails });
  useEffect(() => {
    options.current = { theme, lookAhead, trails };
  }, [theme, lookAhead, trails]);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const entry = views.find((view) => view.id === viewId);
    if (!entry) return;
    const owned = document.createElement('div');
    owned.className = 'view-owned';
    container.append(owned);
    const queries = createBrowserQueries();
    const cache = createScoreCache(queries.query);
    let size = { width: container.clientWidth, height: container.clientHeight };
    let mountError = '';
    const mounted = mountView(
      () => entry.load(),
      owned,
      (error) => {
        mountError = error instanceof Error ? error.message : String(error);
      },
    );
    const observer = new ResizeObserver(([entry]) => {
      size = { width: entry.contentRect.width, height: entry.contentRect.height };
    });
    observer.observe(container);
    const unsubscribe = clock.subscribe((now) => {
      const { theme, lookAhead, trails } = options.current;
      const state = runtime.app.state;
      if (!mounted.definition) return;
      cache.request(state, neededRange(mounted.definition.span, now, lookAhead, state.sections));
      const scoreReady = String(
        state.rows.length > 0 &&
          state.rows.every((row) => Object.hasOwn(cache.score.events, row.id)),
      );
      if (container.dataset.scoreReady !== scoreReady) container.dataset.scoreReady = scoreReady;
      mounted.frame(
        buildFrame({
          state,
          score: cache.score,
          notes: cache.notes,
          now,
          theme,
          lookAhead,
          trails,
          ...size,
          dpr: window.devicePixelRatio,
        }),
      );
      const message =
        mountError ||
        cache.error ||
        (state.rows.length && !cache.notes.length && !Object.keys(cache.score.events).length
          ? 'Asking the score…'
          : '');
      if (status.current && status.current.textContent !== message)
        status.current.textContent = message;
    });
    return () => {
      unsubscribe();
      observer.disconnect();
      cache.dispose();
      queries.cancel();
      mounted.dispose();
      owned.remove();
    };
  }, [viewId]);
  return (
    <div className="view-stage">
      <div ref={host} className="view-host" />
      <p className="view-status" ref={status} role="status" />
    </div>
  );
}
