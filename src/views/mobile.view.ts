import type { ViewDefinition, ViewFrame } from './types';
import {
  areaFactor,
  areaUnit,
  indexMobile,
  mobileArms,
  mobileLayout,
  mobileWindow,
  reorder,
  supportTree,
  swingReach,
  tiltName,
} from './mobile/model';
import type { Arm, MobileLayout, MobileScore, Shape } from './mobile/model';

function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  while (text && ctx.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return text ? `${text}…` : '';
}
function line(ctx: CanvasRenderingContext2D, x: number, y: number, endX: number, endY: number) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(endX, endY);
  ctx.stroke();
}
function circle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
function shape(ctx: CanvasRenderingContext2D, kind: Shape, r: number) {
  ctx.beginPath();
  if (kind === 'bead') ctx.arc(0, 0, r, 0, Math.PI * 2);
  else if (kind === 'crystal') {
    ctx.moveTo(0, -2 * r);
    ctx.lineTo(r, -r);
    ctx.lineTo(r, r);
    ctx.lineTo(0, 2 * r);
    ctx.lineTo(-r, r);
    ctx.lineTo(-r, -r);
    ctx.closePath();
  } else {
    ctx.moveTo(0, -1.4 * r);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, 1.4 * r);
    ctx.lineTo(-r, 0);
    ctx.closePath();
  }
}
function draw(
  ctx: CanvasRenderingContext2D,
  frame: ViewFrame,
  arms: Arm[],
  box: MobileLayout,
  dragging?: string,
) {
  const { width, height, theme } = frame;
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, 0, width, height);
  const light = ctx.createRadialGradient(
    width * 0.45,
    box.armY,
    0,
    width / 2,
    box.armY,
    Math.max(width, height) * 0.65,
  );
  light.addColorStop(0, theme.panel);
  light.addColorStop(1, theme.ground);
  ctx.fillStyle = light;
  ctx.fillRect(0, 65, width, box.bottom - 65);
  const tree = supportTree(box, arms.length);
  ctx.strokeStyle = theme.muted;
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  // A curled top hook and real nested rods, with a ring at each pivot.
  ctx.beginPath();
  ctx.moveTo(tree.root.x, 57);
  ctx.lineTo(tree.root.x, 62);
  ctx.arc(tree.root.x - 5, 62, 5, 0, Math.PI * 1.5);
  ctx.stroke();
  line(ctx, tree.root.x, 67, tree.root.x, tree.root.y);
  for (const rod of tree.rods) {
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = 1;
    for (const child of rod.children) line(ctx, child.x, rod.y, child.x, child.y);
    ctx.strokeStyle = theme.text;
    ctx.lineWidth = 1.6;
    line(ctx, rod.left - 7, rod.y, rod.right + 7, rod.y);
    ctx.fillStyle = theme.ground;
    circle(ctx, rod.x, rod.y, 3);
  }
  const unit = areaUnit(arms, box);
  const counts: { x: number; y: number; text: string; width: number }[] = [];
  arms.forEach((arm, i) => {
    const part = frame.instruments.find((p) => p.id === arm.id);
    const colour = part?.colour ?? theme.accent;
    const x = box.centers[i],
      y = box.armYs[i];
    const slope = Math.tan(arm.tilt);
    // The rods tilt, not the suspension wires. Each leaf owns a disjoint bay.
    ctx.strokeStyle = theme.text;
    ctx.lineWidth = dragging === arm.id ? 4 : 3;
    line(ctx, x - box.half, y - box.half * slope, x + box.half, y + box.half * slope);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    line(ctx, x - box.half, y - box.half * slope, x + box.half, y + box.half * slope);
    ctx.fillStyle = theme.ground;
    ctx.strokeStyle = theme.text;
    ctx.lineWidth = 1.5;
    circle(ctx, x, y, 4);
    for (const w of arm.weights) {
      const at = x + w.position * box.half,
        attachY = y + w.position * box.half * slope;
      const r = Math.sqrt((w.mass * unit) / areaFactor(arm.shape));
      // Bound the analytic swing by the bay and adjacent weights.
      const dx = w.swing * swingReach(arm, w, box, r);
      const cy = attachY + box.hang + box.maxRadius * 2.2;
      ctx.globalAlpha = part?.muted ? 0.25 : w.passed ? 0.92 : 0.32;
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 1;
      ctx.setLineDash(w.passed ? [] : [3, 4]);
      line(
        ctx,
        at,
        attachY,
        at + dx,
        cy - (arm.shape === 'crystal' ? 2 : arm.shape === 'leaf' ? 1.4 : 1) * r,
      );
      ctx.setLineDash([]);
      ctx.save();
      ctx.translate(at + dx, cy);
      const glaze = ctx.createLinearGradient(-r, -r * 2, r, r * 2);
      glaze.addColorStop(0, theme.text);
      glaze.addColorStop(0.26, colour);
      glaze.addColorStop(1, colour);
      ctx.fillStyle = glaze;
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = 0.65;
      ctx.shadowColor = theme.line;
      ctx.shadowBlur = 7;
      ctx.shadowOffsetY = 3;
      shape(ctx, arm.shape, r);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.stroke();
      if (arm.shape === 'crystal' && r > 3) {
        ctx.globalAlpha *= 0.5;
        ctx.strokeStyle = theme.text;
        line(ctx, 0, -1.6 * r, 0, 1.6 * r);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      if (w.notes.length > 1)
        counts.push({
          x: at,
          y: box.bottom - 44,
          text: `×${String(w.notes.length)}`,
          width: (box.half * 2) / (box.slots - 1) - 2,
        });
    }
  });
  // Text always comes last, on solid token plates, clear of every swing envelope.
  ctx.font = `11px "${theme.fontMono}"`;
  ctx.textAlign = 'center';
  const label = (text: string, x: number, y: number, available: number) => {
    ctx.textAlign = 'center';
    const value = fit(ctx, text, available);
    if (!value) return;
    const w = ctx.measureText(value).width;
    ctx.fillStyle = theme.ground;
    ctx.fillRect(x - w / 2 - 3, y - 12, w + 6, 16);
    ctx.fillStyle = theme.text;
    ctx.fillText(value, x, y);
  };
  for (const count of counts)
    if (ctx.measureText(count.text).width <= count.width)
      label(count.text, count.x, count.y, count.width);
  arms.forEach((arm, i) => {
    const part = frame.instruments.find((p) => p.id === arm.id);
    if (box.bay >= 60) label(part?.name ?? arm.id, box.centers[i], box.bottom - 23, box.bay - 10);
    const count = String(arm.notes.length);
    const tilt =
      box.bay < 130
        ? Math.abs(arm.tilt) < 0.001
          ? 'level'
          : arm.tilt < 0
            ? 'L↓'
            : 'R↓'
        : tiltName(arm.tilt);
    label(box.bay < 70 ? count : `${count} · ${tilt}`, box.centers[i], box.bottom - 6, box.bay - 4);
  });
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.text;
  ctx.font = `22px "${theme.fontDisplay}"`;
  ctx.fillText('Mobile', 20, 29);
  ctx.font = `11px "${theme.fontMono}"`;
  const window = mobileWindow(frame),
    total = arms.reduce((n, a) => n + a.notes.length, 0);
  ctx.fillText(
    fit(
      ctx,
      `${String(total)} weights · bars ${String(window.from + 1)}–${String(window.to)} · onset → left to right`,
      width - 40,
    ),
    20,
    49,
  );
  ctx.textAlign = 'right';
  label(
    `bar ${String(Math.floor(frame.now) + 1)} · ${String(Math.round((frame.now % 1) * 100))}%`,
    width - 94,
    28,
    Math.max(0, width - 180),
  );
  const footerY = height - box.footer;
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, footerY, width, box.footer);
  ctx.strokeStyle = theme.line;
  line(ctx, 20, footerY, width - 20, footerY);
  ctx.textAlign = 'left';
  const rest = frame.instruments.filter((p) => !arms.some((a) => a.id === p.id));
  const lines =
    width < 700
      ? [
          'Crystals: low pitch · beads: short unpitched',
          'Leaves: others · area = span × gain',
          'Slots · dashed: ahead · ×: merged · L/R↓: dip',
          'Drag arm: reorder · double-click: reset',
          `${String(rest.length)} resting parts · ${String(arms.length)} arms`,
        ]
      : [
          'Crystals: low pitch · beads: short unpitched · leaves: others · area = span × gain',
          'Onset slots · dashed: ahead · ×: merged · drag arm: reorder · double-click: reset',
          `Resting (${String(rest.length)}): ${rest.map((p) => p.name).join(' · ') || 'none'}`,
        ];
  lines.forEach((text, i) => {
    ctx.fillStyle = theme.text;
    ctx.fillText(fit(ctx, text, width - 40), 20, footerY + 18 + i * 17);
  });
}
const mobile: ViewDefinition = {
  id: 'mobile',
  name: 'Mobile',
  group: 'show',
  tag: 'balance',
  needs: 'score',
  span: 'window',
  mount(element) {
    const canvas = document.createElement('canvas'),
      ctx = canvas.getContext('2d');
    if (!ctx) throw Error('Canvas 2D is unavailable');
    canvas.style.touchAction = 'none';
    element.append(canvas);
    let source: ViewFrame['notes'] | undefined,
      score: MobileScore | undefined,
      last: ViewFrame | undefined;
    let order: string[] = [],
      arms: Arm[] = [],
      box: MobileLayout | undefined;
    let drag: { id: string; pointer: number } | undefined;
    const paint = (frame: ViewFrame) => {
      if (frame.width <= 0 || frame.height <= 0) return;
      last = frame;
      if (source !== frame.notes) {
        source = frame.notes;
        score = indexMobile(source);
      }
      if (!score) return;
      arms = mobileArms(frame, score, order);
      box = mobileLayout(frame.width, frame.height, arms.length);
      arms = mobileArms(frame, score, order, box.slots);
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
      draw(ctx, frame, arms, box, drag?.id);
    };
    const point = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) * (last?.width ?? rect.width)) / rect.width,
        y: ((e.clientY - rect.top) * (last?.height ?? rect.height)) / rect.height,
      };
    };
    const down = (e: PointerEvent) => {
      if (!box || !last || e.button !== 0) return;
      const p = point(e),
        currentBox = box;
      const i = arms.findIndex(
        (a, n) =>
          Math.abs(p.x - currentBox.centers[n]) <= currentBox.half + 8 &&
          Math.abs(p.y - currentBox.armYs[n] - (p.x - currentBox.centers[n]) * Math.tan(a.tilt)) <=
            14,
      );
      if (i < 0) return;
      const ids = [...last.instruments].sort((a, b) => a.index - b.index).map((p) => p.id);
      order = [
        ...order.filter((id) => ids.includes(id)),
        ...ids.filter((id) => !order.includes(id)),
      ];
      drag = { id: arms[i].id, pointer: e.pointerId };
      canvas.setPointerCapture(e.pointerId);
      paint(last);
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointer || !box || !last) return;
      const p = point(e);
      const index = Math.max(0, Math.min(arms.length - 1, Math.floor((p.x - 20) / box.bay)));
      const target = arms[index]?.id;
      if (target && target !== drag.id) {
        order = reorder(order, drag.id, target);
        paint(last);
      }
    };
    const up = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      const pointer = drag.pointer;
      drag = undefined;
      if (canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
      if (last) paint(last);
    };
    const reset = () => {
      order = [];
      drag = undefined;
      if (last) paint(last);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    canvas.addEventListener('dblclick', reset);
    return {
      frame: paint,
      dispose() {
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up);
        canvas.removeEventListener('lostpointercapture', up);
        canvas.removeEventListener('dblclick', reset);
        if (drag && canvas.hasPointerCapture(drag.pointer))
          canvas.releasePointerCapture(drag.pointer);
        canvas.remove();
        canvas.width = canvas.height = 0;
        source = undefined;
        score = undefined;
        last = undefined;
        box = undefined;
        drag = undefined;
        arms = [];
        order = [];
      },
    };
  },
};
export default mobile;
