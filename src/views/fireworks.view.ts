import type { ViewDefinition, ViewFrame } from './types';
import { line, mount2d } from './shared/retro-2d';
import { fountainSpark, indexShells, shellSpark, sky, sparkCount } from './fireworks/model';

export function drawFireworks(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  groups = indexShells(f.notes),
) {
  const { width: w, height: h, theme } = f;
  // The rounded backing store can extend beyond a fractional CSS host size.
  // Clear every physical pixel so no previous frame survives on that edge.
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = theme.ground;
  c.fillRect(0, 0, c.canvas.width, c.canvas.height);
  c.restore();
  const scene = sky(f, groups);
  const scale = w / 960;
  const step = (w * 0.8) / Math.max(1, scene.pads.length);
  c.lineCap = 'round';
  c.fillStyle = theme.panel;
  c.globalAlpha = 0.5;
  c.fillRect(0, h * 0.67, w, h * 0.33);
  c.globalAlpha = 1;
  // A section fires a wide, slightly flattened ring, already visible at its exact onset.
  for (const ring of scene.rings) {
    c.strokeStyle = theme.accent;
    c.fillStyle = theme.accent;
    c.globalAlpha = ring.alpha;
    c.lineWidth = Math.max(2, 2 * scale);
    c.beginPath();
    c.ellipse(
      w / 2,
      h * 0.31,
      w * (0.12 + ring.age * 0.5),
      h * (0.025 + ring.age * 0.17),
      0,
      0,
      Math.PI * 2,
    );
    c.stroke();
    c.font = `12px "${theme.fontMono}"`;
    c.textAlign = 'center';
    c.fillText(ring.name, w / 2, h * 0.12, w * 0.6);
  }
  for (const shell of scene.shells) {
    const colour = shell.instrument.colour;
    const opacity = shell.instrument.muted ? 0.2 : 1;
    c.strokeStyle = colour;
    c.fillStyle = colour;
    c.lineWidth = Math.max(1.75, (theme.glow ? 2 : 2.2) * scale);
    c.setLineDash(theme.name === 'pocket' && shell.instrument.index % 2 ? [3, 3] : []);
    if (shell.age < 0) {
      c.globalAlpha = opacity * 0.17;
      line(c, shell.pad, scene.floor, shell.x, shell.y);
      c.globalAlpha = opacity * shell.alpha;
      c.lineWidth = Math.max(2.5, 3 * scale);
      line(c, shell.x, shell.y + Math.min(24, h * 0.04 * shell.flight), shell.x, shell.y);
      c.beginPath();
      c.arc(
        shell.x,
        shell.y,
        Math.max(3, (5 + Math.sqrt(shell.event.gain)) * scale),
        0,
        Math.PI * 2,
      );
      c.fill();
    } else {
      // Glow on the tips only avoids a full-canvas blur for every willow strand.
      const sparks = Array.from({ length: sparkCount }, (_, i) => shellSpark(shell, i));
      c.beginPath();
      for (const p of sparks) {
        c.moveTo(shell.targetX, shell.targetY);
        c.quadraticCurveTo(p.cx, p.cy, p.x, p.y);
      }
      c.globalAlpha = opacity * shell.alpha * (shell.willow ? 0.72 : 0.42);
      c.stroke();
      c.setLineDash([]);
      c.shadowColor = colour;
      c.shadowBlur = theme.glow ? Math.max(5, 8 * scale) : 0;
      c.beginPath();
      const r = Math.max(2, (shell.willow ? 2.2 : 2) * scale);
      for (const p of sparks) {
        c.moveTo(p.x + r, p.y);
        c.arc(p.x, p.y, r, 0, Math.PI * 2);
      }
      c.globalAlpha = opacity * shell.alpha;
      c.fill();
      c.shadowBlur = 0;
      // The onset itself is a bright core, before the radial particles have separated.
      if (shell.age < 0.07) {
        c.fillStyle = theme.glow ? theme.text : colour;
        c.beginPath();
        c.arc(
          shell.targetX,
          shell.targetY,
          3 + shell.radius * 0.045 * (1 - shell.age / 0.07),
          0,
          Math.PI * 2,
        );
        c.fill();
      }
    }
  }
  c.setLineDash([]);
  for (const fountain of scene.fountains) {
    c.strokeStyle = fountain.instrument.colour;
    c.fillStyle = fountain.instrument.colour;
    c.lineWidth = Math.max(2, 2 * scale);
    const opacity = fountain.instrument.muted ? 0.2 : 1;
    c.globalAlpha = opacity * fountain.alpha * 0.18;
    c.beginPath();
    c.moveTo(fountain.pad - 4, scene.floor);
    c.quadraticCurveTo(fountain.x - fountain.radius, fountain.y, fountain.x, fountain.y);
    c.quadraticCurveTo(fountain.x + fountain.radius, fountain.y, fountain.pad + 4, scene.floor);
    c.fill();
    for (let i = 0; i < 64; i++) {
      const p = fountainSpark(fountain, i, f.now, scene.floor);
      c.globalAlpha = opacity * p.alpha;
      line(c, p.x, p.y + Math.max(6, 8 * scale), p.x, p.y);
    }
    c.globalAlpha = opacity;
    c.font = `11px "${theme.fontMono}"`;
    c.textAlign = 'center';
    c.fillText(
      `${step >= 85 ? 'fountain ' : ''}×${String(fountain.count)}`,
      fountain.pad,
      scene.floor - 12,
      Math.max(1, step - 4),
    );
  }
  c.globalAlpha = 1;
  c.fillStyle = theme.panel;
  c.beginPath();
  c.moveTo(0, h);
  c.lineTo(0, scene.floor + 4);
  for (let i = 0; i <= 24; i++)
    c.lineTo((w * i) / 24, scene.floor + 4 + Math.sin(i * 1.7) * h * 0.007);
  c.lineTo(w, h);
  c.closePath();
  c.fill();
  scene.pads.forEach((instrument, i) => {
    const pad = w * 0.1 + step * (i + 0.5);
    const active = (groups.get(instrument.id) ?? []).some(
      ({ note }) =>
        (note.hasOnset || note.start < f.from) && note.start <= f.now && note.end > f.now,
    );
    c.globalAlpha = instrument.muted ? 0.25 : active ? 1 : 0.55;
    c.fillStyle = instrument.colour;
    c.fillRect(pad - Math.min(9, step * 0.25), scene.floor + 3, Math.min(18, step * 0.5), 3);
    c.font = `${String(Math.max(12, 11 * scale))}px "${theme.fontMono}"`;
    c.textAlign = 'center';
    const name = instrument.name;
    c.fillText(name, pad, scene.floor + Math.max(24, 24 * scale), Math.max(1, step - 5));
  });
  c.globalAlpha = 1;
  c.textAlign = 'left';
  c.fillStyle = theme.text;
  const titleSize = Math.max(22, 24 * scale);
  c.font = `${String(titleSize)}px "${theme.fontDisplay}"`;
  c.fillText('Fireworks', 20, titleSize + 12);
  c.fillStyle = theme.muted;
  c.font = `${String(Math.max(11, 11 * scale))}px "${theme.fontMono}"`;
  c.fillText('Every onset lights the sky', 20, titleSize + 35);
  c.textAlign = 'right';
  c.fillText(
    `bar ${String(Math.floor(f.now) + 1)} · window ${String(f.lookAhead)}`,
    w - 20,
    titleSize + 12,
  );
  c.font = `${String(Math.max(11, 10 * scale))}px "${theme.fontMono}"`;
  c.fillText(
    `${String(scene.flying)} in flight · ${String(scene.bursting)} bursting`,
    w - 20,
    h - 12,
  );
  c.textAlign = 'left';
  c.fillText(`TRAILS · ${['OFF', 'SHORT', 'LONG'][f.trails]}`, 20, h - 12);
}
const view: ViewDefinition = {
  id: 'fireworks',
  group: 'show',
  name: 'Fireworks',
  tag: 'scored sky',
  mount: (element) => mount2d(element, indexShells, drawFireworks),
};
export default view;
