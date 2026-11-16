import type { ViewDefinition, ViewFrame, ViewNote } from './types';
import { analyse, bubbles, clamp, poses, type Part, type Pose, sectionAt } from './band/model';

function outline(c: CanvasRenderingContext2D, p: Pose) {
  c.beginPath();
  // A broad soft bottom keeps even the ridiculous tall ones planted.
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const wave = p.body === 'jelly' ? 1 + 0.075 * Math.sin(angle * 5 + p.ripple) : 1;
    const x = Math.cos(angle) * p.width * 0.5 * wave;
    const y = Math.sin(angle) * p.height * 0.5 * wave;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.closePath();
}
function creature(c: CanvasRenderingContext2D, p: Pose, frame: ViewFrame, loudest?: Pose) {
  const { theme, now } = frame;
  const ink = theme.name === 'pocket' ? theme.ground : theme.text;
  c.save();
  c.globalAlpha = p.instrument.muted ? 0.3 : p.backstage ? 0.65 : 1;
  // Shadows stay flat; bloom is reserved for themes that request it.
  c.fillStyle = p.instrument.colour;
  c.globalAlpha *= theme.glow ? 0.14 : 0.22;
  c.beginPath();
  c.ellipse(p.x, p.floor + 3, p.width * 0.55, Math.max(3, p.width * 0.07), 0, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = p.instrument.muted ? 0.3 : p.backstage ? 0.65 : 1;
  if (frame.trails && p.hop > 0) {
    c.save();
    c.translate(p.x - p.width * 0.13, p.floor - p.height * 0.38);
    c.scale(1.15, 0.75);
    outline(c, p);
    c.globalAlpha *= 0.16;
    c.fill();
    c.restore();
  }
  const tremble = p.body === 'low' && p.active ? Math.sin(now * Math.PI * 48) * p.width * 0.008 : 0;
  c.translate(p.x + tremble, p.y - p.height * 0.5);
  if (theme.name === 'riso') {
    c.save();
    c.translate(4, -3);
    outline(c, p);
    c.fillStyle = theme.accent;
    c.fill();
    c.restore();
  }
  outline(c, p);
  c.fillStyle = p.instrument.colour;
  if (theme.glow && p.active) {
    c.shadowColor = p.instrument.colour;
    c.shadowBlur = Math.min(28, p.width * 0.2);
  }
  c.fill();
  c.shadowBlur = 0;
  c.strokeStyle = theme.glow ? p.instrument.colour : theme.text;
  c.lineWidth = theme.glow ? 1.5 : 3;
  c.stroke();
  if (theme.name === 'pocket') {
    c.save();
    c.clip();
    c.strokeStyle = ink;
    c.fillStyle = ink;
    c.lineWidth = 2;
    const pattern = p.instrument.index % 4;
    if (pattern === 1)
      for (let x = -p.width; x < p.width; x += 10) {
        c.beginPath();
        c.moveTo(x, -p.height);
        c.lineTo(x + p.height, p.height);
        c.stroke();
      }
    if (pattern === 2)
      for (let x = -p.width / 2; x < p.width / 2; x += 13)
        for (let y = -p.height / 2; y < p.height / 2; y += 13) {
          c.beginPath();
          c.arc(x, y, 2, 0, Math.PI * 2);
          c.fill();
        }
    if (pattern === 3) {
      c.scale(0.87, 0.87);
      outline(c, p);
      c.stroke();
    }
    c.restore();
  }
  // Face sits on a solid patch, so Pocket's patterns never swallow an eye.
  const faceWidth = Math.min(p.width * 0.7, p.height * 0.9);
  const eye = Math.max(2.8, Math.min(faceWidth * 0.15, p.height * 0.12));
  const eyeY = -p.height * 0.12;
  const gaze = loudest
    ? clamp((loudest.x - p.x) / Math.max(1, frame.width * 0.3), -1, 1) * eye * 0.35
    : 0;
  for (const side of [-1, 1]) {
    const x = side * faceWidth * 0.25;
    c.fillStyle = p.instrument.colour;
    c.beginPath();
    c.ellipse(x, eyeY, eye * 1.4, eye * 1.5, 0, 0, Math.PI * 2);
    c.fill();
    if (p.blink || p.backstage || !p.active) {
      c.strokeStyle = theme.ground;
      c.lineWidth = Math.max(2, eye * 0.25);
      c.beginPath();
      c.ellipse(x, eyeY, eye, eye * 0.28, 0, 0.05, Math.PI - 0.05);
      c.stroke();
    } else {
      c.fillStyle = ink;
      c.beginPath();
      c.ellipse(x, eyeY, eye, eye * 1.15, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = theme.name === 'pocket' ? theme.text : theme.ground;
      c.beginPath();
      c.arc(x + gaze, eyeY + eye * 0.2, eye * 0.45, 0, Math.PI * 2);
      c.fill();
    }
  }
  const mouthY = p.height * 0.17;
  c.fillStyle = theme.ground;
  c.beginPath();
  c.ellipse(
    0,
    mouthY,
    faceWidth * (p.mouth ? 0.23 : 0.14),
    Math.max(2, p.height * 0.15 * p.mouth),
    0,
    0,
    Math.PI * 2,
  );
  c.fill();
  if (p.mouth > 0.3) {
    c.fillStyle = theme.name === 'pocket' ? theme.muted : theme.accent;
    c.beginPath();
    c.ellipse(0, mouthY + p.height * 0.075, faceWidth * 0.12, p.height * 0.035, 0, 0, Math.PI * 2);
    c.fill();
  }
  if (p.occupancy > 4 && p.active) {
    c.fillStyle = theme.ground;
    c.font = `bold ${String(Math.max(9, Math.min(13, p.width * 0.15)))}px "${theme.fontMono}"`;
    c.textAlign = 'center';
    c.fillText(`×${String(p.occupancy)}`, 0, p.height * 0.36, p.width * 0.6);
  }
  c.restore();
  c.save();
  c.globalAlpha = p.instrument.muted ? 0.4 : 1;
  c.fillStyle = p.active ? theme.text : theme.muted;
  const font = Math.max(9, Math.min(14, frame.width / 65));
  c.font = `${String(font)}px "${theme.fontDisplay}"`;
  c.textAlign = 'center';
  const labelWidth = p.backstage
    ? (frame.width * 0.85) / Math.max(1, frame.instruments.filter((i) => !i.inSection).length)
    : Math.max(p.width, frame.width * 0.08);
  c.fillText(p.instrument.name, p.x, p.floor + (p.backstage ? 19 : 28), labelWidth);
  c.restore();
}

export function drawBand(c: CanvasRenderingContext2D, frame: ViewFrame, parts: Map<string, Part>) {
  const { width: w, height: h, theme, now } = frame;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.fillStyle = theme.ground;
  c.fillRect(0, 0, c.canvas.width, c.canvas.height);
  c.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
  if (w <= 0 || h <= 0) return;
  const cast = poses(frame, parts);
  const loudest = cast.reduce<Pose | undefined>(
    (best, p) => (p.active > (best?.active ?? 0) ? p : best),
    undefined,
  );
  if (theme.glow) {
    for (const p of cast) {
      if (!p.active) continue;
      const gradient = c.createLinearGradient(p.x, 60, p.x, p.floor);
      gradient.addColorStop(0, p.instrument.colour);
      gradient.addColorStop(1, theme.ground);
      c.save();
      c.globalAlpha = 0.15;
      c.fillStyle = gradient;
      c.beginPath();
      c.moveTo(p.x - 10, 0);
      c.lineTo(p.x + 10, 0);
      c.lineTo(p.x + p.width, p.floor);
      c.lineTo(p.x - p.width, p.floor);
      c.closePath();
      c.fill();
      c.restore();
    }
  }
  c.fillStyle = theme.line;
  if (cast.some((p) => !p.backstage && p.floor < h * 0.6)) {
    c.globalAlpha = 0.5;
    c.fillRect(w * 0.025, h * 0.49, w * 0.95, 2);
    c.globalAlpha = 1;
  }
  c.fillRect(w * 0.025, h * 0.72, w * 0.95, 3);
  c.fillStyle = theme.panel;
  c.fillRect(0, h * 0.84, w, h * 0.16);
  c.fillStyle = theme.muted;
  c.font = `${String(Math.max(9, Math.min(12, w / 80)))}px "${theme.fontMono}"`;
  c.fillText('WAITING BACKSTAGE', 18, h * 0.865);
  if (!cast.length) {
    c.textAlign = 'center';
    c.fillText('The stage is yours. Bring a score.', w / 2, h * 0.55);
    c.textAlign = 'left';
  }
  if (frame.trails === 2)
    for (const p of cast) {
      const part = parts.get(p.instrument.id);
      // Aggregate all recent onsets into one puff per instrument, including floods.
      let count = 0,
        start = -Infinity;
      for (const note of part?.notes ?? [])
        if (note.hasOnset && note.start <= now && note.start > now - 1) {
          count++;
          start = Math.max(start, note.start);
        }
      if (!count || p.backstage || p.instrument.muted) continue;
      const age = now - start,
        x = p.x + Math.sin(start * 11) * p.width * 0.4,
        y = p.y - p.height - age * h * 0.2;
      c.save();
      c.globalAlpha = (1 - age) * 0.35;
      c.fillStyle = p.instrument.colour;
      c.strokeStyle = p.instrument.colour;
      c.lineWidth = 2;
      const r = Math.min(9, 4 + Math.log2(count));
      c.beginPath();
      c.ellipse(x, y, r, r * 0.7, -0.4, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.moveTo(x + r, y);
      c.lineTo(x + r, y - r * 3);
      c.lineTo(x + r * 2, y - r * 2);
      c.stroke();
      c.restore();
    }
  for (const p of [...cast].sort((a, b) => a.floor - b.floor)) creature(c, p, frame, loudest);
  const fontSize = Math.max(12, Math.min(23, w / 48));
  for (const b of bubbles(cast, w, fontSize)) {
    c.fillStyle = theme.text;
    c.beginPath();
    c.roundRect(b.x, b.y, b.width, b.height, theme.radius + 5);
    c.fill();
    c.beginPath();
    c.moveTo(b.x + b.width * 0.4, b.y + b.height - 1);
    c.lineTo(b.x + b.width * 0.5, b.y + b.height + 7);
    c.lineTo(b.x + b.width * 0.58, b.y + b.height - 1);
    c.fill();
    c.font = `bold ${String(fontSize)}px "${theme.fontDisplay}"`;
    c.fillStyle = theme.ground;
    c.textAlign = 'center';
    c.fillText(b.pose.word, b.x + b.width / 2, b.y + fontSize + 3);
    c.textAlign = 'left';
  }
  c.fillStyle = theme.text;
  c.font = `bold ${String(Math.max(20, Math.min(30, w / 36)))}px "${theme.fontDisplay}"`;
  c.fillText('The band', 20, 38);
  c.fillStyle = theme.muted;
  c.font = `${String(Math.max(10, Math.min(13, w / 70)))}px "${theme.fontDisplay}"`;
  c.fillText('Big feelings. Tiny arms. No arms, actually.', 20, 60);
  const section = sectionAt(frame, now);
  c.textAlign = 'right';
  c.fillText(
    `bar ${String(Math.floor(now) + 1)}${section ? ` · ${section.name}` : ''}`,
    w - 20,
    38,
  );
  c.textAlign = 'left';
}
const view: ViewDefinition = {
  id: 'band',
  name: 'The band',
  tag: 'silly',
  span: 'song',
  mount(element) {
    const canvas = document.createElement('canvas');
    element.append(canvas);
    const c = canvas.getContext('2d');
    if (!c) {
      canvas.remove();
      throw Error('Canvas 2D is unavailable');
    }
    let source: ViewNote[] | undefined;
    let parts = new Map<string, Part>();
    return {
      frame(frame) {
        const physicalWidth = Math.round(frame.width * frame.dpr),
          physicalHeight = Math.round(frame.height * frame.dpr);
        if (canvas.width !== physicalWidth || canvas.height !== physicalHeight) {
          canvas.width = physicalWidth;
          canvas.height = physicalHeight;
        }
        canvas.style.width = `${String(frame.width)}px`;
        canvas.style.height = `${String(frame.height)}px`;
        if (source !== frame.notes) {
          source = frame.notes;
          parts = analyse(source);
        }
        drawBand(c, frame, parts);
      },
      dispose() {
        canvas.remove();
        canvas.width = 0;
        canvas.height = 0;
        source = undefined;
        parts.clear();
      },
    };
  },
};
export default view;
