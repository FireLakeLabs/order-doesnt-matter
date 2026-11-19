import type { ViewDefinition, ViewFrame, ViewNote } from './types';
import {
  capsules,
  displayNumber,
  indexRelay,
  relayFocus,
  relayLayout,
  relayRange,
  shapeHue,
  transposeText,
  type Relay,
} from './relay/model';
import { clamp } from './shared/math';
import { line as stroke } from './shared/retro-2d';

function fit(c: CanvasRenderingContext2D, value: string, width: number) {
  if (c.measureText(value).width <= width) return value;
  let text = value;
  while (text && c.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return text ? `${text}…` : '';
}
function draw(c: CanvasRenderingContext2D, f: ViewFrame, score: Relay) {
  const { theme: t, width: w, height: h, now } = f;
  const parts = [...f.instruments].sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
  const box = relayLayout(w, h, parts.length);
  const { left, right, top, bottom, lane } = box;
  const x = (time: number) =>
    left + ((time - score.from) / (score.to - score.from)) * (right - left);
  const y = (id: string) => top + (parts.findIndex((p) => p.id === id) + 0.5) * lane;
  const focus = relayFocus(score, now);
  const matched = new Set(score.returns.flatMap((r) => [r.before, r.after]));
  const baton = new Set(
    score.phrases
      .filter((p) => matched.has(p.id) && x(p.to) - x(p.from) >= 24 && lane >= 14)
      .map((p) => p.id),
  );
  const colour = (shape: string) =>
    t.name === 'pocket'
      ? t.text
      : `hsl(${String(shapeHue(shape))} 78% ${t.name === 'riso' ? '40%' : '66%'})`;
  c.fillStyle = t.ground;
  c.fillRect(0, 0, w, h);
  c.fillStyle = t.panel;
  c.beginPath();
  c.roundRect(left - 20, top - 8, right - left + 40, bottom - top + 16, 20);
  c.fill();
  c.strokeStyle = t.muted;
  c.lineWidth = 1;
  c.stroke();
  const unknown = [
    [score.from, Math.min(score.to, f.from)],
    [Math.max(score.from, f.to), score.to],
  ].filter(([a, b]) => b > a);
  for (const [a, b] of unknown) {
    c.save();
    c.beginPath();
    c.rect(x(a), top, x(b) - x(a), bottom - top);
    c.clip();
    c.strokeStyle = t.muted;
    c.globalAlpha = 0.3;
    for (let dx = x(a) - (bottom - top); dx < x(b); dx += 12)
      stroke(c, dx, bottom, dx + bottom - top, top);
    c.restore();
  }
  // Lane boundaries and starting blocks make the score a running track.
  for (let i = 0; i <= parts.length; i++) {
    c.globalAlpha = 0.42;
    stroke(c, left - 10, top + i * lane, right + 10, top + i * lane);
  }
  parts.forEach((p, i) => {
    c.globalAlpha = 0.5;
    c.strokeStyle = t.muted;
    stroke(c, left - 12, y(p.id) - lane * 0.2, left - 5, y(p.id) - lane * 0.2);
    stroke(c, left - 12, y(p.id) + lane * 0.2, left - 5, y(p.id) + lane * 0.2);
    for (let j = 0; j < 4; j++) {
      c.fillStyle = (i + j) % 2 ? t.text : t.ground;
      c.fillRect(
        right + 3 + (j % 2) * 4,
        top + i * lane + (Math.floor(j / 2) * lane) / 2,
        4,
        lane / 2,
      );
    }
  });
  c.globalAlpha = 1;
  // Two representative handoffs stand for the current bundle. Every related
  // baton lights; the ledger retains the full edge count instead of spaghetti.
  const drawable = focus.links.filter((r) => baton.has(r.before) && baton.has(r.after));
  const cross = drawable.find(
    (r) => score.phrases[r.before].instrument !== score.phrases[r.after].instrument,
  );
  const other =
    drawable.find((r) => r !== cross && r.kind === 'near') ??
    drawable.find(
      (r) =>
        r !== cross && score.phrases[r.before].instrument === score.phrases[r.after].instrument,
    ) ??
    drawable.find((r) => r !== cross);
  const arcs = [cross, other].filter((r): r is NonNullable<typeof r> => !!r);
  const arcLabels: { text: string; x: number; y: number }[] = [];
  for (const r of arcs) {
    const a = score.phrases[r.before],
      b = score.phrases[r.after];
    if (!a.shape) continue;
    const ax = x((a.from + a.to) / 2),
      bx = x((b.from + b.to) / 2);
    const ay = y(a.instrument),
      by = y(b.instrument);
    c.globalAlpha = 0.65;
    c.strokeStyle = colour(a.shape);
    c.lineWidth = 1.5;
    c.setLineDash(r.kind === 'near' ? [4, 4] : []);
    c.beginPath();
    c.moveTo(ax, ay);
    const lift = Math.min(lane * 0.85, 12 + Math.abs(bx - ax) * 0.06);
    if (ax === bx) c.bezierCurveTo(ax - 24, ay, bx - 24, by, bx, by);
    else c.bezierCurveTo(ax, ay - lift, bx, by - lift, bx, by);
    c.stroke();
    arcLabels.push({
      text: String(arcs.indexOf(r) + 1),
      x: (ax + bx) / 2 - (ax === bx ? 20 : 0),
      y: Math.max(top + 12, Math.min(ay, by) - lift * 0.65),
    });
  }
  c.setLineDash([]);
  c.globalAlpha = 1;
  const capsuleTexts: { text: string; x: number; y: number; width: number }[] = [];
  for (const p of score.phrases) {
    if (!baton.has(p.id) || !p.shape) continue;
    const px = x(p.from) + 3,
      py = y(p.instrument),
      bw = x(p.to) - x(p.from) - 6;
    const lit = focus.related.has(p.id);
    c.globalAlpha = lit ? 1 : 0.42;
    c.fillStyle = t.ground;
    c.strokeStyle = lit ? t.text : t.muted;
    c.lineWidth = lit ? 1.5 : 0.7;
    c.beginPath();
    c.roundRect(px, py - lane * 0.26, bw, lane * 0.52, 6);
    c.fill();
    c.stroke();
    c.strokeStyle = colour(p.shape);
    c.lineWidth = Math.max(2, Math.min(4, lane * 0.09));
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.beginPath();
    const low = Math.min(...p.pitches),
      high = Math.max(...p.pitches);
    p.notes
      .filter((n) => n.hasOnset)
      .forEach((n, i) => {
        const nx = clamp((n.start - p.from) / (p.to - p.from));
        const ny = py + (0.5 - (p.pitches[i] - low) / Math.max(1, high - low)) * lane * 0.3;
        if (!i) c.moveTo(px + 5 + nx * (bw - 10), ny);
        else c.lineTo(px + 5 + nx * (bw - 10), ny);
        c.lineTo(px + 5 + clamp((n.end - p.from) / (p.to - p.from)) * (bw - 10), ny);
      });
    c.stroke();
    c.globalAlpha = 1;
  }
  for (const part of parts) {
    const loose = score.phrases.filter((p) => p.instrument === part.id && !baton.has(p.id));
    for (const cap of capsules(loose, score.from, score.to, right - left)) {
      const width = x(cap.to) - x(cap.from),
        inset = Math.min(2, width / 4),
        px = x(cap.from) + inset,
        bw = width - 2 * inset,
        py = y(part.id);
      c.fillStyle = t.ground;
      c.strokeStyle = cap.notes.some((n) => n.start <= now && now < n.end) ? t.text : part.colour;
      c.lineWidth = 1;
      c.beginPath();
      c.roundRect(px, py - Math.min(8, lane * 0.3), bw, Math.min(16, lane * 0.6), 6);
      c.fill();
      c.stroke();
      capsuleTexts.push({ text: String(cap.count), x: px + bw / 2, y: py + 4, width: bw - 4 });
    }
  }
  // Runner gait and distance are functions of score time, including backwards seeks.
  const runnerX = x(Math.max(score.from, Math.min(score.to, now)));
  c.globalAlpha = 0.5;
  c.strokeStyle = t.text;
  c.lineWidth = 1;
  c.setLineDash([3, 5]);
  stroke(c, runnerX, top - 8, runnerX, bottom + 8);
  c.setLineDash([]);
  parts.forEach((p) => {
    const active = score.phrases.some((ph) => ph.instrument === p.id && focus.current.has(ph.id));
    const py = y(p.id),
      size = Math.min(13, lane * 0.58);
    const stride = Math.sin(now * Math.PI * 8) * size * 0.4;
    c.globalAlpha = p.muted ? 0.3 : active ? 1 : 0.4;
    c.strokeStyle = t.text;
    c.fillStyle = t.text;
    c.lineWidth = Math.max(1, size * 0.14);
    c.lineCap = 'round';
    c.beginPath();
    c.arc(runnerX, py - size * 0.6, size * 0.17, 0, Math.PI * 2);
    c.fill();
    stroke(c, runnerX, py - size * 0.35, runnerX - 2, py + size * 0.15);
    stroke(c, runnerX - 2, py + size * 0.15, runnerX - stride - 3, py + size * 0.65);
    stroke(c, runnerX - 2, py + size * 0.15, runnerX + stride + 3, py + size * 0.6);
    stroke(c, runnerX, py - size * 0.2, runnerX + size * 0.45, py - size * 0.35);
    const carrying = score.phrases.find(
      (ph) => ph.instrument === p.id && focus.current.has(ph.id) && ph.shape,
    );
    c.strokeStyle = carrying?.shape ? colour(carrying.shape) : p.colour;
    c.lineWidth = 3;
    stroke(c, runnerX + size * 0.45, py - size * 0.35, runnerX + size * 0.6, py - size * 0.6);
  });
  c.globalAlpha = 1;
  // Text is last, on opaque plates: no runner or arc can cross a number.
  c.font = `11px "${t.fontMono}"`;
  c.textAlign = 'center';
  for (const label of capsuleTexts) {
    if (c.measureText(label.text).width > label.width || lane < 16) continue;
    const tw = c.measureText(label.text).width;
    c.fillStyle = t.ground;
    c.fillRect(label.x - tw / 2 - 1, label.y - 10, tw + 2, 12);
    c.fillStyle = t.text;
    c.fillText(label.text, label.x, label.y);
  }
  const placed: typeof arcLabels = [];
  for (const label of arcLabels) {
    // Number tags live above lane centres; if a capsule occupies the tag's
    // box, the matching numbered ledger entry alone labels the handoff.
    if (
      capsuleTexts.some(
        (p) => Math.abs(p.y - label.y) < 14 && Math.abs(p.x - label.x) < p.width / 2 + 10,
      )
    )
      continue;
    if (placed.some((p) => Math.abs(p.x - label.x) < 16 && Math.abs(p.y - label.y) < 16)) continue;
    placed.push(label);
    c.fillStyle = t.ground;
    c.fillRect(label.x - 7, label.y - 10, 14, 14);
    c.fillStyle = t.text;
    c.fillText(label.text, label.x, label.y + 1);
  }
  c.textAlign = 'left';
  c.fillStyle = t.text;
  c.font = `22px "${t.fontDisplay}"`;
  c.fillText('Relay', 20, 30);
  c.font = `11px "${t.fontMono}"`;
  const records = f.notes.filter((n) => n.start < score.to && n.end > score.from);
  const batonRecords = score.phrases
    .filter((p) => baton.has(p.id))
    .reduce((sum, p) => sum + p.notes.length, 0);
  c.fillText(
    fit(
      c,
      unknown.length
        ? `NOT ASKED IN FULL · ${String(records.length)} RECORDS`
        : `${String(parts.length)} LANES · ${String(records.length)} RECORDS · ${String(score.returns.length)} RETURNS`,
      w - 40,
    ),
    20,
    51,
  );
  let sectionEnd = -Infinity;
  for (const section of score.sections) {
    const px = x(section.from),
      bw = x(section.to) - px;
    c.fillStyle = t.panel;
    c.fillRect(px, 66, bw - 2, 20);
    c.fillStyle = t.text;
    const name = fit(c, section.name, bw - 8);
    if (name && px > sectionEnd) {
      c.fillText(name, px + 4, 80);
      sectionEnd = px + c.measureText(name).width + 8;
    }
  }
  for (
    let bar = 0;
    bar < score.to - score.from;
    bar += Math.max(1, Math.ceil(((score.to - score.from) * 34) / (right - left)))
  ) {
    c.fillStyle = t.text;
    c.fillText(String((f.sections.length ? 0 : score.from) + bar + 1), x(score.from + bar), 102);
  }
  parts.forEach((p, i) => {
    if (lane < 15 && i % Math.ceil(15 / lane)) return;
    c.fillStyle = t.text;
    c.fillText(fit(c, `${String(i + 1)} ${p.name}`, left - 38), 12, y(p.id) + 4);
  });
  const foot = bottom + 28;
  c.fillStyle = t.ground;
  c.fillRect(0, foot - 8, w, h - foot + 8);
  c.fillStyle = t.text;
  const batonAttacks = score.phrases
    .filter((p) => baton.has(p.id))
    .reduce((sum, p) => sum + p.notes.filter((n) => n.hasOnset).length, 0);
  c.fillText(
    fit(
      c,
      `${String(baton.size)} batons (${String(batonAttacks)} notes, ${String(batonRecords)} records) · ${String(records.length - batonRecords)} capsule records`,
      w - 40,
    ),
    20,
    foot + 6,
  );
  arcs.forEach((r, i) => {
    const a = score.phrases[r.before],
      b = score.phrases[r.after];
    const name = (id: string) => parts.find((p) => p.id === id)?.name ?? id;
    const detail = `${String(i + 1)} ${r.kind} ${transposeText(r.transpose)} st${r.kind === 'near' ? ` · d ${displayNumber(r.distance)}` : ''} · ${name(a.instrument)} → ${name(b.instrument)}`;
    c.fillText(fit(c, detail, w - 40), 20, foot + 25 + i * 18);
  });
  if (!arcs.length)
    c.fillText(
      focus.links.length ? 'Current returns compacted to counts' : 'No current return established',
      20,
      foot + 25,
    );
  c.fillText(
    fit(
      c,
      `Solid exact · dashed near · ${String(focus.links.length)} current edges (${String(arcs.length)} shown)`,
      w - 40,
    ),
    20,
    foot + 63,
  );
  c.fillText(fit(c, 'Capsules count records, including control fragments', w - 40), 20, foot + 81);
}
const definition: ViewDefinition = {
  id: 'relay',
  name: 'Relay',
  group: 'song',
  tag: 'passed phrases',
  span: 'song',
  mount(element) {
    const canvas = document.createElement('canvas');
    const c = canvas.getContext('2d');
    if (!c) throw Error('Canvas 2D is unavailable');
    element.append(canvas);
    let notes: ViewNote[] | undefined;
    let structure = '';
    let coverage = '',
      range = '';
    let score: Relay | undefined;
    return {
      frame(f) {
        if (f.width <= 0 || f.height <= 0) return;
        const cw = Math.round(f.width * f.dpr),
          ch = Math.round(f.height * f.dpr);
        if (canvas.width !== cw || canvas.height !== ch) {
          canvas.width = cw;
          canvas.height = ch;
        }
        canvas.style.width = `${String(f.width)}px`;
        canvas.style.height = `${String(f.height)}px`;
        c.reset();
        c.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
        const nextRange = String(relayRange(f));
        const nextStructure = JSON.stringify([
          f.sections,
          f.instruments.map((p) => [p.id, p.index]),
        ]);
        const nextCoverage = `${String(f.from)},${String(f.to)}`;
        if (
          notes !== f.notes ||
          structure !== nextStructure ||
          coverage !== nextCoverage ||
          range !== nextRange
        ) {
          score = indexRelay(f);
          notes = f.notes;
          structure = nextStructure;
          coverage = nextCoverage;
          range = nextRange;
        }
        if (score) draw(c, f, score);
      },
      dispose() {
        canvas.remove();
        canvas.width = 0;
        canvas.height = 0;
        score = undefined;
        notes = undefined;
        structure = '';
      },
    };
  },
};
export default definition;
