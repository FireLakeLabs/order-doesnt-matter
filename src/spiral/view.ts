import { liveModel, turnNotes, type LiveInput, type TurnNote } from '../live/model';
import {
  opacityAt,
  laneGeometry,
  spiralMarks,
  type SpiralMark,
  type Size,
  readView,
  saveView,
  defaultView,
  type ViewSettings,
} from './model';
import { livePlayhead } from '../live/playhead';
import './style.css';
export type SpiralInput = LiveInput & { known: [number, number][]; end: number | null };
const colour = (lane: number) => `hsl(${(lane * 67 + 155) % 360} 65% 75%)`;
function silencedAt(input: SpiralInput, lane: number, cycle: number) {
  const row = input.rows[lane];
  if (row.muted || row.pattern.muted || (input.solo !== null && input.solo !== row.id)) return true;
  if (!row.uses.some((u) => u.muted)) return false;
  const last = input.sections.at(-1),
    length = last ? last.start + last.cycles : 0;
  const local = length ? Math.max(0, cycle) % length : cycle;
  const section = input.sections.find((s) => local >= s.start && local < s.start + s.cycles);
  const uses = section ? row.uses.filter((u) => u.path.some((n) => n.id === section.id)) : row.uses;
  return uses.length > 0 && uses.every((u) => u.muted);
}
/** CPU canvas submission only; callers measure this function, not frame intervals. */
export function drawSpiral(
  canvas: HTMLCanvasElement,
  marks: SpiralMark[],
  input: SpiralInput,
  now: number,
  reduced: boolean,
  view: ViewSettings = defaultView,
) {
  const ctx = canvas.getContext('2d')!,
    width = canvas.clientWidth,
    height = canvas.clientHeight;
  const dpr = devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, (width * dpr) / 2, (height * dpr) / 2);
  ctx.clearRect(-width / 2, -height / 2, width, height);
  const g = laneGeometry(input.rows.length, { width, height }, view);
  const motion = reduced ? Math.floor(now) : now;
  const path = (from: number, to: number, r1: number, r2: number, begin = true) => {
    if (begin) ctx.beginPath();
    const steps = Math.max(1, Math.ceil((to - from) * 8));
    const angle = (from - motion) * 2 * Math.PI - Math.PI / 2;
    let c = Math.cos(angle),
      s = Math.sin(angle),
      r = r1;
    ctx.moveTo(c * r, s * r);
    for (let j = 1; j <= steps; j++) {
      const f = j / steps,
        next = (from + (to - from) * f - motion) * 2 * Math.PI - Math.PI / 2;
      const nc = Math.cos(next),
        ns = Math.sin(next),
        nr = r1 + (r2 - r1) * f;
      const h = ((to - from) * 2 * Math.PI) / steps,
        tangent = (4 / 3) * Math.tan(h / 4),
        radial = (nr - r) / 3;
      ctx.bezierCurveTo(
        c * (r + radial) - s * r * tangent,
        s * (r + radial) + c * r * tangent,
        nc * (nr - radial) + ns * nr * tangent,
        ns * (nr - radial) - nc * nr * tangent,
        nc * nr,
        ns * nr,
      );
      c = nc;
      s = ns;
      r = nr;
    }
  };
  ctx.lineCap = 'butt';
  // Unasked stretches have cross bars as well as a distinct dashed track.
  for (
    let turn = Math.max(0, Math.floor(now) - Math.ceil(view.keep));
    turn < Math.floor(now) + view.upcoming + 1;
    turn++
  ) {
    const known = input.known.some(([from, to]) => from <= turn && to >= turn + 1);
    ctx.globalAlpha = known ? 0.22 : 0.65;
    ctx.strokeStyle = known ? '#637383' : '#c6b88b';
    ctx.lineWidth = known ? 0.6 : 1;
    ctx.setLineDash(known ? [] : [3, 5]);
    const r1 = g.core + g.pitch * (turn - motion + view.keep + 1),
      r2 = r1 + g.pitch;
    path(turn, turn + 1, r1, r2);
    ctx.stroke();
    if (!known)
      for (let b = 0; b < 16; b++) {
        const t = turn + b / 16,
          a = (t - motion) * Math.PI * 2 - Math.PI / 2,
          r = g.core + g.pitch * (t - motion + view.keep + 1);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * (r - 3), Math.sin(a) * (r - 3));
        ctx.lineTo(Math.cos(a) * (r + g.pitch), Math.sin(a) * (r + g.pitch));
        ctx.stroke();
      }
  }
  const lanes = liveModel(input).instruments;
  // Submit one path per lane/turn rather than one canvas stroke per note.
  const groups = new Map<number, { marks: SpiralMark[]; silenced: boolean }>(),
    base = Math.floor(now);
  for (const m of marks) {
    if (m.opacity <= 0 || m.turn < base - Math.ceil(view.keep) || m.turn > base + view.upcoming)
      continue;
    const silenced = silencedAt(input, m.lane, m.from);
    const key = m.lane * 16 + (m.turn - base + 2) * 2 + Number(silenced);
    const group = groups.get(key);
    if (group) group.marks.push(m);
    else groups.set(key, { marks: [m], silenced });
  }
  for (const { marks: group, silenced } of groups.values()) {
    const m = group[0],
      lane = lanes[m.lane];
    ctx.globalAlpha = m.opacity;
    ctx.strokeStyle = lane.error ? '#ffaaaa' : colour(m.lane);
    ctx.setLineDash(lane.error ? [1, 3] : lane.sound === 'missing' ? [3, 3] : []);
    ctx.lineWidth = m.width;
    ctx.beginPath();
    for (const span of group) path(span.from, span.bodyTo, span.radius, span.bodyEndRadius, false);
    ctx.stroke();
    if (silenced) {
      ctx.strokeStyle = '#101820';
      ctx.lineWidth = m.width * 0.55;
      ctx.setLineDash([]);
      ctx.stroke();
    }
    // A head crosses the band width at the exact onset, without stretching time.
    ctx.globalAlpha = m.opacity;
    ctx.strokeStyle = '#f5fafc';
    ctx.lineWidth = Math.max(1, m.width * 0.22);
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const span of group)
      if (span.onset) {
        const angle = (span.from - motion) * Math.PI * 2 - Math.PI / 2;
        const c = Math.cos(angle),
          s = Math.sin(angle),
          half = span.width / 2;
        ctx.moveTo(c * (span.radius - half), s * (span.radius - half));
        ctx.lineTo(c * (span.radius + half), s * (span.radius + half));
      }
    ctx.stroke();
    if (!reduced && !silenced && !lane.error)
      for (const span of group) {
        if (!span.onset || now < span.start || now - span.start >= 0.07) continue;
        ctx.globalAlpha = 1 - (now - span.start) / 0.07;
        ctx.fillStyle = colour(span.lane);
        ctx.beginPath();
        ctx.arc(
          Math.cos(span.startAngle) * span.radius,
          Math.sin(span.startAngle) * span.radius,
          Math.max(2, span.width),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
  }
  // Failed questions have no notes: mark their lane itself as broken.
  for (const lane of lanes)
    if (lane.error) {
      const r = g.core + g.pitch * (view.keep + 1) + (lane.colour + 1) * g.spacing;
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffaaaa';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      path(Math.floor(now), Math.floor(now) + 1, r, r + g.pitch);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(-4, -r - 4);
      ctx.lineTo(4, -r + 4);
      ctx.moveTo(4, -r - 4);
      ctx.lineTo(-4, -r + 4);
      ctx.stroke();
    }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.strokeStyle = '#f5fafc';
  ctx.lineWidth = 2;
  const gate = reduced ? (now - Math.floor(now)) * Math.PI * 2 - Math.PI / 2 : -Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(Math.cos(gate) * g.core, Math.sin(gate) * g.core);
  ctx.lineTo(
    Math.cos(gate) * g.pitch * (view.keep + view.upcoming + 2.7),
    Math.sin(gate) * g.pitch * (view.keep + view.upcoming + 2.7),
  );
  ctx.stroke();
  ctx.font = '600 13px system-ui';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f5fafc';
  ctx.fillText('Now', 0, -Math.min(width, height) / 2 + 18);
  if (input.end !== null && input.end >= now - view.keep && input.end <= now + view.upcoming + 1) {
    const a = (input.end - motion) * Math.PI * 2 - Math.PI / 2,
      r = g.core + g.pitch * (input.end - motion + view.keep + 1);
    ctx.fillText(
      'End · repeats',
      Math.max(-width / 2 + 55, Math.min(width / 2 - 55, Math.cos(a) * r + 18)),
      Math.max(-height / 2 + 14, Math.min(height / 2 - 14, Math.sin(a) * r)),
    );
  }
}
export function createSpiral(host: HTMLElement) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    'Spiral view of the piece; the Now list on the main page says the same in words',
  );
  const legend = document.createElement('ol');
  legend.className = 'spiral-legend';
  const status = document.createElement('p');
  status.className = 'spiral-status';
  const stage = document.createElement('div');
  stage.className = 'spiral-stage';
  stage.append(canvas, status);
  host.classList.add('spiral-view');
  const settings = readView();
  const controls = document.createElement('details');
  controls.className = 'spiral-controls';
  const summary = document.createElement('summary');
  summary.textContent = 'View';
  const options = document.createElement('div');
  options.className = 'spiral-options';
  controls.append(summary, options);
  let latest: SpiralInput | undefined;
  function populateControls() {
    for (const [key, words, min, max, step] of [
      ['keep', 'Keep what just played', 0.1, 2, 0.1],
      ['upcoming', "Show what's coming", 1, 4, 1],
    ] as const) {
      const label = document.createElement('label'),
        slider = document.createElement('input'),
        value = document.createElement('output');
      const caption = document.createElement('span');
      caption.textContent = words;
      slider.type = 'range';
      slider.min = String(min);
      slider.max = String(max);
      slider.step = String(step);
      slider.value = String(settings[key]);
      slider.setAttribute('aria-label', words);
      const describe = () => {
        const n = settings[key];
        value.textContent =
          key === 'keep'
            ? n === 0.1
              ? 'Gone quickly'
              : `${n} ${n === 1 ? 'turn' : 'turns'}`
            : `${n} ${n === 1 ? 'turn' : 'turns'} · ${n < 2 ? 'fainter' : n > 2 ? 'brighter' : 'usual brightness'}`;
        slider.setAttribute('aria-valuetext', value.textContent);
      };
      slider.oninput = () => {
        settings[key] = Number(slider.value);
        describe();
        saveView(settings);
        paintedNotes = null;
        if (latest) update(latest);
      };
      describe();
      label.append(caption, value, slider);
      options.append(label);
    }
  }
  controls.addEventListener('toggle', () => {
    if (controls.open) {
      if (!options.childElementCount) populateControls();
    } else options.replaceChildren();
  });
  host.closest('dialog')?.addEventListener('close', () => {
    controls.open = false;
    options.replaceChildren();
  });
  stage.prepend(controls);
  host.append(stage, legend);
  let drawnCycle = 0,
    drawMs = 0,
    motionCycle = 0;
  let paintedNotes: TurnNote[] | null = null,
    paintedSize = { width: 0, height: 0 };
  let marks: SpiralMark[] = [],
    notes: TurnNote[] = [],
    previous: unknown,
    previousRows: unknown,
    previousRange = '',
    previousLegend = '';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  return {
    canvas,
    get drawMs() {
      return drawMs;
    },
    get cycle() {
      return drawnCycle;
    },
    get marks() {
      return marks;
    },
    update,
  };
  function update(input: SpiralInput) {
    latest = input;
    const now =
        livePlayhead(
          input.playhead,
          Object.values(input.events)[0]?.cps ?? 0,
          input.outputLatency,
        ) ?? input.fromCycle,
      first = Math.max(0, Math.floor(now) - Math.ceil(settings.keep)),
      last = Math.floor(now) + settings.upcoming + 1;
    const range = `${first}:${last}`;
    if (previous !== input.events || previousRows !== input.rows || previousRange !== range) {
      notes = turnNotes(input, -Infinity, last);
      previous = input.events;
      previousRows = input.rows;
      previousRange = range;
    }
    const size: Size = { width: canvas.clientWidth, height: canvas.clientHeight };
    const motion = reduced.matches ? Math.floor(now) : now;
    if (
      paintedNotes !== notes ||
      paintedSize.width !== size.width ||
      paintedSize.height !== size.height
    ) {
      marks = spiralMarks(
        notes,
        input.rows.map((r) => r.id),
        motion,
        size,
        settings,
      );
      paintedNotes = notes;
      paintedSize = size;
    } else {
      const delta = motion - motionCycle,
        radial = laneGeometry(input.rows.length, size, settings).pitch * delta;
      for (const mark of marks) {
        mark.startAngle -= delta * Math.PI * 2;
        mark.endAngle -= delta * Math.PI * 2;
        mark.radius -= radial;
        mark.endRadius -= radial;
        mark.bodyEndRadius -= radial;
      }
    }
    motionCycle = motion;
    for (const mark of marks) mark.opacity = opacityAt(mark.turn - now, settings);
    const start = performance.now();
    drawSpiral(canvas, marks, input, now, reduced.matches, settings);
    drawMs = performance.now() - start;
    drawnCycle = now;
    const lanes = liveModel(input).instruments,
      dense = new Set(marks.filter((m) => m.dense).map((m) => m.instrument));
    const words = lanes.map(
      (lane, n) =>
        `${n + 1}. ${lane.name}${lane.nameSource === 'generated' ? ' (generated)' : ''}${lane.error ? ` · broken: ${lane.error.replaceAll('$', '')}` : silencedAt(input, n, now) ? ' · muted' : ''}${lane.sound === 'missing' ? ' · missing' : lane.sound === 'loading' ? ' · loading' : lane.sound === 'not-loaded' ? ' · not loaded yet' : ''}${dense.has(lane.id) ? ' · dense: drawn in bins' : ''}`,
    );
    const key = JSON.stringify(words);
    if (key !== previousLegend) {
      previousLegend = key;
      legend.replaceChildren(
        ...words.map((word, n) => {
          const li = document.createElement('li');
          li.textContent = word;
          li.style.setProperty('--spiral-colour', colour(n));
          return li;
        }),
      );
    }
    const unknown = Array.from({ length: last - first }, (_, n) => first + n).some(
      (turn) => !input.known.some(([a, b]) => a <= turn && b >= turn + 1),
    );
    const text = unknown ? 'Striped stretches: not asked yet' : 'One turn · one cycle';
    if (status.textContent !== text) status.textContent = text;
  }
}
