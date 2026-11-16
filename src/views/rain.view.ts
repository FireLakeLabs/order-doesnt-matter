import type { ViewDefinition, ViewFrame } from './types';
import {
  indexNotes,
  landing,
  lanes,
  notePosition,
  project,
  roadScale,
  roadY,
} from './rain/geometry';
import type { Lane, RainEvent } from './rain/geometry';

function slab(
  ctx: CanvasRenderingContext2D,
  frame: ViewFrame,
  lane: Lane,
  event: RainEvent,
  from: number,
  to: number,
) {
  const laneWidth = lane.right - lane.left;
  const half = laneWidth * (event.pitch === undefined ? 0.3 : 0.16);
  const center = lane.left + laneWidth * (0.23 + 0.54 * notePosition(lane, event));
  const near = roadScale(frame, from);
  const far = roadScale(frame, to);
  const y = roadY(frame.height, near);
  const farY = Math.min(roadY(frame.height, far), y - 1);
  const origin = frame.width / 2;
  ctx.beginPath();
  ctx.moveTo(origin + (center - half - origin) * near, y);
  ctx.lineTo(origin + (center + half - origin) * near, y);
  // Subpixel notes still contribute occupancy; no event is discarded at high density.
  ctx.lineTo(origin + (center + half - origin) * far, farY);
  ctx.lineTo(origin + (center - half - origin) * far, farY);
  ctx.closePath();
}

export function drawRain(
  ctx: CanvasRenderingContext2D,
  frame: ViewFrame,
  groups = indexNotes(frame.notes),
) {
  const { width, height, now, lookAhead, theme } = frame;
  const lineY = height * 0.82;
  const road = lanes(frame, groups);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1;
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, 0, width, height);
  const edge = (x: number, cycle: number) => project(frame, x, cycle);
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  for (const lane of road) {
    const farL = edge(lane.left, now + lookAhead);
    const farR = edge(lane.right, now + lookAhead);
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.panel;
    ctx.beginPath();
    ctx.moveTo(lane.left, lineY);
    ctx.lineTo(lane.right, lineY);
    ctx.lineTo(farR.x, farR.y);
    ctx.lineTo(farL.x, farL.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = lane.instrument.colour;
    ctx.globalAlpha = lane.instrument.muted ? 0.07 : 0.18;
    line(lane.left, lineY, farL.x, farL.y);
    line(lane.right, lineY, farR.x, farR.y);
  }
  ctx.font = `11px "${theme.fontMono}"`;
  ctx.textAlign = 'right';
  for (let cycle = Math.ceil(now); cycle <= now + lookAhead; cycle++) {
    const left = edge(road[0]?.left ?? width * 0.05, cycle);
    const right = edge(road.at(-1)?.right ?? width * 0.95, cycle);
    ctx.strokeStyle = theme.muted;
    ctx.globalAlpha = 0.17;
    line(left.x, left.y, right.x, right.y);
    ctx.fillStyle = theme.muted;
    ctx.globalAlpha = 0.65;
    ctx.fillText(String(cycle + 1).padStart(2, '0'), left.x - 10, left.y + 4);
  }
  for (const section of frame.sections) {
    if (section.from < now || section.from > now + lookAhead) continue;
    const left = edge(road[0]?.left ?? width * 0.05, section.from);
    const right = edge(road.at(-1)?.right ?? width * 0.95, section.from);
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    line(left.x, left.y, right.x, right.y);
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.accent;
    ctx.fillText(section.name, left.x + 8, left.y - 8);
  }
  ctx.lineWidth = 1;
  for (const lane of road) {
    ctx.fillStyle = lane.instrument.colour;
    ctx.strokeStyle = theme.ground;
    const opacity = lane.instrument.muted ? 0.22 : 1;
    for (const event of lane.events) {
      const { note } = event;
      if (note.end <= now || note.start >= now + lookAhead) continue;
      const start = Math.max(now, note.start);
      const end = Math.min(now + lookAhead, note.end);
      ctx.globalAlpha =
        opacity * (note.hasOnset ? (event.pitch === undefined ? 0.18 : 0.93) : 0.32);
      slab(ctx, frame, lane, event, start, end);
      const pattern = theme.name === 'pocket' ? lane.instrument.index % 4 : 0;
      ctx.shadowColor = lane.instrument.colour;
      ctx.shadowBlur =
        theme.glow && note.hasOnset && start < now + 0.5 && lane.events.length < 256 ? 9 : 0;
      if (pattern !== 3) ctx.fill();
      else {
        ctx.strokeStyle = lane.instrument.colour;
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      if (!theme.glow) {
        ctx.strokeStyle = theme.text;
        ctx.globalAlpha = opacity * 0.5;
        ctx.stroke();
      }
      if (note.hasOnset && note.start >= now && event.pitch === undefined) {
        ctx.globalAlpha = opacity * 0.93;
        ctx.fillStyle = lane.instrument.colour;
        ctx.strokeStyle = lane.instrument.colour;
        slab(ctx, frame, lane, event, start, Math.min(end, start + 0.018));
        if (pattern === 3) ctx.stroke();
        else ctx.fill();
        slab(ctx, frame, lane, event, start, end);
      }
      if (pattern === 1 || pattern === 2) {
        ctx.save();
        ctx.clip();
        const bottom = roadY(height, roadScale(frame, start));
        const top = roadY(height, roadScale(frame, end));
        ctx.strokeStyle = theme.ground;
        ctx.fillStyle = theme.ground;
        ctx.globalAlpha = opacity * 0.5;
        for (let y = top; y < bottom; y += pattern === 2 ? 8 : 10) {
          if (pattern === 2) {
            const near = roadScale(frame, start);
            const far = roadScale(frame, end);
            const x1 = width / 2 + (lane.left - width / 2) * Math.max(near, far);
            const x2 = width / 2 + (lane.left - width / 2) * Math.min(near, far);
            const x3 = width / 2 + (lane.right - width / 2) * Math.max(near, far);
            const x4 = width / 2 + (lane.right - width / 2) * Math.min(near, far);
            for (let x = Math.min(x1, x2); x < Math.max(x3, x4); x += 8) ctx.fillRect(x, y, 2, 2);
          } else {
            ctx.lineWidth = 2;
            line(0, y, width, y);
          }
        }
        ctx.restore();
        ctx.lineWidth = 1;
      }
      ctx.fillStyle = lane.instrument.colour;
    }
  }
  // Fade the final fifth in depth into the ground, including the road itself.
  const fadeTop = height * 0.12;
  const fadeBottom = edge(0, now + lookAhead * 0.8).y;
  ctx.save();
  const first = road[0]?.left ?? width * 0.05;
  const last = road.at(-1)?.right ?? width * 0.95;
  const farLeft = edge(first, now + lookAhead);
  const farRight = edge(last, now + lookAhead);
  ctx.beginPath();
  ctx.moveTo(first, lineY);
  ctx.lineTo(last, lineY);
  ctx.lineTo(farRight.x, farRight.y);
  ctx.lineTo(farLeft.x, farLeft.y);
  ctx.closePath();
  ctx.clip();
  // Alpha rows avoid dark interpolation through transparent black on light grounds.
  ctx.fillStyle = theme.ground;
  for (let y = fadeTop; y < fadeBottom; y++) {
    ctx.globalAlpha = 1 - (y - fadeTop) / (fadeBottom - fadeTop);
    ctx.fillRect(0, y, width, Math.min(1, fadeBottom - y));
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = theme.text;
  ctx.lineWidth = 2;
  ctx.shadowColor = theme.text;
  ctx.shadowBlur = theme.glow ? 12 : 0;
  line(width * 0.05, lineY, width * 0.95, lineY);
  ctx.shadowBlur = 0;
  const effect = { held: false, flare: 0, ripple: -1, streak: 0 };
  for (const lane of road) {
    let held = false;
    let flare = 0;
    const opacity = lane.instrument.muted ? 0.2 : 1;
    for (const event of lane.events) {
      landing(event.note, now, frame.cps, frame.trails, effect);
      held ||= effect.held;
      flare = Math.max(flare, effect.flare);
      const laneWidth = lane.right - lane.left;
      const x = lane.left + laneWidth * (0.23 + 0.54 * notePosition(lane, event));
      ctx.strokeStyle = lane.instrument.colour;
      if (effect.ripple >= 0) {
        const t = effect.ripple;
        ctx.globalAlpha = opacity * (1 - t) * 0.8;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(
          x,
          lineY + t * height * 0.06,
          Math.max(1, laneWidth * (0.12 + t * 0.47)),
          2 + t * height * 0.025,
          0,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }
      if (effect.streak > 0) {
        ctx.globalAlpha = opacity * effect.streak * 0.25;
        ctx.lineWidth = Math.max(1, laneWidth * 0.08);
        line(x, lineY + 3, x, lineY + (1 - effect.streak) * height * 0.13);
      }
    }
    const energy = Math.max(flare, held ? 0.45 : 0);
    if (energy > 0) {
      ctx.globalAlpha = energy * opacity;
      ctx.shadowColor = lane.instrument.colour;
      ctx.shadowBlur = theme.glow ? 22 : 0;
      ctx.strokeStyle = lane.instrument.colour;
      ctx.lineWidth = 3 + energy * 5;
      line(lane.left + 4, lineY, lane.right - 4, lineY);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = opacity * (held ? 1 : 0.58);
    ctx.fillStyle = held ? lane.instrument.colour : theme.muted;
    ctx.textAlign = 'center';
    ctx.font = `${road.length >= 16 ? '11' : '13'}px "${theme.fontMono}"`;
    const name = lane.instrument.name;
    const label =
      road.length >= 16
        ? name
            .split(/\s+/)
            .map((word) => word[0])
            .join('')
            .slice(0, 3)
        : name;
    ctx.fillText(
      label,
      (lane.left + lane.right) / 2,
      lineY + height * 0.085,
      Math.max(1, lane.right - lane.left - 8),
    );
  }
  const active = new Set(road.map((lane) => lane.instrument.id));
  const resting = frame.instruments.filter((instrument) => !active.has(instrument.id));
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = theme.muted;
  ctx.textAlign = 'right';
  ctx.font = `10px "${theme.fontMono}"`;
  if (resting.length)
    ctx.fillText(
      `resting · ${resting.map((i) => i.name).join(' · ')}`,
      width * 0.95,
      height * 0.97,
      width * 0.7,
    );
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.text;
  ctx.font = `20px "${theme.fontDisplay}"`;
  ctx.fillText('Rain', width * 0.035, height * 0.055);
  ctx.font = `11px "${theme.fontMono}"`;
  ctx.fillStyle = theme.muted;
  ctx.fillText('what’s coming', width * 0.035, height * 0.085);
  ctx.textAlign = 'right';
  ctx.fillText(
    `cycle ${String(Math.floor(now) + 1)} · ${String(lookAhead)} ahead`,
    width * 0.965,
    height * 0.055,
  );
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

const view: ViewDefinition = {
  id: 'rain',
  name: 'Rain',
  tag: "what's coming",
  mount(element) {
    const canvas = document.createElement('canvas');
    element.append(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      canvas.remove();
      throw Error('Canvas 2D is unavailable');
    }
    let lastNotes: ViewFrame['notes'] | undefined;
    let groups = indexNotes([]);
    return {
      frame(frame) {
        const w = Math.round(frame.width * frame.dpr);
        const h = Math.round(frame.height * frame.dpr);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        canvas.style.width = `${String(frame.width)}px`;
        canvas.style.height = `${String(frame.height)}px`;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.fillStyle = frame.theme.ground;
        ctx.fillRect(0, 0, w, h);
        ctx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
        if (lastNotes !== frame.notes) {
          lastNotes = frame.notes;
          groups = indexNotes(frame.notes);
        }
        drawRain(ctx, frame, groups);
      },
      dispose() {
        canvas.remove();
        canvas.width = 0;
        canvas.height = 0;
        lastNotes = undefined;
        groups.clear();
      },
    };
  },
};
export default view;
