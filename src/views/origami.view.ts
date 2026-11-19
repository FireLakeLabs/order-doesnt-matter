import type { ViewDefinition, ViewFrame } from './types';
import { clamp } from './shared/math';
import {
  answerBook,
  answerReason,
  argLabel,
  contextLabels,
  focusPart,
  noteIdentity,
  paperWindow,
  patternLabel,
  printMarks,
  scalar,
  sealedReason,
  snapshotNotes,
  stepDetail,
  stepLabel,
  visibleSteps,
} from './origami/model';
import type { PaperNote } from './origami/model';

function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  while (text && ctx.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return text ? `${text}…` : '';
}
function line(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, b: number) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(a, b);
  ctx.stroke();
}
function paper(
  ctx: CanvasRenderingContext2D,
  frame: ViewFrame,
  x: number,
  y: number,
  w: number,
  h: number,
  fold: number,
) {
  const { theme } = frame;
  ctx.save();
  ctx.translate(x, y);
  ctx.transform(1, fold, 0, 1, 0, 0);
  ctx.fillStyle = theme.panel;
  ctx.shadowColor = theme.ground;
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 7;
  ctx.fillRect(0, 0, w, h);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, w, h);
  // Deterministic paper fibres, using the theme's ink and paper only.
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = theme.muted;
  for (let n = 0; n < Math.ceil(h / 9); n++) line(ctx, 3, n * 9 + 3, w - 3, n * 9 + 5);
  ctx.restore();
  const shade = ctx.createLinearGradient(0, 0, Math.min(24, w * 0.3), 0);
  shade.addColorStop(0, theme.ground);
  shade.addColorStop(1, theme.panel);
  ctx.save();
  ctx.globalAlpha = 0.65;
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, Math.min(24, w * 0.3), h);
  ctx.restore();
  ctx.strokeStyle = theme.muted;
  ctx.globalAlpha = 0.5;
  line(ctx, 1, 0, 1, h);
  ctx.globalAlpha = 1;
}
function score(
  ctx: CanvasRenderingContext2D,
  frame: ViewFrame,
  notes: PaperNote[],
  x: number,
  y: number,
  w: number,
  h: number,
  from: number,
  to: number,
  colour: string,
) {
  const { theme, now } = frame;
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    line(ctx, x + (i * w) / 4, y, x + (i * w) / 4, y + h);
    line(ctx, x, y + (i * h) / 4, x + w, y + (i * h) / 4);
  }
  const play = clamp((now - from) / (to - from));
  ctx.strokeStyle = theme.text;
  ctx.lineWidth = 1;
  line(ctx, x + w * play, y, x + w * play, y + h);
  const marks = printMarks(notes, from, to, w);
  for (const mark of marks) {
    const xx = x + mark.x * w,
      yy = y + h - 8 - (mark.lane / 23) * (h - 25);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 3;
    line(ctx, xx, yy, Math.max(xx + 2, x + mark.end * w - 2), yy);
    ctx.fillStyle = colour;
    ctx.fillRect(xx - 1, yy - 3, 3, 6);
  }
  // Text always paints last on opaque paper, clear of the musical ink.
  const occupied: { x: number; y: number; w: number }[] = [];
  for (const mark of marks) {
    const text = mark.count > 1 ? `×${String(mark.count)}` : mark.label;
    const ww = ctx.measureText(text).width;
    const xx = Math.min(x + w - ww, x + mark.x * w),
      yy = y + h - 15 - (mark.lane / 23) * (h - 25);
    if (
      h < 35 ||
      ww > w ||
      occupied.some((r) => Math.abs(r.y - yy) < 13 && xx < r.x + r.w + 1 && xx + ww + 1 > r.x)
    )
      continue;
    occupied.push({ x: xx, y: yy, w: ww });
    ctx.fillStyle = theme.panel;
    ctx.fillRect(xx - 1, yy - 10, ww + 2, 12);
    ctx.fillStyle = theme.text;
    ctx.fillText(text, xx, yy);
  }
}
const view: ViewDefinition = {
  id: 'origami',
  name: 'Origami',
  group: 'song',
  tag: 'construction',
  span: 'song',
  structure: true,
  mount(element) {
    const canvas = document.createElement('canvas'),
      select = document.createElement('select');
    const context = canvas.getContext('2d');
    if (!context) throw Error('Canvas 2D is unavailable');
    const ctx = context;
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden';
    select.setAttribute('aria-label', 'Origami focused part');
    select.style.cssText =
      'position:absolute;right:16px;top:12px;max-width:42%;font-size:11px;padding:5px;border:1px solid;';
    wrapper.append(canvas, select);
    element.append(wrapper);
    const answers = answerBook();
    let open = 1,
      manual: string | undefined,
      last: ViewFrame | undefined,
      drag = false;
    let track = { x: 0, y: 0, w: 1 },
      hits: { id: string; x: number; y: number; w: number }[] = [];
    let optionsKey = '';
    function draw(frame: ViewFrame) {
      last = frame;
      if (frame.width <= 0 || frame.height <= 0) return;
      const { width, height, theme, dpr } = frame;
      const pixelWidth = Math.max(1, Math.round(width * dpr)),
        pixelHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      canvas.style.width = `${String(width)}px`;
      canvas.style.height = `${String(height)}px`;
      ctx.reset();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = theme.ground;
      ctx.fillRect(0, 0, width, height);
      const c = ctx;
      c.font = `22px "${theme.fontDisplay}"`;
      c.fillStyle = theme.text;
      c.fillText('Origami', 18, 31);
      c.font = `11px "${theme.fontMono}"`;
      select.style.color = theme.text;
      select.style.background = theme.panel;
      select.style.borderColor = theme.line;
      select.style.fontFamily = `"${theme.fontMono}"`;
      const id = focusPart(frame, manual),
        part = frame.instruments.find((i) => i.id === id),
        structure = id ? frame.structure?.get(id) : undefined;
      const range = paperWindow(frame);
      const counts = new Map<string, number>();
      for (const n of frame.notes)
        if (n.start < Math.floor(frame.now) + 1 && n.end > Math.floor(frame.now))
          counts.set(n.instrument, (counts.get(n.instrument) ?? 0) + 1);
      const nextOptions = JSON.stringify(
        frame.instruments.map((i) => [i.id, i.name, counts.get(i.id) ?? 0]),
      );
      if (nextOptions !== optionsKey) {
        select.replaceChildren(
          ...frame.instruments.map((i) => {
            const option = document.createElement('option');
            option.value = i.id;
            option.textContent = `${i.name} · ${String(counts.get(i.id) ?? 0)} spans this bar`;
            return option;
          }),
        );
        optionsKey = nextOptions;
      }
      if (id) select.value = id;
      c.fillStyle = theme.text;
      c.fillText(
        fit(
          c,
          `${part?.name ?? 'No part'} · ${String(structure?.steps.length ?? 0)} stages · bar ${String(Math.floor(frame.now) + 1)} · ${String(Math.round((frame.now % 1) * 100))}%`,
          width - 36,
        ),
        18,
        54,
      );
      c.fillText(
        fit(
          c,
          `Bars ${String(range.from + 1)}–${String(range.to)} · snapshots include placement / context`,
          width - 36,
        ),
        18,
        72,
      );
      if (!structure) {
        c.fillText('Program structure unavailable', 18, 110);
        return;
      }
      let computing = 0;
      const pendingLabels: string[] = [];
      const indices = visibleSteps(structure.steps.length, open);
      const signalSteps = structure.steps.flatMap((s, i) =>
        s.kind === 'setting' && (s.driver.kind === 'signal' || s.driver.rates.length)
          ? [{ step: s, index: i }]
          : [],
      );
      const branches = signalSteps.filter((s) => indices.includes(s.index));
      const branchH = branches.length
          ? 42 + Math.max(1, ...branches.map(({ step }) => step.driver.rates.length)) * 22
          : 0,
        top = 84 + branchH;
      const left = 20,
        available = width - 40;
      const maxRows = Math.max(1, Math.floor((height - 110 - top) / 132));
      const preferredColumns = Math.max(
        1,
        Math.min(
          indices.length,
          Math.max(Math.floor(available / 120), Math.ceil(indices.length / maxRows)),
        ),
      );
      const rows = Math.ceil(indices.length / preferredColumns);
      const columns = Math.ceil(indices.length / rows);
      const panelH = Math.max(85, (height - 110 - top) / rows - 22);
      const pw = available / columns;
      branches.forEach(({ step, index }, b) => {
        const cell = available / Math.max(1, branches.length);
        const bw = Math.min(470, cell),
          bx = left + b * cell,
          by = 84;
        paper(c, frame, bx, by, bw - 8, branchH - 12, 0);
        c.font = `11px "${theme.fontMono}"`;
        c.fillStyle = theme.text;
        c.fillText(
          fit(
            c,
            `${String(index + 1)} ↳ ${step.name}: ${patternLabel(step.driver.pattern)}`,
            bw - 24,
          ),
          10,
          17,
        );
        if (!step.driver.rates.length) c.fillText('Continuous driver · definition time', 10, 37);
        step.driver.rates.forEach((rate, rateIndex) => {
          const answer = rate.opaque
            ? { status: 'unavailable' as const, reason: rate.opaque }
            : answers.read(structure, `rate:${rate.id}`, () => rate.events());
          const reason = answerReason(answer);
          if (!answer) {
            computing++;
            pendingLabels.push(`${String(index + 1)} driver`);
          }
          const yy = 37 + rateIndex * 22;
          if (reason || !answer || bw < 220) {
            c.fillText(
              fit(
                c,
                reason
                  ? `${rate.name}: sealed · ${reason}`
                  : !answer
                    ? `${rate.name}: computing`
                    : `${rate.name} ${rate.args.map(argLabel).join(', ')}`,
                bw - 24,
              ),
              10,
              yy,
            );
            return;
          }
          const events = snapshotNotes(answer, range.from, range.to);
          c.fillText(rate.name, 10, yy);
          const start = 50,
            span = bw - 165;
          for (const event of events) {
            const x = start + clamp((event.start - range.from) / (range.to - range.from)) * span;
            const w = Math.max(
              1,
              ((Math.min(range.to, event.end) - Math.max(range.from, event.start)) /
                (range.to - range.from)) *
                span,
            );
            c.fillStyle = theme.panel;
            c.strokeStyle = theme.muted;
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(x, yy - 13);
            c.lineTo(x + w, yy - 10);
            c.lineTo(x + w, yy + 9);
            c.lineTo(x, yy + 6);
            c.closePath();
            c.fill();
            c.stroke();
            c.fillStyle = theme.text;
            c.fillText(fit(c, `${scalar(event.value.value)}×`, w - 6), x + 4, yy + 1);
          }
          c.fillText(fit(c, 'argument time', 100), bw - 108, yy);
        });
        c.restore();
        c.strokeStyle = theme.muted;
        c.setLineDash([3, 4]);
        line(
          c,
          bx + bw * 0.5,
          by + branchH - 12,
          left + ((indices.indexOf(index) % columns) + 0.5) * pw,
          top + Math.floor(indices.indexOf(index) / columns) * (panelH + 22) - 4,
        );
        c.setLineDash([]);
      });
      let previous: PaperNote[] | undefined;
      indices.forEach((index, display) => {
        const step = structure.steps[index];
        const reason = sealedReason(structure, index);
        const answer = reason
          ? { status: 'unavailable' as const, reason }
          : answers.read(structure, `step:${String(index)}`, () => structure.snapshot(index));
        if (!answer) {
          computing++;
          pendingLabels.push(String(index + 1));
        }
        const why = answerReason(answer),
          notes = snapshotNotes(answer, range.from, range.to);
        const row = Math.floor(display / columns),
          col = display % columns;
        const x = left + col * pw,
          slope = (display % 2 ? 1 : -1) * Math.min(0.2, 18 / pw),
          y = top + row * (panelH + 22) + (display % 2 ? 0 : 18);
        const hidden = index - (indices[display - 1] ?? -1) - 1;
        for (let edge = Math.min(4, hidden); edge > 0; edge--) {
          c.fillStyle = theme.panel;
          c.strokeStyle = theme.line;
          c.lineWidth = 1;
          c.fillRect(x + edge * 3, y - edge * 3, pw, panelH);
          c.strokeRect(x + edge * 3, y - edge * 3, pw, panelH);
        }
        paper(c, frame, x, y, pw, panelH, slope);
        c.font = `11px "${theme.fontMono}"`;
        c.fillStyle = theme.text;
        c.fillText(
          fit(c, `${String(index + 1).padStart(2, '0')} ${stepLabel(step)}`, pw - 16),
          8,
          22,
        );
        const sampled = notes.find((n) => n.start <= frame.now && frame.now < n.end) ?? notes.at(0);
        const detail =
          step.kind === 'setting' && sampled && step.name in sampled.value
            ? scalar(sampled.value[step.name])
            : stepDetail(step);
        c.fillText(fit(c, detail, pw - 16), 8, 42);
        const status = why
          ? 'sealed'
          : !answer
            ? 'computing'
            : hidden > 0
              ? `${String(hidden)} closed folds`
              : index === 0
                ? 'raw + context'
                : previous
                  ? noteIdentity(notes) === noteIdentity(previous)
                    ? 'notes survive'
                    : 'notes change'
                  : 'score snapshot';
        const compact = panelH < 145;
        if (!compact) c.fillText(fit(c, status, pw - 16), 8, 60);
        const chartY = compact ? 53 : 75,
          chartH = Math.max(8, panelH - chartY - 28);
        if (why) {
          c.strokeStyle = theme.muted;
          c.setLineDash([4, 3]);
          line(c, 8, chartY, pw - 8, chartY + chartH);
          line(c, pw - 8, chartY, 8, chartY + chartH);
          c.setLineDash([]);
          const reasonLine = (text: string, yy: number) => {
            c.fillStyle = theme.panel;
            c.fillRect(6, yy - 11, pw - 12, 14);
            c.fillStyle = theme.text;
            c.fillText(fit(c, text, pw - 16), 8, yy);
          };
          const words = why.split(' ');
          let row = '',
            yy = chartY + 15;
          for (const word of words) {
            if (c.measureText(`${row} ${word}`).width > pw - 16 && row) {
              if (yy < panelH - 25) reasonLine(row, yy);
              row = word;
              yy += 14;
            } else row += `${row ? ' ' : ''}${word}`;
          }
          if (yy < panelH - 25) reasonLine(row, yy);
        } else if (answer)
          score(
            c,
            frame,
            notes,
            8,
            chartY,
            pw - 16,
            chartH,
            range.from,
            range.to,
            part?.colour ?? theme.text,
          );
        c.fillStyle = theme.panel;
        c.fillRect(5, panelH - 23, pw - 10, 20);
        c.fillStyle = theme.text;
        c.fillText(
          fit(c, why ? 'sealed' : !answer ? 'computing' : `${String(notes.length)} spans`, pw - 16),
          8,
          panelH - 8,
        );
        c.restore();
        previous = answer && !why ? notes : undefined;
      });
      if (computing) {
        c.fillStyle = theme.ground;
        c.fillRect(18, 61, width - 36, 17);
        c.fillStyle = theme.text;
        c.fillText(
          fit(
            c,
            `Bars ${String(range.from + 1)}–${String(range.to)} · computing: ${pendingLabels.join(' ')}`,
            width - 36,
          ),
          18,
          72,
        );
      }
      canvas.dataset.computing = String(computing);
      canvas.dataset.stages = String(indices.length);
      canvas.dataset.focus = id;
      c.font = `11px "${theme.fontMono}"`;
      c.fillStyle = theme.text;
      const context = contextLabels(structure);
      c.fillText(
        fit(c, `CONTEXT → ${context.join(' → ') || 'no outside transforms'}`, width - 36),
        18,
        height - 104,
      );
      const sections = frame.sections.length
        ? frame.sections
        : [{ name: 'four-bar pages', from: frame.from, to: frame.to }];
      const origin = frame.sections.length ? 0 : frame.from;
      const duration = Math.max(1, (sections.at(-1)?.to ?? frame.to) - origin);
      for (const section of sections) {
        const x = 18 + ((section.from - origin) / duration) * (width - 36),
          w = ((section.to - section.from) / duration) * (width - 36);
        c.fillStyle = theme.panel;
        c.fillRect(x, height - 94, w - 2, 18);
        c.strokeStyle = theme.line;
        c.lineWidth = 1;
        c.strokeRect(x, height - 94, w - 2, 18);
        c.fillStyle = theme.text;
        c.fillText(fit(c, section.name, w - 10), x + 4, height - 81);
      }
      c.strokeStyle = theme.text;
      const cursor = 18 + ((frame.now - range.offset - origin) / duration) * (width - 36);
      line(c, cursor, height - 98, cursor, height - 95);
      line(c, cursor, height - 76, cursor, height - 74);
      hits = [];
      const others = frame.instruments
          .filter((i) => i.id !== id)
          .sort(
            (a, b) =>
              Number((counts.get(b.id) ?? 0) > 0) - Number((counts.get(a.id) ?? 0) > 0) ||
              a.index - b.index,
          ),
        partColumns = Math.max(1, Math.floor((width - 36) / 145));
      others.slice(0, partColumns).forEach((i, n) => {
        const x = 18 + (n * (width - 36)) / partColumns,
          w = (width - 36) / partColumns - 8;
        c.fillStyle = theme.panel;
        c.fillRect(x, height - 73, w, 27);
        c.fillStyle = theme.text;
        const more = others.length > partColumns && n === partColumns - 1;
        c.fillText(
          fit(
            c,
            more
              ? `+${String(others.length - n)} in part menu`
              : `${i.name} · ${String(counts.get(i.id) ?? 0)}`,
            w - 10,
          ),
          x + 5,
          height - 55,
        );
        if (!more) hits.push({ id: i.id, x, y: height - 73, w });
      });
      track = { x: 110, y: height - 24, w: Math.max(1, width - 240) };
      c.fillStyle = theme.text;
      c.fillText('final score', 18, height - 20);
      c.fillText('all stages', width - 100, height - 20);
      c.strokeStyle = theme.muted;
      line(c, track.x, track.y, track.x + track.w, track.y);
      const tab = track.x + open * track.w;
      c.fillStyle = theme.panel;
      c.strokeStyle = theme.text;
      c.lineWidth = 1.5;
      c.beginPath();
      c.roundRect(tab - 14, track.y - 12, 28, 24, 3);
      c.fill();
      c.stroke();
      for (let i = -1; i <= 1; i++) line(c, tab + i * 5, track.y - 6, tab + i * 5, track.y + 6);
      canvas.title = `${part?.name ?? ''}: ${structure.steps.map((s, i) => `${String(i + 1)} ${stepLabel(s)}: ${sealedReason(structure, i) ?? stepDetail(s)}`).join('; ')}. Context: ${context.join(' → ')}. Other parts: ${String(others.length)}; use the part menu for every name and count. Double-click resets.`;
    }
    function point(event: PointerEvent) {
      const box = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - box.left) * (last?.width ?? 1)) / box.width,
        y: ((event.clientY - box.top) * (last?.height ?? 1)) / box.height,
      };
    }
    const down = (event: PointerEvent) => {
      const p = point(event);
      const hit = hits.find((h) => p.x >= h.x && p.x < h.x + h.w && p.y >= h.y && p.y < h.y + 27);
      if (hit) {
        manual = hit.id;
        if (last) draw(last);
        return;
      }
      if (Math.abs(p.y - track.y) < 20 && p.x >= track.x - 20 && p.x <= track.x + track.w + 20) {
        drag = true;
        canvas.setPointerCapture(event.pointerId);
        open = clamp((p.x - track.x) / track.w);
        if (last) draw(last);
      }
    };
    const move = (event: PointerEvent) => {
      if (drag) {
        open = clamp((point(event).x - track.x) / track.w);
        if (last) draw(last);
      }
    };
    const up = () => {
      drag = false;
    };
    const reset = () => {
      open = 1;
      manual = undefined;
      if (last) draw(last);
    };
    const change = () => {
      manual = select.value;
      if (last) draw(last);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    canvas.addEventListener('dblclick', reset);
    select.addEventListener('change', change);
    return {
      frame: draw,
      dispose() {
        answers.dispose();
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up);
        canvas.removeEventListener('lostpointercapture', up);
        canvas.removeEventListener('dblclick', reset);
        select.removeEventListener('change', change);
        wrapper.remove();
        canvas.width = canvas.height = 0;
        last = undefined;
        hits = [];
      },
    };
  },
};
export default view;
