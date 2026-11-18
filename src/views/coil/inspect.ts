import type { ViewFrame, ViewNote } from '../types';
import { pitch, pitchClass } from '../shared/pitch';

function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'number' && Number.isFinite(value))
    return String(Number(value.toPrecision(6)));
  return typeof value === 'string' ? value : JSON.stringify(value);
}
export function noteLabel(note: ViewNote) {
  const midi = pitch(note.value);
  return midi === undefined
    ? formatValue(note.value.s ?? note.value.sound ?? 'note')
    : `${['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'][pitchClass(midi)]}${String(Math.floor(Math.round(midi) / 12) - 1)}`;
}
export function noteDescription(note: ViewNote, frame: ViewFrame) {
  const part = frame.instruments.find((i) => i.id === note.instrument)?.name ?? note.instrument;
  const position = `${String(Math.floor(note.start) + 1)}.${String(Number((1 + (((note.start % 1) + 1) % 1) * 4).toFixed(4)))}`;
  return `${part} · ${noteLabel(note)}\nPosition ${position} · length ${String(Number(((note.end - note.start) * 4).toFixed(4)))} beats\n${Object.entries(
    note.value,
  )
    .map(([k, v]) => `${k}: ${formatValue(v)}`)
    .join(' · ')}`;
}
export function barNotes(frame: ViewFrame, cycle: number) {
  return frame.notes.filter((n) => n.start < cycle + 1 && n.end > cycle);
}

/** Keep simultaneous notes separate without shrinking their labels away. */
export function barRows(frame: ViewFrame, cycle: number) {
  const notes = barNotes(frame, cycle);
  let y = 30;
  return frame.instruments
    .filter((i) => notes.some((n) => n.instrument === i.id))
    .sort((a, b) => a.index - b.index)
    .map((part) => {
      const rowNotes = notes
        .filter((n) => n.instrument === part.id)
        .sort((a, b) => a.start - b.start);
      const ends: number[] = [];
      const lanes = rowNotes.map((n) => {
        let lane = ends.findIndex((end) => end <= n.start);
        if (lane < 0) lane = ends.length;
        ends[lane] = n.end;
        return lane;
      });
      const height = Math.max(34, ends.length * 18);
      const row = {
        part,
        notes: rowNotes,
        lanes,
        y,
        height,
        laneHeight: height / Math.max(1, ends.length),
      };
      y += height + 14;
      return row;
    });
}

/** A flat reading surface; all marks use real spans, including overlapping notes. */
export function createBarPanel(
  root: HTMLElement,
  hover: (note: ViewNote | undefined, x: number, y: number) => void,
  close: () => void,
) {
  const panel = document.createElement('div');
  panel.className = 'coil-bar';
  panel.style.cssText =
    'position:absolute;inset:9% 4% 90px;padding:16px;border:1px solid;overflow:auto;display:none;box-shadow:0 12px 60px #0008';
  const title = document.createElement('button');
  title.style.cssText =
    'display:block;border:0;background:none;color:inherit;font:inherit;cursor:pointer;margin-bottom:12px';
  title.onclick = close;
  const score = document.createElement('canvas');
  score.style.cssText = 'display:block;width:100%;touch-action:none';
  panel.append(title);
  root.append(panel);
  let hits: { note: ViewNote; x: number; y: number; width: number; height: number }[] = [];
  const move = (event: PointerEvent) => {
    const rect = score.getBoundingClientRect();
    const x = event.clientX - rect.left,
      y = event.clientY - rect.top;
    const hit = hits.findLast(
      (h) => x >= h.x && x <= h.x + h.width && y >= h.y && y <= h.y + h.height,
    );
    const r = root.getBoundingClientRect();
    hover(hit?.note, event.clientX - r.left, event.clientY - r.top);
  };
  const leave = () => {
    hover(undefined, 0, 0);
  };
  score.addEventListener('pointermove', move);
  score.addEventListener('pointerleave', leave);
  score.onclick = close;
  return {
    draw(frame: ViewFrame, cycle: number | undefined, hovered?: ViewNote) {
      panel.style.display = cycle === undefined ? 'none' : 'block';
      if (cycle === undefined) {
        score.remove();
        return;
      }
      if (!score.isConnected) panel.append(score);
      const rows = barRows(frame, cycle);
      const length = frame.sections.at(-1)?.to ?? 16;
      const section = frame.sections
        .filter((s) => cycle % length >= s.from && cycle % length < s.to)
        .map((s) => s.name)
        .join(' · ');
      title.textContent = `Bar ${String(cycle + 1)} · ${section || 'score'} · click to fold / Esc`;
      panel.style.background = frame.theme.panel;
      panel.style.color = frame.theme.text;
      panel.style.borderColor = frame.theme.accent;
      panel.style.font = `13px "${frame.theme.fontMono}"`;
      const width = Math.max(1, panel.clientWidth - 32),
        height = Math.max(180, (rows.at(-1)?.y ?? 30) + (rows.at(-1)?.height ?? 0) + 4);
      score.style.height = `${String(height)}px`;
      score.width = Math.ceil(width * frame.dpr);
      score.height = Math.ceil(height * frame.dpr);
      const ctx = score.getContext('2d');
      if (!ctx) return;
      ctx.scale(frame.dpr, frame.dpr);
      ctx.font = `12px "${frame.theme.fontMono}"`;
      const left = Math.min(
        width * 0.28,
        Math.max(100, ...rows.map(({ part }) => ctx.measureText(part.name).width + 16)),
      );
      const span = width - left - 32;
      hits = [];
      for (let beat = 0; beat <= 4; beat++) {
        const x = left + (beat / 4) * span;
        ctx.strokeStyle = frame.theme.line;
        ctx.beginPath();
        ctx.moveTo(x, 22);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.fillStyle = frame.theme.muted;
        ctx.fillText(beat === 4 ? 'end' : String(beat + 1), x, 12);
      }
      rows.forEach(({ part, notes: rowNotes, lanes, y, laneHeight: h }) => {
        ctx.fillStyle = part.colour;
        ctx.fillText(part.name, 0, y + 20);
        rowNotes.forEach((note, index) => {
          const x = left + (Math.max(cycle, note.start) - cycle) * span;
          const w = (Math.min(cycle + 1, note.end) - Math.max(cycle, note.start)) * span;
          const top = y + lanes[index] * h;
          ctx.globalAlpha = part.muted ? 0.3 : 1;
          ctx.fillStyle = part.colour;
          ctx.fillRect(x, top, Math.max(0.5, w), h - 2);
          ctx.globalAlpha = 1;
          if (w > 28 && h > 12) {
            ctx.fillStyle = frame.theme.ground;
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, top, w, h);
            ctx.clip();
            ctx.fillText(noteLabel(note), x + 3, top + h - 5);
            ctx.restore();
          }
          if (note === hovered) {
            ctx.strokeStyle = frame.theme.text;
            ctx.lineWidth = 2;
            ctx.strokeRect(x, top, w, h - 2);
          }
          hits.push({ note, x, y: top, width: Math.max(1, w), height: h });
        });
      });
      if (frame.now >= cycle && frame.now < cycle + 1) {
        const x = left + (frame.now - cycle) * span;
        ctx.strokeStyle = frame.theme.text;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 18);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
    },
    dispose() {
      score.removeEventListener('pointermove', move);
      score.removeEventListener('pointerleave', leave);
      panel.remove();
    },
  };
}
