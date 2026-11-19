import type { ViewDefinition, ViewFrame } from './types';
import { DENSITY_SIZE, glassLayout, measureGlass, rimMarks, scoredRim } from './stereo-glass/model';

function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  while (text && ctx.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return text ? `${text}…` : '';
}
const view: ViewDefinition = {
  id: 'stereo-glass',
  name: 'Stereo glass',
  group: 'show',
  tag: 'left / right',
  needs: 'audio',
  mount(element) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    const c = canvas.getContext('2d');
    if (!c) throw Error('Stereo glass needs Canvas 2D');
    element.append(canvas);
    return {
      frame(frame: ViewFrame) {
        const { width: w, height: h, dpr, theme } = frame;
        if (w <= 0 || h <= 0) return;
        const pw = Math.round(w * dpr),
          ph = Math.round(h * dpr);
        if (canvas.width !== pw || canvas.height !== ph) {
          canvas.width = pw;
          canvas.height = ph;
        }
        c.reset();
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.fillStyle = theme.ground;
        c.fillRect(0, 0, w, h);
        const box = glassLayout(w, h, Math.max(1, ...frame.instruments.map((i) => i.index + 1))),
          { cx, cy, radius: r } = box;
        const measured = measureGlass(frame),
          ticks = scoredRim(frame);
        const circle = (radius: number) => {
          c.beginPath();
          c.arc(cx, cy, radius, 0, Math.PI * 2);
        };
        c.fillStyle = theme.panel;
        c.strokeStyle = theme.line;
        c.lineWidth = 2;
        circle(r + 9);
        c.fill();
        c.stroke();
        const glass = c.createRadialGradient(cx - r * 0.25, cy - r * 0.3, 0, cx, cy, r);
        glass.addColorStop(0, theme.panel);
        glass.addColorStop(0.85, theme.ground);
        glass.addColorStop(1, theme.panel);
        c.fillStyle = glass;
        circle(r);
        c.fill();
        c.strokeStyle = theme.line;
        c.lineWidth = 1;
        for (const f of [0.25, 0.5, 0.75, 1]) {
          circle(r * f);
          c.stroke();
        }
        for (const angle of [0, Math.PI / 4, Math.PI / 2, (Math.PI * 3) / 4]) {
          c.beginPath();
          c.moveTo(cx - Math.sin(angle) * r, cy - Math.cos(angle) * r);
          c.lineTo(cx + Math.sin(angle) * r, cy + Math.cos(angle) * r);
          c.stroke();
        }
        if (measured) {
          c.save();
          circle(r - 1);
          c.clip();
          const unit = (r * 2) / (DENSITY_SIZE - 1);
          c.fillStyle = theme.accent;
          // Occupancy density, no sample-to-sample joins and no retained pixels.
          // Soft overlaps live only inside this frame's measured span.
          for (let i = 0; i < measured.bins.length; i++) {
            const count = measured.bins[i];
            if (!count) continue;
            const x = cx - r + (i % DENSITY_SIZE) * unit,
              y = cy - r + Math.floor(i / DENSITY_SIZE) * unit;
            const intensity = 0.22 + (0.78 * Math.log1p(count)) / Math.log1p(measured.peak);
            c.globalAlpha = intensity * 0.15;
            c.beginPath();
            c.arc(x, y, unit * 1.6, 0, Math.PI * 2);
            c.fill();
            c.globalAlpha = intensity * 0.8;
            c.fillRect(x - unit * 0.45, y - unit * 0.45, unit * 0.9, unit * 0.9);
          }
          c.restore();
        }
        const marks = rimMarks(ticks, r);
        c.lineWidth = 2;
        for (const mark of marks) {
          const sin = Math.sin(mark.angle),
            cos = Math.cos(mark.angle);
          const x = cx + sin * mark.radius,
            y = cy - cos * mark.radius;
          const colour = mark.ticks > 1 ? theme.text : mark.colour;
          c.strokeStyle = colour;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x + sin * 2, y - cos * 2);
          // Held spans have a crossbar, including continuations with no new onset.
          if (mark.held) {
            c.moveTo(x - cos * 3, y - sin * 3);
            c.lineTo(x + cos * 3, y + sin * 3);
          }
          c.stroke();
          if (mark.onsets) {
            c.fillStyle = theme.text;
            c.beginPath();
            c.arc(x, y, 4, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = colour;
            c.beginPath();
            c.arc(x, y, 2.5, 0, Math.PI * 2);
            c.fill();
          }
        }
        // Text is last, isolated from all moving ink on opaque token plates.
        c.font = `11px "${theme.fontMono}", monospace`;
        const label = (text: string, x: number, y: number, align: CanvasTextAlign = 'left') => {
          if (align === 'left') text = fit(c, text, w - x - 18);
          c.textAlign = align;
          const size = c.measureText(text).width;
          const left = align === 'center' ? x - size / 2 : align === 'right' ? x - size : x;
          c.fillStyle = theme.ground;
          c.fillRect(left - 4, y - 13, size + 8, 18);
          c.fillStyle = theme.text;
          c.fillText(text, x, y);
        };
        c.font = `22px "${theme.fontDisplay}", sans-serif`;
        label('Stereo glass', 18, 30);
        c.font = `11px "${theme.fontMono}", monospace`;
        label('GLASS = MEASURED · MASTER L/R', 18, 54);
        label('RIM = SCORED · PAN + ONSETS', box.wide ? box.legendX : 18, box.wide ? 54 : 73);
        label(
          `bar ${String(Math.floor(frame.now) + 1)} · ${String(Math.floor((frame.now % 1) * 100))}%`,
          w - 18,
          30,
          'right',
        );
        label(
          measured
            ? `${measured.mono ? 'MONO · upright' : 'STEREO'} · ${measured.durationMs.toFixed(0)} ms span · ${String(measured.samples)} samples`
            : 'NO MEASUREMENT',
          box.wide ? box.legendX : 18,
          box.wide ? 79 : 99,
        );
        label(
          measured
            ? `L/R ρ ${measured.correlation?.toFixed(3) ?? '—'} · ΔS ${measured.width.toFixed(3)}`
            : !frame.playing
              ? 'Paused · scored rim remains'
              : 'Waiting for a complete stereo tap',
          box.wide ? box.legendX : 18,
          box.wide ? 99 : 118,
        );
        label('M · L+R', cx, cy + r - 16, 'center');
        label('S', cx + r + 18, cy + 4, 'center');
        const diagonal = (r + box.stack + 22) / Math.SQRT2;
        label('L', cx - diagonal, cy - diagonal, 'center');
        label('R', cx + diagonal, cy - diagonal, 'center');
        if (!measured) {
          label('NO MEASUREMENT', cx, cy - 9, 'center');
          label('rim = score only', cx, cy + 12, 'center');
        }
        const defaults = new Set(
          ticks.filter((t) => t.source === 'default').map((t) => t.instrument.id),
        ).size;
        const unknown = ticks.filter((t) => t.source === 'unknown').length;
        const onsets = ticks.reduce((n, t) => n + t.onsets, 0),
          count = ticks.reduce((n, t) => n + t.count, 0);
        const legendY = box.wide ? 138 : h - 126;
        const legendX = box.wide ? box.legendX : 18;
        label(
          `SCORED · ${String(frame.instruments.length)} parts · ${String(ticks.length)} ticks`,
          legendX,
          legendY,
        );
        label(
          `${String(onsets)} lit onsets · ${String(ticks.reduce((n, t) => n + t.held, 0))} held spans`,
          legendX,
          legendY + 20,
        );
        label(
          `${String(defaults)} default centre .5${unknown ? ` · ${String(unknown)} unknown` : ''}`,
          legendX,
          legendY + 40,
        );
        if (box.wide) {
          const capacity = Math.max(0, Math.floor((h - legendY - 140) / 24));
          const visible = ticks.slice(0, capacity);
          visible.forEach((tick, i) => {
            c.fillStyle = tick.instrument.colour;
            c.fillRect(legendX, legendY + 59 + i * 24, 7, 7);
            const suffix = ` · ${tick.source === 'default' ? 'default .5' : tick.source === 'unknown' ? '?' : tick.pan.toFixed(2)} · ${String(tick.count)}`;
            const name = fit(
              c,
              tick.instrument.name,
              box.legendWidth - 43 - c.measureText(suffix).width,
            );
            label(`${name}${suffix}`, legendX + 17, legendY + 66 + i * 24);
          });
          if (ticks.length > visible.length)
            label(
              `+${String(ticks.length - visible.length)} ticks counted`,
              legendX,
              legendY + 66 + visible.length * 24,
            );
        }
        label(
          `${String(count)} score spans · ${String(marks.reduce((n, m) => n + m.ticks - 1, 0))} merged ticks`,
          18,
          h - 48,
        );
        label(
          measured
            ? `MEASURED · ${String(measured.offGlass)} off glass · lag ${measured.lagMs.toFixed(1)} ms`
            : 'MEASURED · no PCM drawn',
          18,
          h - 29,
        );
        label('Current span only · no history · fixed scale', 18, h - 10);
      },
      dispose() {
        canvas.remove();
        canvas.width = canvas.height = 0;
      },
    };
  },
};
export default view;
