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
/** Articulated legs, shoes, a vest and a hand-held baton; gait comes only from song time. */
function runner(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  x: number,
  feet: number,
  size: number,
  colour: string,
) {
  const { theme: t, now } = f;
  const stride = Math.sin(now * Math.PI * 4);
  const limb = (points: number[][], width: number, ink: string) => {
    c.beginPath();
    points.forEach(([px, py], i) => {
      if (i) c.lineTo(x + px * size, feet + py * size);
      else c.moveTo(x + px * size, feet + py * size);
    });
    c.strokeStyle = t.panel;
    c.lineWidth = width + 3;
    c.stroke();
    c.strokeStyle = ink;
    c.lineWidth = width;
    c.stroke();
  };
  c.lineCap = 'round';
  c.lineJoin = 'round';
  for (const side of [-1, 1]) {
    const reach = side * stride;
    const ankle = [reach * 0.28, -Math.max(0, -reach) * 0.18];
    limb([[-0.06, -0.4], [reach * 0.18 - 0.1, -0.22], ankle], size * 0.09, t.text);
    limb([ankle, [ankle[0] + 0.13, ankle[1]]], size * 0.11, colour);
  }
  limb(
    [
      [0.06, -0.73],
      [-0.23, -0.58],
      [-0.32, -0.73],
    ],
    size * 0.075,
    t.text,
  );
  c.fillStyle = colour;
  c.strokeStyle = t.text;
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(x - size * 0.01, feet - size * 0.76);
  c.lineTo(x + size * 0.19, feet - size * 0.71);
  c.lineTo(x + size * 0.04, feet - size * 0.4);
  c.lineTo(x - size * 0.15, feet - size * 0.43);
  c.closePath();
  c.fill();
  c.stroke();
  limb(
    [
      [0.12, -0.68],
      [0.3, -0.52],
      [0.43, -0.7],
    ],
    size * 0.075,
    t.text,
  );
  limb(
    [
      [0.41, -0.79],
      [0.47, -0.61],
    ],
    size * 0.12,
    colour,
  );
  c.fillStyle = t.text;
  c.strokeStyle = t.panel;
  c.lineWidth = 2;
  c.beginPath();
  c.arc(x + size * 0.16, feet - size * 0.9, size * 0.11, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.strokeStyle = colour;
  c.lineWidth = size * 0.06;
  stroke(c, x + size * 0.07, feet - size * 0.95, x + size * 0.25, feet - size * 0.93);
}
function draw(c: CanvasRenderingContext2D, f: ViewFrame, score: Relay) {
  const { theme: t, width: w, height: h, now } = f;
  const parts = [...f.instruments].sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
  const box = relayLayout(w, h, parts.length);
  const { left, right } = box,
    top = 104,
    bottom = h - 100;
  const x = (time: number) =>
    left + ((time - score.from) / (score.to - score.from)) * (right - left);
  const focus = relayFocus(score, now);
  const matched = new Set(score.returns.flatMap((r) => [r.before, r.after]));
  const carriers = new Set(score.phrases.filter((p) => matched.has(p.id)).map((p) => p.instrument));
  // Reserve readable narrow lanes for the rest of the field; baton lanes take the remaining stage.
  const available = bottom - top;
  const quietHeight = carriers.size
    ? Math.max(
        Math.min(14, available / parts.length),
        available / (parts.length + carriers.size * 5),
      )
    : available / Math.max(1, parts.length);
  const heroHeight =
    (available - quietHeight * (parts.length - carriers.size)) / Math.max(1, carriers.size);
  let edge = top;
  const lanes = new Map(
    parts.map((p) => {
      const height = carriers.has(p.id) ? heroHeight : quietHeight;
      const lane = { top: edge, height, y: edge + height / 2 };
      edge += height;
      return [p.id, lane];
    }),
  );
  const laneAt = (id: string) => {
    const lane = lanes.get(id);
    if (!lane) throw Error('Relay lane is missing');
    return lane;
  };
  const y = (id: string) => laneAt(id).y + (carriers.has(id) ? laneAt(id).height * 0.25 : 0);
  // Keep the established compact-baton policy independent of the new lane weighting.
  const baton = new Set(
    score.phrases
      .filter((p) => matched.has(p.id) && x(p.to) - x(p.from) >= 24 && box.lane >= 14)
      .map((p) => p.id),
  );
  const colour = (shape: string) =>
    t.name === 'pocket'
      ? t.text
      : `hsl(${String(shapeHue(shape))} 78% ${t.name === 'riso' ? '40%' : '66%'})`;
  const batonHeight = (id: string) => Math.min(22, Math.max(12, laneAt(id).height * 0.24));
  c.fillStyle = t.ground;
  c.fillRect(0, 0, w, h);
  c.fillStyle = t.panel;
  c.strokeStyle = t.muted;
  c.lineWidth = 2;
  c.beginPath();
  c.roundRect(left - 28, top - 6, right - left + 56, bottom - top + 12, 28);
  c.fill();
  c.stroke();
  c.save();
  c.beginPath();
  c.roundRect(left - 26, top - 4, right - left + 52, bottom - top + 8, 26);
  c.clip();
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
  // Painted lane lines curve into the two ends; starting blocks and a checked finish sit on the surface.
  parts.forEach((p, i) => {
    const lane = laneAt(p.id);
    c.globalAlpha = 0.55;
    c.strokeStyle = t.text;
    c.lineWidth = carriers.has(p.id) ? 2 : 1;
    if (i) stroke(c, left - 24, lane.top, right + 24, lane.top);
    c.globalAlpha = 0.65;
    c.lineWidth = 3;
    stroke(c, left + 10, lane.y - 3, left + 14, lane.y - 3);
    stroke(c, left + 6, lane.y + 3, left + 10, lane.y + 3);
    for (let j = 0; j < 4; j++) {
      c.fillStyle = (i + j) % 2 ? t.text : t.ground;
      c.fillRect(
        right + 8 + (j % 2) * 6,
        lane.top + (Math.floor(j / 2) * lane.height) / 2,
        6,
        lane.height / 2,
      );
    }
  });
  // Unmatched records are quiet marks, owned by the same phrase-local bins as before.
  for (const part of parts) {
    const loose = score.phrases.filter((p) => p.instrument === part.id && !baton.has(p.id));
    c.globalAlpha = 0.22;
    c.strokeStyle = part.colour;
    c.lineWidth = 2;
    for (const cap of capsules(loose, score.from, score.to, right - left))
      for (const n of cap.notes) {
        const a = x(Math.max(cap.from, n.start)),
          b = Math.min(x(cap.to), a + (n.hasOnset ? 4 : 2));
        stroke(c, a, y(part.id), b, y(part.id));
      }
  }
  const drawable = score.returns.filter((r) => baton.has(r.before) && baton.has(r.after));
  const current = new Set(focus.links);
  const bundles = new Map<string, typeof drawable>();
  for (const r of drawable.filter((r) => current.has(r))) {
    const a = score.phrases[r.before],
      b = score.phrases[r.after];
    const key = JSON.stringify([a.instrument, b.instrument, r.kind, r.transpose, r.distance]);
    const group = bundles.get(key) ?? [];
    group.push(r);
    bundles.set(key, group);
  }
  const groups = [...bundles.values()];
  const sourceGroups = (id: string) =>
    groups.filter((g) => score.phrases[g[0].before].instrument === id);
  // All edges remain visible. Current parallel arcs share a rail and a single transposition tag.
  const arc = (r: (typeof drawable)[number], strong: boolean) => {
    const a = score.phrases[r.before],
      b = score.phrases[r.after];
    if (!a.shape) return;
    const ax = x((a.from + a.to) / 2),
      bx = x((b.from + b.to) / 2);
    const up = y(b.instrument) < y(a.instrument);
    const direction = up ? -1 : 1;
    const ay = y(a.instrument) - batonHeight(a.instrument) / 2,
      by = y(b.instrument) - (direction * batonHeight(b.instrument)) / 2;
    const own = sourceGroups(a.instrument),
      group = own.find((g) => g.includes(r));
    const slot = group ? own.indexOf(group) : 0;
    const lane = laneAt(a.instrument);
    const rawRail = lane.top + 8 + slot * Math.min(18, lane.height * 0.22);
    const rail = up ? Math.max(rawRail, by + 10) : Math.min(rawRail, ay - 10, by - 10);
    c.globalAlpha = strong ? 1 : 0.11;
    c.setLineDash(r.kind === 'near' ? [7, 5] : []);
    c.beginPath();
    c.moveTo(ax, ay);
    if (ax === bx) c.bezierCurveTo(ax - 34, rail, bx, rail, bx, by);
    else c.bezierCurveTo(ax, rail, bx, rail, bx, by);
    if (strong) {
      c.strokeStyle = t.panel;
      c.lineWidth = 7;
      c.stroke();
    }
    c.strokeStyle = colour(a.shape);
    c.lineWidth = strong ? 3 : 1;
    c.stroke();
    if (strong) {
      c.setLineDash([]);
      c.fillStyle = colour(a.shape);
      c.beginPath();
      c.moveTo(bx, by + direction);
      c.lineTo(bx - 4, by - direction * 6);
      c.lineTo(bx + 4, by - direction * 6);
      c.closePath();
      c.fill();
    }
  };
  drawable
    .filter((r) => !current.has(r))
    .forEach((r) => {
      arc(r, false);
    });
  drawable
    .filter((r) => current.has(r))
    .forEach((r) => {
      arc(r, true);
    });
  c.setLineDash([]);
  for (const p of score.phrases) {
    if (!baton.has(p.id) || !p.shape) continue;
    const px = x(p.from) + 3,
      py = y(p.instrument),
      bw = x(p.to) - x(p.from) - 6,
      bh = batonHeight(p.instrument);
    const lit = focus.related.has(p.id);
    c.globalAlpha = lit ? 1 : 0.4;
    c.fillStyle = colour(p.shape);
    c.strokeStyle = t.text;
    c.lineWidth = lit ? 2 : 1;
    c.beginPath();
    c.roundRect(px, py - bh / 2, bw, bh, bh / 2);
    c.fill();
    c.stroke();
    c.strokeStyle = t.ground;
    c.lineWidth = 2;
    c.lineJoin = 'round';
    c.beginPath();
    const low = Math.min(...p.pitches),
      high = Math.max(...p.pitches);
    p.notes
      .filter((n) => n.hasOnset)
      .forEach((n, i) => {
        const nx = clamp((n.start - p.from) / (p.to - p.from));
        const ny = py + (0.5 - (p.pitches[i] - low) / Math.max(1, high - low)) * bh * 0.55;
        if (!i) c.moveTo(px + 5 + nx * (bw - 10), ny);
        else c.lineTo(px + 5 + nx * (bw - 10), ny);
        c.lineTo(px + 5 + clamp((n.end - p.from) / (p.to - p.from)) * (bw - 10), ny);
      });
    c.stroke();
  }
  c.globalAlpha = 1;
  const runnerX = x(Math.max(score.from, Math.min(score.to, now)));
  c.strokeStyle = t.text;
  c.lineWidth = 1;
  c.globalAlpha = 0.2;
  c.setLineDash([3, 5]);
  stroke(c, runnerX, top, runnerX, bottom);
  c.setLineDash([]);
  c.globalAlpha = 1;
  for (const part of parts) {
    const carrying = score.phrases.find(
      (p) => p.instrument === part.id && focus.current.has(p.id) && matched.has(p.id),
    );
    if (carrying?.shape) {
      c.globalAlpha = part.muted ? 0.3 : 1;
      runner(
        c,
        f,
        runnerX,
        y(part.id) - 2,
        Math.min(68, laneAt(part.id).height * 0.82),
        colour(carrying.shape),
      );
    }
  }
  c.restore();
  // Every label is drawn last, outside motion or on an opaque plate.
  c.font = `11px "${t.fontMono}"`;
  parts.forEach((p, i) => {
    const lane = laneAt(p.id);
    if (lane.height < 14 && i % Math.ceil(14 / lane.height)) return;
    c.fillStyle = t.text;
    c.textAlign = 'left';
    c.fillText(fit(c, p.name, left - 56), 12, lane.y + 4);
    c.textAlign = 'center';
    c.fillStyle = t.panel;
    c.fillRect(left - 24, lane.y - 8, 20, 16);
    c.fillStyle = t.text;
    c.fillText(String(i + 1), left - 14, lane.y + 4);
  });
  const tags: { left: number; right: number; y: number }[] = [];
  for (const group of groups) {
    const r = group[0],
      a = score.phrases[r.before];
    const anchors = group
      .flatMap((edge) => [score.phrases[edge.before], score.phrases[edge.after]])
      .map((p) => x((p.from + p.to) / 2));
    const first = Math.min(...anchors),
      last = Math.max(...anchors);
    const text = fit(
      c,
      `${r.kind === 'near' ? 'near ' : ''}${transposeText(r.transpose)}${r.kind === 'near' ? ` d ${displayNumber(r.distance)}` : ''} ×${String(group.length)}`,
      Math.min(right - left - 24, Math.max(96, last - first)),
    );
    if (!text) continue;
    const tw = c.measureText(text).width,
      py = laneAt(a.instrument).top + 14;
    // Anchor on this bundle, moving only beside nearby tags when their plates collide.
    const candidates = [
      (first + last) / 2,
      ...tags
        .filter((p) => Math.abs(p.y - py) < 18)
        .flatMap((p) => [p.left - tw / 2 - 8, p.right + tw / 2 + 8]),
    ];
    const px = candidates
      .map((v) => Math.max(left + tw / 2 + 4, Math.min(right - tw / 2 - 4, v)))
      .find(
        (v) =>
          v >= first - tw / 2 &&
          v <= last + tw / 2 &&
          !tags.some(
            (p) => Math.abs(p.y - py) < 18 && v - tw / 2 - 4 < p.right && v + tw / 2 + 4 > p.left,
          ),
      );
    if (px === undefined) continue;
    tags.push({ left: px - tw / 2 - 4, right: px + tw / 2 + 4, y: py });
    c.fillStyle = t.panel;
    c.fillRect(px - tw / 2 - 4, py - 12, tw + 8, 16);
    c.fillStyle = t.text;
    c.fillText(text, px, py);
  }
  c.textAlign = 'left';
  c.fillStyle = t.text;
  c.font = `22px "${t.fontDisplay}"`;
  c.fillText('Relay', 20, 30);
  c.font = `11px "${t.fontMono}"`;
  const records = f.notes.filter((n) => n.start < score.to && n.end > score.from);
  const batonPhrases = score.phrases.filter((p) => baton.has(p.id));
  const batonRecords = batonPhrases.reduce((sum, p) => sum + p.notes.length, 0);
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
    const name = fit(c, section.name, bw - 12);
    if (!name || px <= sectionEnd) continue;
    const tw = c.measureText(name).width;
    c.strokeStyle = t.muted;
    c.lineWidth = 2;
    stroke(c, px + 3, 64, px + 3, top - 8);
    c.fillStyle = t.panel;
    c.beginPath();
    c.moveTo(px + 3, 64);
    c.lineTo(px + tw + 17, 64);
    c.lineTo(px + tw + 12, 73);
    c.lineTo(px + tw + 17, 82);
    c.lineTo(px + 3, 82);
    c.closePath();
    c.fill();
    c.fillStyle = t.text;
    c.fillText(name, px + 8, 77);
    sectionEnd = px + tw + 20;
  }
  for (
    let bar = 0;
    bar < score.to - score.from;
    bar += Math.max(1, Math.ceil(((score.to - score.from) * 34) / (right - left)))
  ) {
    c.fillStyle = t.text;
    c.fillText(String((f.sections.length ? 0 : score.from) + bar + 1), x(score.from + bar), 97);
  }
  const foot = bottom + 22;
  c.fillStyle = t.text;
  const batonAttacks = batonPhrases.reduce(
    (sum, p) => sum + p.notes.filter((n) => n.hasOnset).length,
    0,
  );
  c.fillText(
    fit(
      c,
      `${String(baton.size)} batons (${String(batonAttacks)} notes, ${String(batonRecords)} records) · ${String(records.length - batonRecords)} unmatched records`,
      w - 40,
    ),
    20,
    foot,
  );
  const cross = groups.find(
    (g) => score.phrases[g[0].before].instrument !== score.phrases[g[0].after].instrument,
  );
  const featured = cross ?? groups.at(0);
  if (featured) {
    const r = featured[0],
      a = score.phrases[r.before],
      b = score.phrases[r.after];
    const name = (id: string) => parts.find((p) => p.id === id)?.name ?? id;
    c.fillText(
      fit(
        c,
        `${r.kind} ${transposeText(r.transpose)} st${r.kind === 'near' ? ` · d ${displayNumber(r.distance)}` : ''} · ${name(a.instrument)} → ${name(b.instrument)}`,
        w - 40,
      ),
      20,
      foot + 19,
    );
  } else
    c.fillText(
      focus.links.length ? 'Current returns compacted to counts' : 'No current return established',
      20,
      foot + 19,
    );
  c.fillText(
    fit(
      c,
      `Solid exact · dashed near · ${String(focus.links.length)} current returns · ${String(groups.length)} bundles`,
      w - 40,
    ),
    20,
    foot + 38,
  );
  c.fillText(
    fit(c, 'Quiet dashes retain unmatched records, including control fragments', w - 40),
    20,
    foot + 57,
  );
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
