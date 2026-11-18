import type { ViewDefinition, ViewFrame } from './types';
import { analyse, nearest, stateAt } from './chord-bridge/model';
import type { Bridge } from './chord-bridge/model';
import {
  bridgeLayout,
  girderEnds,
  intersects,
  presentation,
  spell,
  stoneBlocks,
} from './chord-bridge/drawing';
import type { Rect } from './chord-bridge/drawing';

function draw(
  ctx: CanvasRenderingContext2D,
  frame: ViewFrame,
  bridge: Bridge,
  score: ReturnType<typeof presentation>,
) {
  const { width, height, theme, now } = frame;
  const state = stateAt(bridge, frame);
  const box = bridgeLayout(width, height, state, score);
  const { left, right, top, ground, x, y, melodyY, blockWidth } = box;
  const sideX = right + 20;
  const part = (id?: string) => frame.instruments.find((i) => i.id === id);
  const chord = part(bridge.chord),
    melody = part(bridge.melody);
  const colour = chord?.colour ?? theme.accent;
  const stones = state.piers.flatMap((pier) => stoneBlocks(pier, box));
  const labels: (Rect & { text: string; size: number; plate: boolean })[] = [];
  const label = (
    text: string,
    px: number,
    py: number,
    max: number,
    size = 11,
    plate = true,
    own?: Rect,
  ) => {
    ctx.font = `${String(size)}px "${theme.fontMono}"`;
    let shown = text;
    while (shown && ctx.measureText(shown).width > max)
      shown = shown.length > 2 ? `${shown.slice(0, -2)}…` : '';
    if (!shown) return false;
    const rect = { x: px, y: py - size, w: ctx.measureText(shown).width, h: size + 4 };
    if (
      labels.some((l) => intersects(rect, l, 5)) ||
      stones.some((s) => s !== own && intersects(rect, s, 7))
    )
      return false;
    labels.push({ ...rect, text: shown, size, plate });
    return true;
  };
  const line = (ax: number, ay: number, bx: number, by: number) => {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  };
  const polygon = (points: number[][]) => {
    ctx.beginPath();
    points.forEach(([px, py], i) => {
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
  };
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, 0, width, height);
  // Water, embankments and a full-width deck give the score a physical setting.
  ctx.fillStyle = theme.panel;
  ctx.fillRect(0, ground, right + 10, height - ground);
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let row = 0; row < 3; row++) {
    const py = ground + 12 + row * 12;
    for (let px = 5 - ((now * 12) % 44); px < right; px += 44) {
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + 10, py - 3, px + 23, py);
    }
  }
  ctx.stroke();
  ctx.fillStyle = theme.panel;
  ctx.fillRect(sideX - 4, 48, width - sideX - 12, height - 62);
  const total = state.piers.reduce((sum, p) => sum + p.tones.length, 0);
  const links = state.piers.slice(1).flatMap((p, i) => nearest(state.piers[i], p));
  const partial = state.from < frame.from || state.to > frame.to;
  label(
    `${String(state.piers.length)} piers · ${String(total)} pitches · ${String(links.length)} links · ${String(links.filter((l) => l.tie).length)} tied choices`,
    left,
    53,
    right - left,
    11,
  );
  label(
    partial
      ? 'Score window not fully asked'
      : `${chord?.name ?? 'No chordal part'}${chord?.muted ? ' · muted' : ''} · inferred nearest pitch`,
    left,
    74,
    right - left,
    11,
  );
  label(
    `bar ${String(Math.floor(now) + 1)} · ${String(Math.round((now % 1) * 100))}%`,
    width - 160,
    28,
    145,
    11,
  );
  const edges = state.melody.filter((t) => t.midi < 36 || t.midi > 96).length;
  label(
    `Melody: ${melody?.name ?? 'none'} · ${String(state.melody.filter((t) => t.note.start <= now && now < t.note.end).length)}/${String(state.melody.length)} now/window${edges ? ` · ${String(edges)} edge` : ''}`,
    left,
    164,
    right - left,
    11,
  );
  label('OTHER NOTES', sideX + 5, 68, box.side - 16);
  label(`${String(state.others.length)} in window`, sideX + 5, 88, box.side - 16);
  label('now / window', sideX + 5, 108, box.side - 16);
  const rows = frame.instruments.filter((i) => state.counts.has(i.id));
  const capacity = Math.max(1, Math.floor((height - 208) / 40));
  for (const [index, instrument] of rows.slice(0, capacity).entries()) {
    const count = state.counts.get(instrument.id);
    if (!count) continue;
    const py = 140 + index * 40;
    ctx.fillStyle = instrument.colour;
    ctx.fillRect(sideX + 5, py - 10, 3, 29);
    label(instrument.name + (instrument.muted ? ' · muted' : ''), sideX + 14, py, box.side - 26);
    label(`${String(count.active)} / ${String(count.total)}`, sideX + 14, py + 20, box.side - 26);
  }
  const omitted = rows.slice(capacity);
  label(
    omitted.length
      ? `+${String(omitted.length)} parts ×${String(omitted.reduce((n, i) => n + (state.counts.get(i.id)?.total ?? 0), 0))}`
      : `${String(frame.instruments.filter((i) => !bridge.notes.some((n) => n.instrument === i.id && n.start <= now && now < n.end)).length)} parts resting`,
    sideX + 5,
    height - 30,
    box.side - 16,
  );

  const melodic = state.melody
    .slice()
    .sort((a, b) => a.note.start - b.note.start || a.midi - b.midi);
  const deckAt = (time: number) => {
    const before = melodic.findLast((t) => t.note.start <= time);
    const after = melodic.find((t) => t.note.start > time);
    if (!before) return after ? melodyY(after.midi) : 126;
    if (!after) return melodyY(before.midi);
    const progress = (time - before.note.start) / (after.note.start - before.note.start);
    return melodyY(before.midi) + (melodyY(after.midi) - melodyY(before.midi)) * progress;
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 80, right + 10, height - 80);
  ctx.clip();
  // Light the scored current pier from its deck lamp down to its footing.
  for (const pier of state.piers) {
    if (!pier.tones.some((t) => t.note.start <= now && now < t.note.end)) continue;
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = theme.accent;
    polygon([
      [x(pier.start) - 8, deckAt(pier.start)],
      [x(pier.start) + 8, deckAt(pier.start)],
      [x(pier.start) + blockWidth, ground],
      [x(pier.start) - blockWidth, ground],
    ]);
    ctx.globalAlpha = 1;
  }
  // Solid masonry piers with coursed stone, arched water openings and footings.
  for (const pier of state.piers) {
    const px = x(pier.start),
      width = blockWidth * 0.68;
    const cap = Math.min(...stoneBlocks(pier, box).map((s) => s.y)) - 10;
    const active = pier.tones.some((t) => t.note.start <= now && now < t.note.end);
    ctx.fillStyle = theme.panel;
    ctx.fillRect(px - width / 2, cap, width, ground - cap);
    ctx.strokeStyle = active ? theme.text : theme.line;
    ctx.lineWidth = active ? 2.5 : 1.5;
    ctx.strokeRect(px - width / 2, cap, width, ground - cap);
    ctx.beginPath();
    for (let row = 0, py = cap + 18; py < ground; row++, py += 18) {
      ctx.moveTo(px - width / 2, py);
      ctx.lineTo(px + width / 2, py);
      const seam = px + (row % 2 ? width / 4 : -width / 4);
      ctx.moveTo(seam, py - 18);
      ctx.lineTo(seam, py);
    }
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = theme.ground;
    ctx.beginPath();
    ctx.roundRect(px - width * 0.22, ground - 42, width * 0.44, 46, [
      width * 0.22,
      width * 0.22,
      0,
      0,
    ]);
    ctx.fill();
    ctx.fillStyle = theme.panel;
    ctx.fillRect(px - width / 2 - 8, ground - 6, width + 16, 10);
    ctx.strokeStyle = active ? theme.accent : theme.line;
    ctx.lineWidth = 2;
    ctx.strokeRect(px - width / 2 - 8, ground - 6, width + 16, 10);
    ctx.fillRect(px - width / 2 - 5, cap - 5, width + 10, 10);
    // Twin steel uprights support the melody walkway above the note blocks.
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 4;
    for (const dx of [-width * 0.32, width * 0.32])
      line(px + dx, deckAt(pier.start) + 5, px + dx, cap);
  }
  // Thick flanged girders, exact in semitones; ambiguous choices remain dashed.
  for (const [i, pier] of state.piers.entries()) {
    const next = state.piers.at(i + 1);
    if (!next) continue;
    const lit = pier.tones.some((t) => t.note.start <= now && now < t.note.end);
    for (const link of nearest(pier, next)) {
      const ends = girderEnds(x(pier.start), x(next.start), blockWidth);
      const ax = ends.from,
        bx = ends.to,
        ay = y(link.from),
        by = y(link.to);
      ctx.setLineDash(link.tie ? [10, 6] : []);
      ctx.strokeStyle = theme.line;
      ctx.lineWidth = 12;
      line(ax, ay, bx, by);
      ctx.strokeStyle = lit ? theme.accent : colour;
      ctx.lineWidth = 7;
      line(ax, ay, bx, by);
      ctx.strokeStyle = theme.panel;
      ctx.lineWidth = 1;
      line(ax, ay - 2, bx, by - 2);
    }
  }
  ctx.setLineDash([]);
  // Each counted block is a physical stone/steel cap with an opaque named face.
  for (const stone of stones) {
    const { x: sx, y: sy, w, h } = stone;
    ctx.fillStyle = colour;
    polygon([
      [sx, sy],
      [sx + 6, sy - 5],
      [sx + w + 6, sy - 5],
      [sx + w, sy],
    ]);
    ctx.fillStyle = theme.panel;
    ctx.fillRect(sx, sy, w, h);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.strokeRect(sx, sy, w, h);
    ctx.fillStyle = colour;
    for (const tone of stone.tones) ctx.fillRect(sx + w, y(tone.midi) - 3, 8, 6);
  }
  // The melody itself is the walkway, with a rail and lamps at real note starts.
  const deck = [
    [left - 10, deckAt(state.from)],
    ...melodic.map((t) => [x(t.note.start), melodyY(t.midi)]),
    [right + 8, deckAt(state.to)],
  ];
  const deckPath = (dy: number) => {
    ctx.beginPath();
    deck.forEach(([px, py], i) => {
      if (i) ctx.lineTo(px, py + dy);
      else ctx.moveTo(px, py + dy);
    });
    ctx.stroke();
  };
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 12;
  deckPath(4);
  ctx.strokeStyle = melody?.colour ?? theme.muted;
  ctx.lineWidth = 3;
  deckPath(0);
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1.5;
  deckPath(-8);
  for (const tone of melodic) {
    const px = x(tone.note.start),
      py = melodyY(tone.midi);
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 2;
    line(px, py + 6, px, py - 20);
    ctx.beginPath();
    ctx.arc(px, py - 20, 3.5, 0, Math.PI * 2);
    ctx.fillStyle =
      tone.note.start <= now && now < tone.note.end ? theme.accent : (melody?.colour ?? theme.text);
    ctx.fill();
  }
  ctx.strokeStyle = theme.text;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 5]);
  line(x(now), 82, x(now), ground + 5);
  ctx.setLineDash([]);
  ctx.restore();

  let folded = 0;
  for (const stone of stones) {
    const pitches = [...new Set(stone.tones.map((t) => t.midi))];
    let name = pitches.length === 1 ? spell(pitches[0], score.spelling) : '';
    if (stone.tones.length > 1)
      name = name ? `${name} ×${String(stone.tones.length)}` : `×${String(stone.tones.length)}`;
    ctx.font = `13px "${theme.fontMono}"`;
    if (ctx.measureText(name).width > stone.w - 10) name = `×${String(stone.tones.length)}`;
    const length = ctx.measureText(name).width;
    if (
      stone.x < left - 10 ||
      stone.x + stone.w > right + 10 ||
      !label(name, stone.x + (stone.w - length) / 2, stone.y + 19, stone.w - 8, 13, false, stone)
    )
      folded += stone.tones.length;
  }
  for (const pier of state.piers) {
    const px = x(pier.start);
    if (px < left || px > right) continue;
    label(`bar ${String(Number((pier.start + 1).toFixed(3)))}`, px - 25, ground + 23, 75);
  }
  // Only the lit pier's outgoing spans get midpoint tags; blocks and tags are reserved.
  for (const [i, pier] of state.piers.entries()) {
    const next = state.piers.at(i + 1);
    if (!next || !pier.tones.some((t) => t.note.start <= now && now < t.note.end)) continue;
    for (const link of nearest(pier, next)) {
      const delta = Number(link.delta.toFixed(2));
      const name = `${delta > 0 ? '+' : ''}${String(delta)} st${link.tie ? ' tie' : ''}`;
      ctx.font = `11px "${theme.fontMono}"`;
      const ends = girderEnds(x(pier.start), x(next.start), blockWidth);
      const tx = (ends.from + ends.to - ctx.measureText(name).width) / 2;
      const ty = (y(link.from) + y(link.to)) / 2 + 4;
      if (tx < left || tx + ctx.measureText(name).width > right) continue;
      for (const dy of [0, -20, 20, -40, 40]) if (label(name, tx, ty + dy, 100)) break;
    }
  }
  for (const tone of melodic) {
    const name = spell(tone.midi, score.spelling);
    ctx.font = `11px "${theme.fontMono}"`;
    const tx = x(tone.note.start) - ctx.measureText(name).width / 2;
    if (tx >= left && tx + ctx.measureText(name).width <= right)
      label(name, tx, melodyY(tone.midi) - 29, 50);
  }
  if (!state.piers.length)
    label(
      state.from < frame.from || state.to > frame.to
        ? 'Score window not fully asked'
        : 'No chord piers here',
      left + 10,
      top + 42,
      right - left - 20,
      13,
    );
  label(
    `↑ + · → 0 · ↓ − st · dashed = tie${folded ? ` · ${String(folded)} pitches in totals` : ''}`,
    left,
    height - 10,
    right - left,
    11,
  );
  // Text is last, on opaque theme-token surfaces; no beam can paint over it.
  for (const text of labels) {
    if (text.plate) {
      ctx.fillStyle = theme.panel;
      ctx.fillRect(text.x - 3, text.y - 2, text.w + 6, text.h + 4);
    }
    ctx.fillStyle = theme.text;
    ctx.font = `${String(text.size)}px "${theme.fontMono}"`;
    ctx.fillText(text.text, text.x, text.y + text.size);
  }
  ctx.fillStyle = theme.text;
  ctx.font = `22px "${theme.fontDisplay}"`;
  ctx.fillText('Chord bridge', 20, 29);
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
    let score: ReturnType<typeof presentation> | undefined;
    return {
      frame(frame) {
        if (frame.width <= 0 || frame.height <= 0) return;
        const w = Math.max(1, Math.round(frame.width * frame.dpr)),
          h = Math.max(1, Math.round(frame.height * frame.dpr));
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
          score = presentation(bridge);
        }
        if (bridge && score) draw(ctx, frame, bridge, score);
      },
      dispose() {
        canvas.remove();
        canvas.width = canvas.height = 0;
        source = undefined;
        bridge = undefined;
        score = undefined;
      },
    };
  },
};
export default view;
