import type { ViewDefinition, ViewFrame } from './types';
import { cutoff, dancerLayout, indexDancer, poseAt, roleMembers, roles } from './dancer/model';
import type { DancerScore, DancerState } from './dancer/model';

function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  while (text && ctx.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return text ? `${text}…` : '';
}
function path(ctx: CanvasRenderingContext2D, points: number[][], colour: string, width: number) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.stroke();
}
function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
function drawFigure(ctx: CanvasRenderingContext2D, frame: ViewFrame, state: DancerState) {
  const { theme } = frame,
    { pose, layers } = state;
  const colour = (role: string, fallback = theme.text) =>
    frame.instruments.find((i) =>
      layers.some(
        (l) => l.note.instrument === i.id && l.roles.includes(role as (typeof roles)[number]),
      ),
    )?.colour ?? fallback;
  const hip = pose.hips * 24,
    lean = pose.torso * 28;
  const chest = hip + lean,
    shoulder = 159,
    pelvis = 266;
  // Soft stage pool and shoe shadows anchor a solid, clothed figure.
  const pool = ctx.createRadialGradient(0, 236, 12, 0, 236, 220);
  pool.addColorStop(0, theme.panel);
  pool.addColorStop(1, theme.ground);
  ctx.fillStyle = pool;
  ctx.fillRect(-300, 0, 600, 380);
  ctx.fillStyle = theme.line;
  ctx.beginPath();
  ctx.ellipse(0, 360, 119, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const side of [0, 1]) {
    const sign = side === 0 ? -1 : 1;
    const lift = pose.feet[side] * 28;
    const knee = [sign * 49 + hip * 0.35, 310 - lift * 0.35];
    const ankle = [sign * 77, 358 - lift];
    const leg = [[hip + sign * 20, pelvis], knee, ankle];
    path(ctx, leg, theme.text, 25);
    path(ctx, leg, colour('feet', theme.muted), 18);
    disc(ctx, knee[0], knee[1], 9, theme.panel);
    disc(ctx, knee[0], knee[1], 4, theme.text);
    path(ctx, [ankle, [sign * 96, 360 - lift]], theme.text, 20);
    path(
      ctx,
      [
        [sign * 74, 369 - lift],
        [sign * 104, 369 - lift],
      ],
      theme.panel,
      5,
    );
  }
  // Tailored torso, waist band and pelvis: volumes instead of a line skeleton.
  ctx.fillStyle = theme.panel;
  ctx.strokeStyle = theme.text;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(chest - 38, shoulder);
  ctx.quadraticCurveTo(chest, shoulder - 17, chest + 38, shoulder);
  ctx.lineTo(hip + 29, 242);
  ctx.quadraticCurveTo(hip, 254, hip - 29, 242);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  path(
    ctx,
    [
      [chest - 13, 173],
      [chest - 8, 222],
    ],
    theme.line,
    3,
  );
  ctx.fillStyle = colour('hips', theme.muted);
  ctx.beginPath();
  ctx.moveTo(hip - 30, 237);
  ctx.quadraticCurveTo(hip, 249, hip + 30, 237);
  ctx.lineTo(hip + 32, 268);
  ctx.quadraticCurveTo(hip, 283, hip - 32, 268);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  path(
    ctx,
    [
      [hip - 25, 246],
      [hip + 25, 246],
    ],
    theme.text,
    4,
  );
  for (const side of [0, 1]) {
    const sign = side === 0 ? -1 : 1;
    const snap = pose.hands[side];
    const elbow = [chest + sign * 72, 222 - pose.arms * 79];
    const wrist = [chest + sign * (108 + snap * 9), 248 - pose.arms * 162 - snap * 17];
    path(ctx, [[chest + sign * 35, shoulder + 4], elbow, wrist], theme.text, 21);
    path(ctx, [[chest + sign * 35, shoulder + 4], elbow, wrist], colour('arms', theme.muted), 15);
    disc(ctx, elbow[0], elbow[1], 7, theme.panel);
    disc(ctx, elbow[0], elbow[1], 3, theme.text);
    disc(ctx, wrist[0], wrist[1], 12, theme.text);
    disc(ctx, wrist[0], wrist[1], 8, colour('hands', theme.muted));
    // Separated fingers and short accent rays make the snap legible.
    for (let finger = -1; finger <= 1; finger++) {
      path(
        ctx,
        [
          [wrist[0] + finger * 5, wrist[1] - 6],
          [wrist[0] + finger * 8, wrist[1] - 15 - snap * 7],
        ],
        theme.text,
        3,
      );
      if (snap > 0) {
        ctx.globalAlpha = snap;
        path(
          ctx,
          [
            [wrist[0] + finger * 13, wrist[1] - 27],
            [wrist[0] + finger * 17, wrist[1] - 34],
          ],
          colour('hands'),
          2,
        );
        ctx.globalAlpha = 1;
      }
    }
  }
  const headY = 110 + pose.head * 9;
  path(
    ctx,
    [
      [chest, shoulder - 5],
      [chest, headY + 20],
    ],
    theme.text,
    15,
  );
  ctx.save();
  ctx.translate(chest, headY);
  ctx.rotate(pose.head * 0.1);
  ctx.fillStyle = theme.text;
  ctx.beginPath();
  ctx.ellipse(0, 0, 28, 33, 0, 0, Math.PI * 2);
  ctx.fill();
  path(
    ctx,
    [
      [-25, -13],
      [-15, -27],
      [5, -31],
      [25, -14],
    ],
    colour('head', theme.muted),
    8,
  );
  path(
    ctx,
    [
      [-14, 1],
      [-7, 3],
    ],
    theme.ground,
    3,
  );
  path(
    ctx,
    [
      [8, 3],
      [15, 1],
    ],
    theme.ground,
    3,
  );
  ctx.strokeStyle = theme.ground;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(1, 10, 10, 0.3, Math.PI - 0.3);
  ctx.stroke();
  ctx.restore();
}
function draw(ctx: CanvasRenderingContext2D, frame: ViewFrame, score: DancerScore) {
  const { width, height, theme, now } = frame;
  const box = dancerLayout(width, height),
    state = poseAt(score, now, new Set(frame.instruments.filter((i) => i.muted).map((i) => i.id)));
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.translate(box.x, box.y);
  ctx.scale(box.scale, box.scale);
  drawFigure(ctx, frame, state);
  // Twenty-four fixed perspective cells. A cell keeps all coincident note marks.
  const tileText: { x: number; y: number; count: number }[] = [];
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 8; col++) {
      const id = row * 8 + col,
        tile = state.tiles.get(id) ?? [];
      const a = 0.64 + row * 0.15,
        b = a + 0.15;
      const x = (col - 4) * 71,
        y = 382 + row * 15;
      ctx.fillStyle = tile.length
        ? (frame.instruments.find((i) => i.id === tile[0].note.instrument)?.colour ?? theme.accent)
        : theme.panel;
      ctx.strokeStyle = theme.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x * a, y);
      ctx.lineTo((x + 69) * a, y);
      ctx.lineTo((x + 69) * b, y + 14);
      ctx.lineTo(x * b, y + 14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (tile.length)
        tileText.push({ x: ((x + 35) * (a + b)) / 2, y: y + 10, count: tile.length });
    }
  ctx.restore();
  // All text is drawn last, outside the moving figure, using text on ground or
  // text on a ground plate. Instrument ink never serves as label ink.
  ctx.textAlign = 'center';
  ctx.fillStyle = theme.text;
  ctx.font = `21px "${theme.fontDisplay}"`;
  ctx.fillText(`ONE BODY · ${String(state.sounding)} PARTS SOUNDING`, width / 2, 29);
  ctx.font = `11px "${theme.fontMono}"`;
  const sectionLength = frame.sections.at(-1)?.to ?? 0;
  const cycle = sectionLength ? now % sectionLength : now;
  const section = frame.sections.find((s) => s.from <= cycle && cycle < s.to)?.name;
  ctx.fillText(
    `${section ? section + ' · ' : ''}bar ${String(Math.floor(now) + 1)} · ${String(Math.round((now % 1) * 100))}% · ${String(state.layers.length)} scored notes`,
    width / 2,
    50,
  );
  for (const tile of box.scale >= 0.95 ? tileText : []) {
    const x = box.x + tile.x * box.scale,
      y = box.y + tile.y * box.scale;
    const text = String(tile.count),
      w = ctx.measureText(text).width + 6;
    ctx.fillStyle = theme.ground;
    ctx.fillRect(x - w / 2, y - 10, w, 13);
    ctx.fillStyle = theme.text;
    ctx.fillText(text, x, y);
  }
  const start = height - box.footer;
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, start, width, box.footer);
  ctx.textAlign = 'left';
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1;
  path(
    ctx,
    [
      [16, start],
      [width - 16, start],
    ],
    theme.line,
    1,
  );
  const cols = box.compact ? 2 : 3,
    cellWidth = (width - 32) / cols;
  const names = new Map(frame.instruments.map((i) => [i.id, i.name]));
  const labels = {
    feet: 'FEET',
    head: 'HEAD',
    hands: 'HANDS',
    hips: 'HIPS',
    arms: 'CUTOFF → ARMS',
    torso: 'PAN → LEAN',
  };
  roles.forEach((role, i) => {
    const activeIds = new Set(
      state.layers.filter((l) => l.roles.includes(role)).map((l) => l.note.instrument),
    );
    const members = roleMembers(score, frame, role).sort(
        (a, b) => Number(activeIds.has(b)) - Number(activeIds.has(a)),
      ),
      active = state.counts[role];
    const x = 16 + (i % cols) * cellWidth,
      y = start + 18 + Math.floor(i / cols) * 28;
    ctx.fillStyle = theme.text;
    const summary = members.length
      ? `${names.get(members[0]) ?? members[0]}${members.length > 1 ? ` +${String(members.length - 1)}` : ''}`
      : 'absent · neutral';
    ctx.fillText(fit(ctx, `${labels[role]} ${String(active)} · ${summary}`, cellWidth - 10), x, y);
  });
  ctx.fillStyle = theme.text;
  const extra = state.layers.filter((l) => !l.roles.length).length;
  const line = `${String(state.layers.length)} floor marks · ${String(extra)} tile-only · ${String(state.layers.length - state.tiles.size)} merged`;
  ctx.fillText(fit(ctx, line, width - 32), 16, height - 25);
  const filters = [
    ...new Set(state.layers.map((l) => cutoff(l.note)).filter((v) => v !== undefined)),
  ];
  const sampled =
    filters.length === 1
      ? `cutoff ${String(Math.round(filters[0]))} Hz, note-sampled`
      : filters.length
        ? `${String(filters.length)} note-sampled cutoffs`
        : 'no sounding cutoff';
  ctx.fillText(fit(ctx, `Rhythm-inferred drums · ${sampled}`, width - 32), 16, height - 9);
}
const dancer: ViewDefinition = {
  id: 'dancer',
  name: 'Dancer',
  group: 'show',
  tag: 'one body',
  needs: 'score',
  span: 'window',
  mount(element) {
    const canvas = document.createElement('canvas'),
      ctx = canvas.getContext('2d');
    if (!ctx) throw Error('Canvas 2D is unavailable');
    element.append(canvas);
    let notes: ViewFrame['notes'] | undefined, score: DancerScore | undefined;
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
        if (notes !== frame.notes) {
          score = indexDancer(frame.notes);
          notes = frame.notes;
        }
        if (score) draw(ctx, frame, score);
      },
      dispose() {
        canvas.remove();
        canvas.width = canvas.height = 0;
        notes = undefined;
        score = undefined;
      },
    };
  },
};
export default dancer;
