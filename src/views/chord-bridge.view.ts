import type { ViewDefinition, ViewFrame } from './types';
import { analyse, blocks, layout, nearest, pitchLabel, stateAt } from './chord-bridge/model';
import type { Bridge } from './chord-bridge/model';
import { clamp } from './shared/math';

function draw(ctx: CanvasRenderingContext2D, frame: ViewFrame, bridge: Bridge) {
  const { width, height, theme, now } = frame;
  const state = stateAt(bridge, frame);
  const box = layout(width, height, state);
  const { left, right, top, bottom, x, y } = box;
  const narrow = width < 700;
  const sideX = right + 22;
  const part = (id?: string) => frame.instruments.find((i) => i.id === id);
  const chord = part(bridge.chord),
    melody = part(bridge.melody);
  const melodyEdges = state.melody.filter((t) => t.midi < 36 || t.midi > 96).length;
  const labels: {
    text: string;
    x: number;
    y: number;
    width: number;
    plate: boolean;
    border?: string;
  }[] = [];
  ctx.font = `11px "${theme.fontMono}"`;
  const text = (
    label: string,
    px: number,
    py: number,
    max: number,
    plate = false,
    border?: string,
  ) => {
    let shown = label;
    while (shown && ctx.measureText(shown).width > max)
      shown = shown.length > 2 ? `${shown.slice(0, -2)}…` : '';
    const length = ctx.measureText(shown).width;
    if (!shown) return false;
    if (
      labels.some((l) => Math.abs(l.y - py) < 17 && px < l.x + l.width + 6 && px + length + 6 > l.x)
    )
      return false;
    labels.push({ text: shown, x: px, y: py, width: length, plate, border });
    return true;
  };
  const line = (a: number, b: number, c: number, d: number) => {
    ctx.beginPath();
    ctx.moveTo(a, b);
    ctx.lineTo(c, d);
    ctx.stroke();
  };
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = theme.panel;
  ctx.fillRect(sideX - 8, 78, width - sideX - 8, height - 94);
  text(
    `bar ${String(Math.floor(now) + 1)} · ${String(Math.round((now % 1) * 100))}%`,
    width - 166,
    29,
    150,
  );
  text(
    narrow ? 'INFERRED · NEAREST PITCH' : 'INFERRED LINKS · NEAREST NEXT PITCH · NOT NAMED VOICES',
    20,
    55,
    width - 40,
  );
  const total = state.piers.reduce((sum, p) => sum + p.tones.length, 0);
  const links = state.piers.slice(1).flatMap((p, i) => nearest(state.piers[i], p));
  text(
    `${String(state.piers.length)} piers · ${String(total)} pitches · C1–C6`,
    left,
    190,
    right - left,
    true,
  );
  text('OTHER NOTES', sideX, 99, box.side - 18);
  text(`${String(state.others.length)} in window`, sideX, 119, box.side - 18);
  text('now / window', sideX, 139, box.side - 18);
  const rows = frame.instruments.filter((i) => state.counts.has(i.id));
  const capacity = Math.max(1, Math.floor((height - 226) / 42));
  const shown = rows.slice(0, capacity);
  for (const [i, instrument] of shown.entries()) {
    const count = state.counts.get(instrument.id);
    if (!count) continue;
    const rowY = 171 + i * 42;
    ctx.fillStyle = instrument.colour;
    ctx.fillRect(sideX, rowY - 9, 3, 28);
    text(instrument.name + (instrument.muted ? ' · muted' : ''), sideX + 9, rowY, box.side - 30);
    text(`${String(count.active)} / ${String(count.total)}`, sideX + 9, rowY + 18, box.side - 30);
  }
  const omitted = rows.slice(capacity);
  if (omitted.length)
    text(
      `+${String(omitted.length)} parts ×${String(omitted.reduce((n, i) => n + (state.counts.get(i.id)?.total ?? 0), 0))}`,
      sideX,
      height - 39,
      box.side - 18,
    );
  else
    text(
      `${String(frame.instruments.filter((i) => !bridge.notes.some((n) => n.instrument === i.id && n.start <= now && now < n.end)).length)} parts resting`,
      sideX,
      height - 39,
      box.side - 18,
    );
  text(
    `Chord: ${chord?.name ?? 'no chordal part in score window'}${chord?.muted ? ' · muted' : ''}`,
    left,
    78,
    right - left,
  );
  text(
    `Melody: ${melody?.name ?? 'none'} · ${String(state.melody.filter((t) => t.note.start <= now && now < t.note.end).length)}/${String(state.melody.length)} now/window${melodyEdges ? ` · ${String(melodyEdges)} edge` : ''}`,
    left,
    100,
    right - left,
  );

  // Geometry is confined to the score area; text is painted last on opaque plates.
  ctx.save();
  ctx.beginPath();
  ctx.rect(left - 28, 109, right - left + 48, bottom - 85);
  ctx.clip();
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1;
  line(left - 20, bottom + 17, right + 18, bottom + 17);
  for (let midi = 24; midi <= 84; midi += 12) {
    ctx.setLineDash([2, 7]);
    line(left - 20, y(midi), right + 18, y(midi));
  }
  ctx.setLineDash([]);
  // Spans use exact MIDI heights, including when the attached label band is counted.
  for (const [i, pier] of state.piers.entries()) {
    const next = state.piers.at(i + 1);
    if (!next) continue;
    for (const link of nearest(pier, next)) {
      ctx.strokeStyle = chord?.colour ?? theme.accent;
      ctx.lineWidth = link.delta === 0 ? 2.5 : 1.5;
      ctx.setLineDash(link.tie ? [4, 4] : []);
      line(x(pier.start), y(link.from), x(next.start), y(link.to));
    }
  }
  ctx.setLineDash([]);
  for (const pier of state.piers) {
    const px = x(pier.start);
    const active = pier.tones.some((t) => t.note.start <= now && now < t.note.end);
    const highest = Math.min(...pier.tones.map((t) => y(t.midi)));
    ctx.fillStyle = theme.panel;
    ctx.strokeStyle = active ? theme.text : theme.line;
    ctx.lineWidth = active ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(px - 10, bottom + 17);
    ctx.lineTo(px - 10, highest - 13);
    ctx.lineTo(px + 10, highest - 13);
    ctx.lineTo(px + 10, bottom + 17);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // The arch and masonry make each scored onset read as a bridge pier.
    ctx.fillStyle = theme.ground;
    ctx.beginPath();
    ctx.arc(px, bottom + 17, 6, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = theme.line;
    for (let py = highest + 16; py < bottom; py += 24) line(px - 9, py, px + 9, py);
    ctx.fillStyle = chord?.colour ?? theme.accent;
    for (const tone of pier.tones) ctx.fillRect(px - 21, y(tone.midi) - 3, 42, 6);
  }
  const melodyY = (midi: number) => 163 - clamp((midi - 36) / 60) * 43;
  ctx.strokeStyle = melody?.colour ?? theme.text;
  ctx.lineWidth = 1.5;
  const melodic = state.melody
    .slice()
    .sort((a, b) => a.note.start - b.note.start || a.midi - b.midi);
  ctx.setLineDash([3, 4]);
  for (let i = 1; i < melodic.length; i++)
    line(
      x(melodic[i - 1].note.start),
      melodyY(melodic[i - 1].midi),
      x(melodic[i].note.start),
      melodyY(melodic[i].midi),
    );
  ctx.setLineDash([]);
  ctx.fillStyle = melody?.colour ?? theme.text;
  for (const tone of melodic) {
    ctx.beginPath();
    ctx.arc(x(tone.note.start), melodyY(tone.midi), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Playhead moves in time independently of the discrete scored piers.
  ctx.strokeStyle = theme.text;
  ctx.setLineDash([2, 5]);
  line(x(now), 111, x(now), bottom + 20);
  ctx.restore();

  let folded = 0;
  for (const pier of state.piers) {
    const px = x(pier.start);
    if (px < left - 10 || px > right + 10) {
      folded += pier.tones.length;
      continue;
    }
    for (const block of blocks(pier.tones, box)) {
      if (!text(block.label, px - 23, block.y + 4, 70, true, chord?.colour ?? theme.accent))
        folded += block.tones.length;
    }
    const active = pier.tones.some((t) => t.note.start <= now && now < t.note.end);
    text(
      `${pier.carried ? 'held' : 'bar'} ${String(Number((pier.start + 1).toFixed(3)))}`,
      px - 20,
      bottom + 43,
      75,
      true,
    );
    if (active) text('current', px - 20, bottom + 62, 70, true);
  }
  for (const [i, pier] of state.piers.entries()) {
    const next = state.piers.at(i + 1);
    if (!next || x(next.start) - x(pier.start) < 85) continue;
    for (const link of nearest(pier, next)) {
      const delta = Number(link.delta.toFixed(2));
      text(
        `${delta > 0 ? '+' : ''}${String(delta)} st${link.tie ? ' tie' : ''}`,
        (x(pier.start) + x(next.start)) / 2 - 24,
        (y(link.from) + y(link.to)) / 2 - 7,
        100,
        true,
      );
    }
  }
  for (const tone of melodic)
    if (x(tone.note.start) >= left && x(tone.note.start) < right - 36)
      text(pitchLabel(tone.midi), x(tone.note.start) - 8, melodyY(tone.midi) - 9, 45, true);
  text(
    `${String(links.length)} links · ${String(links.filter((l) => l.tie).length)} tied choices${folded ? ` · ${String(folded)} pitches in totals` : ''}`,
    20,
    height - 17,
    right - 20,
  );
  if (state.from < frame.from || state.to > frame.to)
    text('Score window not fully asked', left + 8, top + 40, right - left, true);
  else if (!state.piers.length) text('No chord piers here', left + 8, top + 40, right - left, true);
  // Every text uses theme.text on theme.ground or theme.panel, never a part colour.
  ctx.font = `11px "${theme.fontMono}"`;
  for (const label of labels) {
    if (label.plate) {
      ctx.fillStyle = theme.panel;
      ctx.fillRect(label.x - 3, label.y - 13, label.width + 6, 18);
      if (label.border) {
        ctx.strokeStyle = label.border;
        ctx.lineWidth = 1;
        ctx.strokeRect(label.x - 3, label.y - 13, label.width + 6, 18);
      }
    }
    ctx.fillStyle = theme.text;
    ctx.fillText(label.text, label.x, label.y);
  }
  ctx.fillStyle = theme.text;
  ctx.font = `22px "${theme.fontDisplay}"`;
  ctx.fillText('Chord bridge', 20, 31);
}

const view: ViewDefinition = {
  id: 'chord-bridge',
  name: 'Chord bridge',
  group: 'pitch',
  tag: 'voice leading',
  needs: 'score',
  span: 'window',
  mount(element) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw Error('Canvas 2D is unavailable');
    element.append(canvas);
    let source: ViewFrame['notes'] | undefined;
    let bridge: Bridge | undefined;
    return {
      frame(frame) {
        if (frame.width <= 0 || frame.height <= 0) return;
        const w = Math.max(1, Math.round(frame.width * frame.dpr));
        const h = Math.max(1, Math.round(frame.height * frame.dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        canvas.style.width = `${String(frame.width)}px`;
        canvas.style.height = `${String(frame.height)}px`;
        ctx.reset();
        ctx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
        if (source !== frame.notes) {
          source = frame.notes;
          bridge = analyse(source);
        }
        if (bridge) draw(ctx, frame, bridge);
      },
      dispose() {
        canvas.remove();
        canvas.width = canvas.height = 0;
        source = undefined;
        bridge = undefined;
      },
    };
  },
};
export default view;
