import type { ViewDefinition, ViewFrame, ViewNote } from '../types';

export const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
export function pitch(value: ViewNote['value']): number | undefined {
  const raw = value.note ?? value.n;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    if (raw.trim() && Number.isFinite(Number(raw))) return Number(raw);
    const m = /^([a-g])([#b]?)(-?\d+)?$/i.exec(raw.trim());
    if (m) {
      const key = 'c d ef g a b'.indexOf(m[1].toLowerCase());
      return (Number(m[3] || 3) + 1) * 12 + key + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    }
  }
  const freq = Number(value.freq);
  return freq > 0 && Number.isFinite(freq) ? 69 + 12 * Math.log2(freq / 440) : undefined;
}
export const pitchName = (p: number) =>
  `${['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'][((Math.round(p) % 12) + 12) % 12]}${String(Math.floor(Math.round(p) / 12) - 1)}`;
export interface Event {
  note: ViewNote;
  pitch: number | undefined;
}
export function indexScore(notes: ViewNote[]) {
  const groups = new Map<string, Event[]>();
  for (const note of notes) {
    let group = groups.get(note.instrument);
    if (!group) groups.set(note.instrument, (group = []));
    group.push({ note, pitch: pitch(note.value) });
  }
  return groups;
}
export type Score = ReturnType<typeof indexScore>;
export function flash(note: ViewNote, frame: Pick<ViewFrame, 'now' | 'cps'>) {
  return note.hasOnset && frame.now >= note.start
    ? clamp(1 - (frame.now - note.start) / (Math.max(frame.cps, 0.001) * 0.18))
    : 0;
}
export function energy(events: Event[], frame: ViewFrame) {
  let result = 0;
  for (const { note } of events) result = Math.max(result, flash(note, frame));
  return result;
}
export const quiet = (instrument: ViewFrame['instruments'][number]) =>
  instrument.muted ? 0.2 : instrument.inSection ? 1 : 0.3;
export function line(c: CanvasRenderingContext2D, x: number, y: number, x2: number, y2: number) {
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x2, y2);
  c.stroke();
}
export function timeline(frame: ViewFrame, left: number, right: number) {
  const span = Math.max(0.001, frame.lookAhead);
  const from = frame.now - span / 3;
  const scale = (right - left) / span;
  return {
    from,
    to: from + span,
    gate: left + (right - left) / 3,
    x: (t: number) => left + (t - from) * scale,
  };
}
export function ruler(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  left: number,
  right: number,
  top: number,
  bottom: number,
) {
  const t = timeline(f, left, right);
  c.font = `11px "${f.theme.fontMono}"`;
  c.textAlign = 'left';
  for (let cycle = Math.ceil(t.from); cycle <= t.to; cycle++) {
    const x = t.x(cycle);
    c.globalAlpha = 0.3;
    c.strokeStyle = f.theme.muted;
    line(c, x, top, x, bottom);
    c.globalAlpha = 0.8;
    c.fillStyle = f.theme.muted;
    c.fillText(String(cycle + 1).padStart(2, '0'), x + 5, top - 10);
  }
  const length = f.sections.at(-1)?.to ?? 0;
  if (length > 0)
    for (let loop = Math.floor(t.from / length); loop <= Math.floor(t.to / length); loop++)
      for (const section of f.sections) {
        const time = section.from + loop * length;
        if (time < t.from || time > t.to) continue;
        const x = t.x(time);
        c.globalAlpha = 0.8;
        c.strokeStyle = f.theme.accent;
        line(c, x, top, x, bottom);
        c.fillStyle = f.theme.accent;
        c.fillText(section.name, x + 5, top - 26, Math.max(1, right - x - 5));
      }
  c.globalAlpha = 1;
}
export function gate(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  x: number,
  top: number,
  bottom: number,
) {
  c.globalAlpha = 1;
  c.strokeStyle = f.theme.text;
  c.lineWidth = 2;
  c.shadowColor = f.theme.accent;
  c.shadowBlur = f.theme.glow ? 12 : 0;
  line(c, x, top, x, bottom);
  c.shadowBlur = 0;
  c.lineWidth = 1;
  c.fillStyle = f.theme.accent;
  c.beginPath();
  c.moveTo(x - 5, top - 5);
  c.lineTo(x + 5, top - 5);
  c.lineTo(x, top + 3);
  c.fill();
}
/** Only memoizes score analysis; every visible state is a function of this frame. */
export function mount2d<T>(
  element: HTMLElement,
  analyse: (notes: ViewNote[]) => T,
  draw: (c: CanvasRenderingContext2D, f: ViewFrame, data: T) => void,
): ReturnType<ViewDefinition['mount']> {
  const canvas = document.createElement('canvas');
  const c = canvas.getContext('2d');
  if (!c) throw Error('Canvas 2D is unavailable');
  element.append(canvas);
  let source: ViewNote[] | undefined;
  let data: T | undefined;
  return {
    frame(f) {
      const w = Math.round(f.width * f.dpr),
        h = Math.round(f.height * f.dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      canvas.style.width = `${String(f.width)}px`;
      canvas.style.height = `${String(f.height)}px`;
      c.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
      c.globalAlpha = 1;
      c.shadowBlur = 0;
      c.lineWidth = 1;
      c.fillStyle = f.theme.ground;
      c.fillRect(0, 0, f.width, f.height);
      if (source !== f.notes) {
        source = f.notes;
        data = analyse(source);
      }
      if (data !== undefined && f.width > 0 && f.height > 0) draw(c, f, data);
    },
    dispose() {
      canvas.remove();
      canvas.width = 0;
      canvas.height = 0;
      source = undefined;
      data = undefined;
    },
  };
}
