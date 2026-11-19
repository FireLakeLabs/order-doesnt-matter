import { createDriverOrbits, driverPhase, driverTicks, type DriverOrbit } from './orrery/drivers';
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
function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
}
function sphere(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  colour: string,
  light: string,
  shade: string,
  hollow = false,
) {
  const surface = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
  surface.addColorStop(0, light);
  surface.addColorStop(0.32, colour);
  surface.addColorStop(1, shade);
  ctx.fillStyle = hollow ? shade : surface;
  circle(ctx, x, y, r);
  ctx.fill();
}
function draw(
  ctx: CanvasRenderingContext2D,
  frame: ViewFrame,
  score: Orrery,
  drivers: DriverOrbit[],
) {
  const { width, height, theme, now } = frame;
  const box = orreryLayout(width, height, score.orbits.length + drivers.length * 2);
  const { cx, cy, radius, rx, sun, ledger } = box;
  const paper = theme.name === 'riso' || theme.name === 'pocket';
  const light = paper ? theme.ground : theme.text;
  const shade = paper ? theme.text : theme.line;
  const instruments = new Map(frame.instruments.map((i) => [i.id, i]));
  const sorted = [...score.orbits].sort(
    (a, b) =>
      (a.period ? a.period.n / a.period.d : Infinity) -
      (b.period ? b.period.n / b.period.d : Infinity),
  );
  // A circular mechanism seen obliquely: each bearing has a real track, arm,
  // upright and globe. Projection changes its shape, never its time or phase.
  const planets = sorted.flatMap((o, index) => {
    const i = instruments.get(o.id);
    if (!i) return [];
    const ratio = 0.26 + (0.74 * (index + 0.5)) / Math.max(1, sorted.length);
    const a = (o.period ? orbitPhase(o.period, now) : 0) * Math.PI * 2;
    const r = Math.max(box.narrow ? 5 : 6.5, Math.min(10, radius / 17));
    const x = cx + Math.sin(a) * rx * ratio,
      baseY = cy - Math.cos(a) * radius * ratio;
    return [
      {
        o,
        i,
        index,
        rx: rx * ratio,
        ry: radius * ratio,
        x,
        baseY,
        y: baseY - 13 - index * 0.35,
        r,
        rest: !i.inSection || i.muted,
      },
    ];
  });
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    8,
    68,
    box.narrow ? width - 16 : ledger.x - 18,
    Math.max(0, box.narrow ? ledger.y - 84 : height - 154),
  );
  ctx.clip();
  const baseY = cy + radius * 0.7,
    baseWidth = Math.min(92, rx * 0.25);
  ctx.fillStyle = theme.line;
  ctx.globalAlpha = 0.35;
  ellipse(ctx, cx + 8, baseY + 20, baseWidth + 25, 15);
  ctx.fill();
  ctx.globalAlpha = 1;
  const brass = ctx.createLinearGradient(cx - baseWidth, 0, cx + baseWidth, 0);
  brass.addColorStop(0, shade);
  brass.addColorStop(0.18, theme.accent);
  brass.addColorStop(0.4, light);
  brass.addColorStop(0.55, theme.accent);
  brass.addColorStop(1, shade);
  // Pedestal, flywheel and central spindle, beneath the rotating arms.
  ctx.fillStyle = brass;
  ctx.strokeStyle = shade;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(cx - baseWidth, baseY - 2, baseWidth * 2, 17, 3);
  ctx.fill();
  ctx.stroke();
  ellipse(ctx, cx, baseY - 2, baseWidth, 13);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = theme.panel;
  ellipse(ctx, cx, baseY - 4, baseWidth - 10, 8);
  ctx.fill();
  const sunY = cy - sun - 22;
  ctx.fillStyle = brass;
  ctx.beginPath();
  ctx.roundRect(cx - 10, sunY + sun - 8, 20, baseY - sunY - sun + 8, 3);
  ctx.fill();
  ctx.stroke();
  const wheelY = baseY - 14;
  ctx.beginPath();
  for (let tooth = 0; tooth < 96; tooth++) {
    const a = (tooth / 96) * Math.PI * 2 + now * Math.PI * 2;
    const size = tooth % 4 < 2 ? 1 : 0.91;
    const x = cx + Math.cos(a) * (baseWidth * 0.72) * size,
      y = wheelY + Math.sin(a) * 12 * size;
    if (!tooth) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = shade;
  ellipse(ctx, cx, wheelY, baseWidth * 0.4, 6);
  ctx.stroke();
  ctx.fillStyle = light;
  circle(
    ctx,
    cx + Math.cos(now * Math.PI * 2) * baseWidth * 0.52,
    wheelY + Math.sin(now * Math.PI * 2) * 8,
    2,
  );
  ctx.fill();
  for (const p of planets) {
    ctx.setLineDash(p.o.period ? [] : [4, 5]);
    ctx.globalAlpha = p.rest ? 0.45 : 0.85;
    ctx.strokeStyle = shade;
    ctx.lineWidth = 4;
    ellipse(ctx, cx, cy + 3, p.rx, p.ry);
    ctx.stroke();
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ellipse(ctx, cx, cy, p.rx, p.ry);
    ctx.stroke();
    ctx.strokeStyle = light;
    ctx.globalAlpha = p.rest ? 0.14 : 0.3;
    ctx.lineWidth = 0.65;
    ellipse(ctx, cx, cy - 1, p.rx, p.ry);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = p.rest ? 0.5 : 1;
    ctx.fillStyle = p.i.colour;
    for (const m of orbitMarks(p.o, p.ry)) {
      const a = m.phase * Math.PI * 2;
      circle(ctx, cx + Math.sin(a) * p.rx, cy - Math.cos(a) * p.ry, m.count > 1 ? 3 : 1.8);
      ctx.fill();
    }
  }
  const ordered = [...planets].sort((a, b) => a.y - b.y || a.index - b.index);
  for (const p of ordered) {
    const hubY = cy - 9 - p.index * 0.7;
    ctx.globalAlpha = p.rest ? 0.4 : 1;
    ctx.lineCap = 'round';
    ctx.strokeStyle = shade;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(cx, hubY);
    ctx.lineTo(p.x, p.baseY - 8);
    ctx.stroke();
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, hubY);
    ctx.lineTo(p.x, p.baseY - 8);
    ctx.stroke();
    ctx.strokeStyle = light;
    ctx.globalAlpha = p.rest ? 0.16 : 0.4;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(cx, hubY - 1);
    ctx.lineTo(p.x, p.baseY - 9);
    ctx.stroke();
    ctx.globalAlpha = p.rest ? 0.45 : 1;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.baseY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.fillStyle = brass;
    ellipse(ctx, p.x, p.baseY, 4, 2);
    ctx.fill();
    ctx.fillStyle = theme.panel;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1;
    circle(ctx, cx, hubY, 5);
    ctx.fill();
    ctx.stroke();
  }
  const paintPlanet = (p: (typeof ordered)[number]) => {
    ctx.save();
    ctx.globalAlpha = p.rest ? 0.65 : 1;
    sphere(
      ctx,
      p.x,
      p.y,
      p.r,
      p.i.colour,
      light,
      p.rest || !p.o.period ? theme.ground : shade,
      p.rest || !p.o.period,
    );
    ctx.strokeStyle = p.o.period ? p.i.colour : theme.text;
    ctx.lineWidth = 1.5;
    circle(ctx, p.x, p.y, p.r);
    ctx.stroke();
    ctx.strokeStyle = theme.text;
    ctx.lineWidth = 0.65;
    circle(ctx, p.x, p.y, p.r + 1);
    ctx.stroke();
    const moons = drivers.filter((moon) => moon.instrument === p.i.id);
    moons.forEach((moon, index) => {
      const state = driverPhase(moon, now);
      const known = moon.status === 'known';
      const radius = p.r + 12 + index * 9;
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = 1;
      ctx.setLineDash(known ? [] : [3, 3]);
      ellipse(ctx, p.x, p.y, radius, radius * 0.65);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const tick of driverTicks(moon)) {
        const angle = tick * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(
          p.x + Math.sin(angle) * (radius - 3),
          p.y - Math.cos(angle) * (radius * 0.65 - 3),
        );
        ctx.lineTo(
          p.x + Math.sin(angle) * (radius + 3),
          p.y - Math.cos(angle) * (radius * 0.65 + 3),
        );
        ctx.stroke();
      }
      const angle = (state?.phase ?? 0) * Math.PI * 2;
      const x = p.x + Math.sin(angle) * radius;
      const y = p.y - Math.cos(angle) * radius * 0.65;
      ctx.fillStyle = known ? p.i.colour : theme.ground;
      circle(ctx, x, y, 3.5);
      ctx.fill();
      ctx.setLineDash(known ? [] : [2, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
    });
    ctx.restore();
  };
  ctx.globalAlpha = 1;
  for (const p of ordered) if (p.y < sunY) paintPlanet(p);
  // The sun is a globe on the spindle, with one-bar rotating rays.
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 1.5;
  for (let ray = 0; ray < 16; ray++) {
    const a = (ray / 16) * Math.PI * 2 + now * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (sun + 5), sunY + Math.sin(a) * (sun + 5));
    ctx.lineTo(cx + Math.cos(a) * (sun + 10), sunY + Math.sin(a) * (sun + 10));
    ctx.stroke();
  }
  const phase = alignment(score.common, now);
  if (phase && phase.flash > 0) {
    ctx.globalAlpha = phase.flash * 0.75;
    ctx.lineWidth = 2.5;
    circle(ctx, cx, sunY, sun + 13 + (1 - phase.flash) * 18);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  sphere(ctx, cx, sunY, sun, theme.accent, light, shade);
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  circle(ctx, cx, sunY, sun);
  ctx.stroke();
  for (const p of ordered) if (p.y >= sunY) paintPlanet(p);
  ctx.restore();
  // Text is opaque, uses the high-contrast text token, and is drawn after all motion.
  ctx.fillStyle = theme.text;
  ctx.textAlign = 'left';
  ctx.font = `11px "${theme.fontMono}"`;
  ctx.fillText('1 BAR SUN · NOTE-PATTERN ORBITS', 16, 30);
  ctx.fillText(
    fit(
      ctx,
      `OBSERVED OVER ${String(frame.to - frame.from)} BARS · ${String(score.orbits.length)} PARTS`,
      width - 32,
    ),
    16,
    54,
  );
  ctx.textAlign = 'right';
  ctx.fillText(
    `bar ${String(Math.floor(now) + 1)} · ${String(Math.round((now - Math.floor(now)) * 100))}%`,
    width - 16,
    29,
  );
  ctx.textAlign = 'left';
  ctx.fillText('ORBIT KEY', ledger.x, ledger.y);
  const ledgerOrbits = [...score.orbits].sort(
    (a, b) =>
      Number(instruments.get(b.id)?.inSection) - Number(instruments.get(a.id)?.inSection) ||
      Number(Boolean(a.period)) - Number(Boolean(b.period)),
  );
  const driverRows = Math.min(
    drivers.length,
    Math.max(0, Math.floor((height - 119 - ledger.y) / 52)),
  );
  drivers.slice(0, driverRows).forEach((moon, index) => {
    const y = ledger.y + 23 + index * 52;
    const state = driverPhase(moon, now);
    const i = instruments.get(moon.instrument);
    const status =
      moon.status === 'pending'
        ? 'pending'
        : moon.status === 'unknown'
          ? 'unknown'
          : state
            ? `${periodText(state.period)}-cycle loop`
            : `${periodText(moon.period)} local-cycle loop · rest`;
    ctx.fillText(
      fit(ctx, `${i?.name ?? 'part'} · ${moon.setting} rate ${moon.notation}`, ledger.width),
      ledger.x,
      y,
    );
    ctx.fillText(
      fit(
        ctx,
        `${status}${state ? ` · ${String(state.rate)} now · ${String(driverTicks(moon).length)} ticks` : ''}`,
        ledger.width,
      ),
      ledger.x,
      y + 20,
    );
  });
  const driverOffset = driverRows * 52;
  const shown = Math.max(0, box.shown - driverRows * 2);
  const visible = ledgerOrbits.slice(0, shown);
  visible.forEach((o, n) => {
    const i = instruments.get(o.id);
    if (!i) return;
    const y = ledger.y + 23 + driverOffset + n * 26;
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
  if (score.orbits.length > shown || drivers.length > driverRows) {
    const hidden = ledgerOrbits.slice(shown);
    const marks = hidden.reduce((sum, o) => sum + o.marks.reduce((n, m) => n + m.count, 0), 0);
    const seen = hidden.filter((o) => !o.period).reduce((sum, o) => sum + o.observed, 0);
    ctx.fillText(
      fit(
        ctx,
        `+${String(score.orbits.length - shown)} parts${drivers.length > driverRows ? ` · ${String(drivers.length - driverRows)} drivers` : ''} · ${String(marks)} marks · ${String(seen)} seen`,
        ledger.width,
      ),
      ledger.x,
      ledger.y + 23 + driverOffset + shown * 26,
    );
  }
  const y = height - 65;
  const next = alignment(score.common, now);
  ctx.fillStyle = theme.panel;
  ctx.fillRect(0, y - 18, width, 83);
  ctx.fillStyle = theme.text;
  const label = score.complete
    ? 'PHASE ALIGNMENT'
    : `KNOWN PHASES (${String(score.orbits.filter((o) => o.period).length)} of ${String(score.orbits.length)})`;
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
    fit(ctx, 'Note orbits: pitch/sample/span. Moons: driver rate, one lap/loop.', width - 32),
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
  structure: true,
  mount(element) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw Error('Canvas 2D is unavailable');
    element.append(canvas);
    const drivers = createDriverOrbits();
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
        draw(ctx, frame, score, drivers.get(frame));
      },
      dispose() {
        drivers.dispose();
        canvas.remove();
      },
    };
  },
};
export default view;
