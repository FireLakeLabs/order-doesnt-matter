import type { ViewDefinition, ViewFrame } from './types';
import { line, mount2d } from './shared/retro-2d';
import { noteProgress } from './shared/timing';
import {
  analyse,
  crowded,
  fontSize,
  gain,
  hop,
  layout,
  lyrics,
  previewFontSize,
} from './karaoke/model';
import type { Part, Word } from './karaoke/model';
function fit(c: CanvasRenderingContext2D, text: string, width: number) {
  if (c.measureText(text).width <= width) return text;
  while (text.length && c.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return text ? `${text}…` : '';
}
const quantity = (count: number, word: string) =>
  `${String(count)} ${word}${count === 1 ? '' : 's'}`;
function draw(c: CanvasRenderingContext2D, f: ViewFrame, score: Map<string, Part>) {
  const song = lyrics(f, score),
    g = layout(f, song.rows.length),
    t = f.theme,
    phase = f.now - song.bar;
  const measure = (text: string, size: number) => {
    c.font = `700 ${String(size)}px "${t.fontDisplay}"`;
    return c.measureText(text).width;
  };
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  c.fillStyle = t.text;
  c.font = `600 ${String(Math.max(24, 24 * g.scale))}px "${t.fontDisplay}"`;
  c.fillText('Karaoke', Math.max(16, 24 * g.scale), Math.max(32, 40 * g.scale));
  c.font = `${String(g.nameSize)}px "${t.fontMono}"`;
  c.fillStyle = t.muted;
  c.textAlign = 'right';
  c.fillText(
    `bar ${String(song.bar + 1)} · ${String(Math.round(phase * 100))}%`,
    g.right,
    Math.max(32, 40 * g.scale),
  );
  c.textAlign = 'left';
  const verseSize = g.compact ? 24 : Math.max(26, 34 * g.scale),
    verseY = Math.min(g.top - 26, 112 * g.scale);
  c.fillStyle = t.muted;
  c.font = `700 ${String(verseSize)}px "${t.fontDisplay}"`;
  const verse = fit(c, (song.section?.name ?? 'Score').toUpperCase(), (g.right - g.left) * 0.6);
  c.fillText(verse, g.left, verseY);
  const verseWidth = c.measureText(verse).width;
  c.font = `${String(g.nameSize)}px "${t.fontMono}"`;
  if (song.sectionBar !== undefined)
    c.fillText(
      fit(
        c,
        `bar ${String(song.sectionBar)} of ${String(song.sectionBars)}`,
        g.right - g.left - verseWidth - 22,
      ),
      g.left + verseWidth + 22,
      verseY,
    );
  c.strokeStyle = t.text;
  c.globalAlpha = 0.12;
  line(c, g.x(f.now, song.bar), g.top - 12, g.x(f.now, song.bar), g.bottom);
  c.globalAlpha = 1;
  let dots = 0,
    wordCount = 0,
    spanCount = 0;
  if (!song.rows.length) {
    c.font = `${String(g.nameSize)}px "${t.fontMono}"`;
    c.fillStyle = t.muted;
    c.textAlign = 'center';
    c.fillText(
      song.known ? 'This verse is resting' : 'This bar has not been asked about',
      (g.left + g.right) / 2,
      (g.top + g.bottom) / 2,
    );
    c.textAlign = 'left';
  }
  for (const [i, row] of song.rows.entries()) {
    const baseline = g.top + (i + 0.75) * g.rowHeight,
      colour = row.instrument.colour;
    const dense = crowded(row.words, song.bar, g, measure);
    dots += dense ? row.words.length : 0;
    wordCount += row.words.length;
    spanCount += row.words.reduce((sum, w) => sum + w.spans.length, 0);
    c.globalAlpha = row.instrument.muted ? 0.3 : 1;
    c.fillStyle = colour;
    c.beginPath();
    c.arc(Math.max(16, 30 * g.scale), baseline - 4, Math.max(3, 4 * g.scale), 0, 2 * Math.PI);
    c.fill();
    c.font = `${String(g.nameSize)}px "${t.fontMono}"`;
    c.fillStyle = t.muted;
    c.fillText(
      fit(c, row.instrument.name, g.left - Math.max(28, 42 * g.scale) - 10),
      Math.max(28, 42 * g.scale),
      baseline,
    );
    const carried = row.words.filter((w) => w.note.start < song.bar);
    if (g.rowHeight > 50 && carried.length) {
      c.font = `12px "${t.fontMono}"`;
      c.fillText(
        fit(c, `held ${carried.map((w) => w.text).join(' ')}`, g.left - 38),
        Math.max(28, 42 * g.scale),
        baseline + 18,
      );
    }
    c.save();
    c.beginPath();
    c.rect(g.left, 0, g.right - g.left, g.bottom);
    c.clip();
    const ball = hop(row.part, row.instrument.id, f.now, g);
    const radius = Math.max(3, 7 * g.scale * Math.min(1, g.rowHeight / 36));
    const landing = (n: Word['note']) =>
      dense ? baseline - 3 - radius - 2 : baseline - fontSize(g, gain(n)) * 0.85 - radius - 3;
    if (!dense) {
      const onsets = row.part.onsets.filter((n, j, all) => !j || n.start !== all[j - 1].start);
      c.strokeStyle = t.muted;
      c.lineWidth = 1;
      c.setLineDash([2 * g.scale, 5 * g.scale]);
      c.globalAlpha *= 0.35;
      for (let j = 1; j < onsets.length; j++) {
        const a = onsets[j - 1],
          b = onsets[j];
        if (b.start <= song.bar || a.start >= song.bar + 1) continue;
        const pose = hop(row.part, row.instrument.id, a.start, g);
        if (!pose) continue;
        const x = g.x(a.start, song.bar),
          end = g.x(b.start, song.bar);
        c.beginPath();
        c.moveTo(x, landing(a));
        c.quadraticCurveTo(
          (x + end) / 2,
          (landing(a) + landing(b)) / 2 - 2 * pose.height,
          end,
          landing(b),
        );
        c.stroke();
      }
      c.setLineDash([]);
      c.globalAlpha = row.instrument.muted ? 0.3 : 1;
    }
    for (const word of row.words) {
      const n = word.note,
        size = fontSize(g, word.gain),
        x = g.x(n.start, song.bar),
        end = g.x(n.end, song.bar),
        p = noteProgress(n, f.now),
        under = baseline + (dense ? 7 : size * 0.25);
      c.strokeStyle = t.line;
      c.lineWidth = dense ? 1 : Math.max(2, 4 * g.scale);
      line(c, x, under, end, under);
      if (p > 0) {
        c.strokeStyle = colour;
        line(c, x, under, x + (end - x) * p, under);
      }
      if (dense) {
        c.fillStyle = p > 0 ? colour : t.muted;
        c.beginPath();
        c.arc(x, baseline - 3, Math.max(1.2, Math.min(2.5, g.scale * 2)), 0, Math.PI * 2);
        c.fill();
      } else {
        const w = measure(word.text, size);
        c.fillStyle = t.muted;
        c.fillText(word.text, x, baseline);
        c.save();
        c.beginPath();
        c.rect(x, baseline - size, w * p, size * 1.2);
        c.clip();
        c.fillStyle = colour;
        c.fillText(word.text, x, baseline);
        c.restore();
      }
      if (n.start < song.bar) {
        c.strokeStyle = colour;
        c.lineWidth = 1;
        line(c, g.left + 5, under - 3, g.left + 1, under);
        line(c, g.left + 1, under, g.left + 5, under + 3);
      }
    }
    if (ball && ball.time >= song.bar && ball.time < song.bar + 1) {
      const p = ball.progress,
        y =
          landing(ball.previous) +
          (ball.next ? landing(ball.next) - landing(ball.previous) : 0) * p -
          ball.rise;
      c.fillStyle = t.text;
      c.shadowColor = colour;
      c.shadowBlur = t.glow ? 8 * g.scale : 0;
      c.beginPath();
      c.arc(g.x(ball.time, song.bar), y, radius, 0, Math.PI * 2);
      c.fill();
      c.shadowBlur = 0;
    }
    c.restore();
    c.globalAlpha = 1;
    if (dense) {
      c.font = `12px "${t.fontMono}"`;
      const caption = quantity(row.words.length, 'dot');
      const label =
        c.measureText(caption).width <= f.width - g.right - 16 ? caption : String(row.words.length);
      c.fillStyle = t.muted;
      c.textAlign = 'left';
      c.fillText(label, g.right + 8, baseline);
    }
  }
  c.globalAlpha = 1;
  c.strokeStyle = t.line;
  line(c, g.left, g.bottom + 15, g.right, g.bottom + 15);
  const previewY = g.compact ? f.height - 26 : g.bottom + (f.height - g.bottom) * 0.63;
  c.font = `${String(g.compact ? 12 : g.nameSize)}px "${t.fontMono}"`;
  c.fillStyle = t.muted;
  c.fillText(
    `next line · bar ${String(song.bar + 2)}${song.nextKnown ? '' : ' · unasked'}`,
    g.left,
    g.bottom + 33,
  );
  if (song.nextKnown) {
    const next = song.rows
      .flatMap((r) => r.next.map((word) => ({ word, colour: r.instrument.colour })))
      .sort((a, b) => a.word.note.start - b.word.note.start);
    const previewMeasure = (text: string, size: number) => {
      c.font = `600 ${String(size)}px "${t.fontDisplay}"`;
      return c.measureText(text).width;
    };
    const dense = crowded(
      next.map((n) => n.word),
      song.bar + 1,
      { ...g, rowHeight: 32 },
      previewMeasure,
      (value) => previewFontSize(g, value),
    );
    const groups = new Map<number, typeof next>();
    for (const n of next) {
      const key = Math.round(n.word.note.start * 1e9),
        group = groups.get(key) ?? [];
      group.push(n);
      groups.set(key, group);
    }
    c.save();
    c.beginPath();
    c.rect(
      g.left,
      g.bottom + 39,
      g.right - g.left,
      (g.compact ? f.height - 8 : f.height - 24) - (g.bottom + 39),
    );
    c.clip();
    c.globalAlpha = 0.4;
    for (const group of groups.values())
      for (const [i, { word, colour }] of group.entries()) {
        const offset = dense
          ? ((i % Math.min(7, group.length)) - (Math.min(7, group.length) - 1) / 2) * 2.5
          : 0;
        const x = g.x(word.note.start, song.bar + 1),
          y = previewY + offset;
        c.fillStyle = colour;
        c.strokeStyle = colour;
        c.lineWidth = 1;
        line(c, x, y + 5, g.x(word.note.end, song.bar + 1), y + 5);
        if (dense) {
          c.beginPath();
          c.arc(x, y - 4, 1.4, 0, Math.PI * 2);
          c.fill();
        } else {
          c.font = `600 ${String(previewFontSize(g, word.gain))}px "${t.fontDisplay}"`;
          c.fillText(word.text, x, y);
        }
        if (word.note.start < song.bar + 1) {
          line(c, g.left + 4, y + 2, g.left + 1, y + 5);
          line(c, g.left + 1, y + 5, g.left + 4, y + 8);
        }
      }
    c.restore();
    c.globalAlpha = 1;
    c.font = `12px "${t.fontMono}"`;
    c.fillStyle = t.muted;
    c.textAlign = 'right';
    c.fillText(`${quantity(next.length, 'word')}${dense ? ' · dots' : ''}`, g.right, g.bottom + 33);
    c.textAlign = 'left';
  }
  if (!g.compact) {
    c.font = `12px "${t.fontMono}"`;
    c.fillStyle = t.muted;
    c.textAlign = 'right';
    c.fillText(
      `${quantity(wordCount, 'word')} · ${quantity(spanCount, 'span')}${dots ? ` · ${quantity(dots, 'dot')}` : ''} · ${String(f.instruments.length - song.rows.length)} resting`,
      g.right,
      f.height - 12,
    );
    c.textAlign = 'left';
  }
}
export default {
  id: 'karaoke',
  group: 'rhythm',
  name: 'Karaoke',
  tag: 'sing along',
  mount(element) {
    return mount2d(element, analyse, draw);
  },
} satisfies ViewDefinition;
