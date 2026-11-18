import type { ViewDefinition, ViewFrame } from './types';
import {
  alignment,
  indexOrrery,
  orbitMarks,
  orbitPhase,
  orreryLayout,
  periodText,
  type Orrery,
} from './orrery/model';

function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  while (text && ctx.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return text ? `${text}…` : '';
}
function circle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
}
function draw(ctx: CanvasRenderingContext2D, frame: ViewFrame, score: Orrery) {
  const { width, height, theme, now } = frame;
  const box = orreryLayout(width, height, score.orbits.length);
  const { cx, cy, radius, sun, ledger } = box;
  const instruments = new Map(frame.instruments.map((i) => [i.id, i]));
  const sorted = [...score.orbits].sort(
    (a, b) =>
      (a.period ? a.period.n / a.period.d : Infinity) -
      (b.period ? b.period.n / b.period.d : Infinity),
  );
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  // Mechanical motion has its own sky, never the ledger or header/footer text.
  ctx.beginPath();
  ctx.rect(
    8,
    68,
    box.narrow ? width - 16 : ledger.x - 16,
    Math.max(0, box.narrow ? ledger.y - 84 : height - 158),
  );
  ctx.clip();
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1;
  circle(ctx, cx, cy, radius + 8);
  ctx.stroke();
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(a) * (radius + 5), cy - Math.cos(a) * (radius + 5));
    ctx.lineTo(cx + Math.sin(a) * (radius + 9), cy - Math.cos(a) * (radius + 9));
    ctx.stroke();
  }
  const phase = alignment(score.common, now);
  if (phase && phase.flash > 0) {
    ctx.globalAlpha = phase.flash * 0.6;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    circle(ctx, cx, cy, sun + 8 + (radius - sun - 8) * (1 - phase.flash));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  sorted.forEach((o, index) => {
    const i = instruments.get(o.id);
    if (!i) return;
    const r = sun + 18 + ((radius - sun - 18) * (index + 0.5)) / Math.max(1, sorted.length);
    const rest = !i.inSection || i.muted;
    ctx.strokeStyle = theme.accent;
    ctx.globalAlpha = rest ? 0.17 : 0.35;
    ctx.lineWidth = 1;
    ctx.setLineDash(o.period ? [] : [3, 5]);
    circle(ctx, cx, cy, r);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = rest ? 0.45 : 1;
    const marks = orbitMarks(o, r);
    ctx.fillStyle = i.colour;
    for (const m of marks) {
      const a = m.phase * Math.PI * 2;
      circle(ctx, cx + Math.sin(a) * r, cy - Math.cos(a) * r, m.count > 1 ? 3.5 : 2);
      ctx.fill();
    }
    const angle = (o.period ? orbitPhase(o.period, now) : 0) * Math.PI * 2;
    const x = cx + Math.sin(angle) * r,
      y = cy - Math.cos(angle) * r;
    ctx.strokeStyle = theme.line;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.fillStyle = rest || !o.period ? theme.ground : i.colour;
    ctx.strokeStyle = theme.text;
    ctx.lineWidth = 1.25;
    circle(
      ctx,
      x,
      y,
      Math.max(
        box.narrow ? 3 : 4.5,
        Math.min(7, ((radius - sun) / Math.max(1, sorted.length)) * 0.55),
      ),
    );
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
  ctx.fillStyle = theme.panel;
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  circle(ctx, cx, cy, sun);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = theme.line;
  ctx.setLineDash([2, 4]);
  circle(ctx, cx, cy, sun - 6);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  // Text is opaque, uses the high-contrast text token, and is drawn after all motion.
  ctx.fillStyle = theme.text;
  ctx.textAlign = 'left';
  ctx.font = `22px "${theme.fontDisplay}"`;
  ctx.fillText('Orrery', 16, 31);
  ctx.font = `11px "${theme.fontMono}"`;
  ctx.fillText(
    fit(ctx, `OBSERVED NOTE PERIODS · ${String(frame.to - frame.from)} BARS ASKED`, width - 32),
    16,
    54,
  );
  ctx.textAlign = 'right';
  ctx.fillText(
    `bar ${String(Math.floor(now) + 1)} · ${String(Math.round((now - Math.floor(now)) * 100))}%`,
    width - 16,
    29,
  );
  ctx.textAlign = 'center';
  ctx.fillText('1 BAR', cx, cy + 4);
  ctx.textAlign = 'left';
  ctx.fillText('ORBIT LEDGER', ledger.x, ledger.y);
  const ledgerOrbits = [...score.orbits].sort(
    (a, b) => Number(instruments.get(b.id)?.inSection) - Number(instruments.get(a.id)?.inSection),
  );
  const visible = ledgerOrbits.slice(0, box.shown);
  visible.forEach((o, n) => {
    const i = instruments.get(o.id);
    if (!i) return;
    const y = ledger.y + 23 + n * 26;
    ctx.fillStyle = i.colour;
    circle(ctx, ledger.x + 4, y - 4, 3);
    ctx.fill();
    ctx.fillStyle = theme.text;
    const count = o.period ? o.marks.reduce((s, m) => s + m.count, 0) : o.observed;
    const state = i.muted ? 'muted' : i.inSection ? '' : 'rest';
    const detail = `${periodText(o.period)}${o.period ? 'b' : ''} · ${String(count)}${o.period ? '/lap' : ' seen'}${state ? ` · ${state}` : ''}`;
    const detailWidth = ctx.measureText(detail).width;
    const nameWidth = Math.max(0, ledger.width - detailWidth - 26);
    ctx.fillText(fit(ctx, i.name, nameWidth), ledger.x + 16, y);
    ctx.textAlign = 'right';
    ctx.fillText(detail, ledger.x + ledger.width, y);
    ctx.textAlign = 'left';
  });
  if (box.hidden) {
    const hidden = ledgerOrbits.slice(box.shown);
    const lap = hidden.reduce((sum, o) => sum + o.marks.reduce((n, m) => n + m.count, 0), 0);
    const seen = hidden.filter((o) => !o.period).reduce((sum, o) => sum + o.observed, 0);
    ctx.fillText(
      fit(
        ctx,
        `+${String(box.hidden)} parts · ${String(lap)}/lap · ${String(seen)} seen`,
        ledger.width,
      ),
      ledger.x,
      ledger.y + 23 + box.shown * 26,
    );
  }
  const y = height - 65;
  const next = alignment(score.common, now);
  ctx.fillStyle = theme.panel;
  ctx.fillRect(0, y - 18, width, 83);
  ctx.fillStyle = theme.text;
  const label = score.complete ? 'PHASE ALIGNMENT' : 'KNOWN PHASES';
  ctx.fillText(
    fit(
      ctx,
      next
        ? `${label} · EVERY ${periodText(score.common)}b · NEXT IN ${String(Number((next.next - now).toFixed(3)))}b`
        : 'PHASE ALIGNMENT · unknown',
      width - 32,
    ),
    16,
    y,
  );
  ctx.fillText(
    fit(ctx, 'Note pitch / sample / span; section gates & settings excluded.', width - 32),
    16,
    y + 22,
  );
  ctx.fillText(
    fit(ctx, 'Dots: onsets/lap · dense dots: counts in ledger · dashed: unknown', width - 32),
    16,
    y + 42,
  );
}
const view: ViewDefinition = {
  id: 'orrery',
  name: 'Orrery',
  group: 'song',
  tag: 'note periods',
  span: 'song',
  mount(element) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw Error('Canvas 2D is unavailable');
    element.append(canvas);
    let notes: ViewFrame['notes'] | undefined,
      key = '',
      score: Orrery;
    return {
      frame(frame) {
        if (frame.width <= 0 || frame.height <= 0) return;
        const next = JSON.stringify([
          frame.from,
          frame.to,
          frame.sections,
          frame.instruments.map((i) => [i.id, i.index]),
        ]);
        if (frame.notes !== notes || next !== key) {
          score = indexOrrery(frame);
          notes = frame.notes;
          key = next;
        }
        const w = Math.round(frame.width * frame.dpr),
          h = Math.round(frame.height * frame.dpr);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        canvas.style.width = `${String(frame.width)}px`;
        canvas.style.height = `${String(frame.height)}px`;
        ctx.reset();
        ctx.scale(frame.dpr, frame.dpr);
        draw(ctx, frame, score);
      },
      dispose() {
        canvas.remove();
      },
    };
  },
};
export default view;
