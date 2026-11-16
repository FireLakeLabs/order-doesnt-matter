import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PointerEvent } from 'react';
import { runtime, store } from './runtime';
import { useStudioStore } from './store';
import type { StudioClock } from './clock';
import { markedLoop, pageRange, pointerCycle } from './transport';

export function ScrubStrip({ clock }: { clock: StudioClock }) {
  const { state } = useStudioStore(store);
  const time = useSyncExternalStore(runtime.transport.subscribe, runtime.transport.getSnapshot);
  const [pages, setPages] = useState(() => pageRange(0));
  const track = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    id: number;
    start: number;
    marking: boolean;
    from: number;
    to: number;
  } | null>(null);
  const last = state.sections.at(-1);
  const range = last ? { from: 0, to: last.start + last.cycles } : pages;
  const blocks = last
    ? state.sections.map((s) => ({ name: s.name, from: s.start, to: s.start + s.cycles }))
    : Array.from({ length: 4 }, (_, i) => ({
        name: `Cycles ${String(pages.from + i * 4)}–${String(pages.from + i * 4 + 4)}`,
        from: pages.from + i * 4,
        to: pages.from + i * 4 + 4,
      }));
  const draw = (now: number) => {
    const current = last ? now % range.to : now;
    const display = last && !gesture.current ? current : now;
    const fraction = (display - range.from) / (range.to - range.from);
    if (knob.current) {
      const width = track.current?.clientWidth ?? 0;
      const x = Math.max(0, Math.min(1, fraction)) * width;
      const grip = knob.current.firstElementChild as HTMLElement | null;
      if (grip) grip.style.left = `${String(Math.max(0, Math.min(width - 24, x - 11)) - x)}px`;
      knob.current.style.left = `${String(Math.max(0, Math.min(1, fraction)) * 100)}%`;
      knob.current.setAttribute('aria-valuenow', String(now));
    }
    for (const block of Array.from(
      track.current?.querySelectorAll<HTMLElement>('[data-from]') ?? [],
    ))
      block.dataset.current = String(
        current >= Number(block.dataset.from) && current < Number(block.dataset.to),
      );
  };
  useEffect(() =>
    clock.subscribe(({ now }) => {
      draw(now);
      if (!last && !gesture.current) {
        const next = pageRange(now);
        if (next.from !== pages.from) setPages(next);
      }
    }),
  );
  const position = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const bounds = gesture.current ?? range;
    return pointerCycle(event.clientX, rect.left, rect.width, bounds.from, bounds.to);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    const cycle = position(event);
    if (drag.marking) {
      const loop = markedLoop(drag.start, cycle);
      if (preview.current) {
        preview.current.style.display = 'block';
        preview.current.style.left = `${String(((loop.from - range.from) / (range.to - range.from)) * 100)}%`;
        preview.current.style.width = `${String(((loop.to - loop.from) / (range.to - range.from)) * 100)}%`;
      }
    } else {
      runtime.scrubTo(cycle);
    }
  };
  const finish = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    move(event);
    const cycle = position(event);
    gesture.current = null;
    if (preview.current) preview.current.style.display = 'none';
    if (drag.marking) {
      if (!cancelled) void runtime.setLoop(markedLoop(drag.start, cycle));
    } else void runtime.endScrub();
  };
  return (
    <section className="scrub-strip" data-region="scrub-strip">
      <div
        ref={track}
        className="song-track"
        data-testid="song-track"
        onPointerDown={(event) => {
          if (event.button !== 0 || gesture.current) return;
          event.preventDefault();
          const cycle = position(event);
          gesture.current = {
            id: event.pointerId,
            start: cycle,
            marking: event.shiftKey || time.marking,
            ...range,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          if (!gesture.current.marking) runtime.beginScrub();
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
        {blocks.map((block) => (
          <div
            className="song-block"
            key={block.from}
            data-from={block.from}
            data-to={block.to}
            style={{
              width: `${String(((block.to - block.from) / (range.to - range.from)) * 100)}%`,
            }}
          >
            {block.name}
            <small>
              {block.from}–{block.to}
            </small>
          </div>
        ))}
        {time.loop && (
          <div
            className="song-loop"
            data-testid="loop-range"
            style={{
              left: `${String(((time.loop.from - range.from) / (range.to - range.from)) * 100)}%`,
              width: `${String(((time.loop.to - time.loop.from) / (range.to - range.from)) * 100)}%`,
            }}
          />
        )}
        <div ref={preview} className="song-loop" style={{ display: 'none' }} />
        <div
          ref={knob}
          className="song-playhead"
          role="slider"
          aria-label="Playhead"
          aria-valuemin={range.from}
          aria-valuemax={range.to}
        >
          <div className="song-knob" data-testid="playhead-knob" />
        </div>
      </div>
      <small className="song-hint">
        {time.marking
          ? 'Drag to mark a loop'
          : time.loop
            ? `Loop ${String(time.loop.from)}–${String(time.loop.to)} · click Loop to clear`
            : 'Drag to scrub · Shift-drag to loop'}
        {!last && ' · continues →'}
      </small>
    </section>
  );
}
