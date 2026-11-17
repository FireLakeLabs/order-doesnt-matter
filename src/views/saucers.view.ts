import type { ViewDefinition, ViewFrame } from './types';
import { mount2d, line } from './shared/retro-2d';
import { star, spark, random, type Particle } from './shared/particles';
import {
  analyse,
  beamPose,
  formation,
  held,
  motherships,
  sectionAt,
  type Ship,
} from './saucers/model';

function ellipse(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fill();
  c.stroke();
}
function cargo(c: CanvasRenderingContext2D, x: number, y: number, size: number, kind: number) {
  c.save();
  c.translate(x, y);
  c.lineWidth = 1.5;
  if (kind === 0) {
    // A seed pod in a three-footed cradle.
    ellipse(c, 0, -size * 0.3, size * 0.36, size * 0.5);
    line(c, -size * 0.5, 0, size * 0.5, 0);
    for (const d of [-1, 0, 1]) line(c, d * size * 0.32, 0, d * size * 0.5, size * 0.25);
  } else if (kind === 1) {
    c.fillRect(-size * 0.5, -size * 0.65, size, size * 0.65);
    c.strokeRect(-size * 0.5, -size * 0.65, size, size * 0.65);
    line(c, -size * 0.5, -size * 0.65, size * 0.5, 0);
    line(c, size * 0.5, -size * 0.65, -size * 0.5, 0);
    line(c, size * 0.5, -size * 0.4, size * 0.8, -size * 0.4);
    line(c, size * 0.8, -size * 0.4, size * 0.8, -size * 0.7);
  } else {
    c.beginPath();
    c.moveTo(-size * 0.5, -size * 0.5);
    c.lineTo(size * 0.5, -size * 0.5);
    c.lineTo(size * 0.3, 0);
    c.lineTo(-size * 0.3, 0);
    c.closePath();
    c.fill();
    c.stroke();
    line(c, 0, -size * 0.5, 0, -size);
    line(c, 0, -size * 0.75, -size * 0.35, -size * 0.95);
    line(c, 0, -size * 0.85, size * 0.3, -size * 1.1);
  }
  c.restore();
}
function saucer(c: CanvasRenderingContext2D, ship: Ship, f: ViewFrame) {
  const t = f.theme,
    r = ship.size / 2,
    x = ship.x,
    y = ship.y;
  const col = ship.lit ? ship.instrument.colour : t.muted;
  c.lineWidth = 1.6;
  c.strokeStyle = ship.lit && !t.glow ? t.text : col;
  c.fillStyle = t.panel;
  c.globalAlpha = ship.lit ? 1 : 0.5;
  c.shadowColor = col;
  c.shadowBlur = t.glow && ship.lit ? 9 : 0;
  // Broad folded hull, a tapered canopy and a single visor pilot.
  c.beginPath();
  c.moveTo(x - r, y);
  c.lineTo(x - r * 0.6, y - r * 0.16);
  c.lineTo(x + r * 0.66, y - r * 0.16);
  c.lineTo(x + r, y);
  c.lineTo(x + r * 0.48, y + r * 0.22);
  c.lineTo(x - r * 0.52, y + r * 0.22);
  c.closePath();
  c.fill();
  c.stroke();
  c.shadowBlur = 0;
  c.beginPath();
  c.moveTo(x - r * 0.4, y - r * 0.16);
  c.lineTo(x - r * 0.29, y - r * 0.55);
  c.lineTo(x + r * 0.2, y - r * 0.55);
  c.lineTo(x + r * 0.39, y - r * 0.16);
  c.closePath();
  c.fill();
  c.stroke();
  c.fillStyle = ship.lit && !t.glow ? t.text : col;
  c.fillRect(x - r * 0.12, y - r * 0.43, r * 0.22, r * 0.22);
  c.fillStyle = t.ground;
  c.fillRect(x - r * 0.1, y - r * 0.39, r * 0.18, r * 0.045);
  c.fillStyle = ship.lit ? col : t.line;
  for (let i = -1; i <= 1; i++) ellipse(c, x + i * r * 0.48, y + r * 0.06, r * 0.045, r * 0.035);
  c.globalAlpha = 1;
}
function draw(c: CanvasRenderingContext2D, f: ViewFrame, parts: ReturnType<typeof analyse>) {
  const t = f.theme,
    fleet = formation(f, parts),
    section = sectionAt(f);
  c.setLineDash([]);
  c.textAlign = 'left';
  c.lineWidth = 1;
  const sky = c.createLinearGradient(0, 0, 0, f.height);
  sky.addColorStop(0, t.ground);
  sky.addColorStop(1, t.panel);
  c.fillStyle = sky;
  c.fillRect(0, 0, f.width, f.height);
  const particle: Particle = { x: 0, y: 0, alpha: 0 };
  c.fillStyle = t.text;
  for (let i = 0; i < 85; i++) {
    star(i * 79 + 23, f.now, particle);
    c.globalAlpha = particle.alpha * 0.6;
    c.fillRect(particle.x * f.width, 78 + particle.y * (fleet.ground - 90), 1.4, 1.4);
  }
  c.globalAlpha = 1;
  c.fillStyle = t.ground;
  c.strokeStyle = t.line;
  c.beginPath();
  c.moveTo(0, fleet.ground);
  for (let i = 0; i <= 14; i++)
    c.lineTo((i / 14) * f.width, fleet.ground - 15 - random(i + 17) * f.height * 0.035);
  c.lineTo(f.width, f.height);
  c.lineTo(0, f.height);
  c.closePath();
  c.fill();
  c.stroke();
  const mothers = motherships(f, fleet.ships);
  for (const m of mothers) {
    const colour = t.accent;
    c.strokeStyle = colour;
    c.fillStyle = colour;
    c.globalAlpha = 0.055 * m.presence;
    if (m.members.length) {
      c.beginPath();
      c.moveTo(m.x - m.size * 0.25, m.y + 12);
      c.lineTo(m.x + m.size * 0.25, m.y + 12);
      c.lineTo(m.lightRight, fleet.ground);
      c.lineTo(m.lightLeft, fleet.ground);
      c.closePath();
      c.fill();
    }
    c.globalAlpha = m.presence;
    c.fillStyle = t.panel;
    c.lineWidth = 2;
    ellipse(c, m.x, m.y, m.size / 2, m.size * 0.105);
    c.fillStyle = t.ground;
    ellipse(c, m.x, m.y + 12, m.size * 0.32, m.size * 0.035);
    c.fillStyle = colour;
    c.strokeStyle = colour;
    for (let i = 0; i < 7; i++)
      ellipse(
        c,
        m.x + (i - 3) * m.size * 0.1,
        m.y + 9 + Math.sin((i / 6) * Math.PI) * m.size * 0.06,
        2.5,
        2.5,
      );
    c.font = `11px "${t.fontMono}"`;
    c.textAlign = 'center';
    c.fillStyle = colour;
    c.fillText(
      `ROOM ${String(m.orbit)} · ${m.arriving ? 'arriving' : 'mothership'}`,
      m.x,
      Math.max(84, m.y - m.size * 0.12 - 10),
    );
  }
  c.globalAlpha = 1;
  let lifts = 0,
    zaps = 0;
  const linger = Math.max(0.001, f.cps) * (f.trails === 2 ? 0.3 : f.trails === 1 ? 0.15 : 0.04);
  for (const ship of fleet.ships) {
    const col = ship.instrument.muted ? t.muted : ship.instrument.colour;
    const activeHeld = ship.active.filter((e) => held(e.note));
    for (const event of ship.events) {
      const n = event.note;
      const active = n.start <= f.now && f.now < n.end;
      const age = (f.now - n.start) / linger;
      const firing = n.hasOnset && age >= 0 && age < 1;
      if (!active && !firing) continue;
      const pose = beamPose(event, ship, fleet.ground, f.now);
      c.strokeStyle = t.glow ? col : t.text;
      c.fillStyle = col;
      c.lineWidth = 2;
      if (active && !ship.instrument.muted) {
        if (held(n)) {
          lifts++;
          c.globalAlpha = 0.14;
          c.beginPath();
          c.moveTo(ship.x - pose.width * 0.13, ship.y + 8);
          c.lineTo(ship.x + pose.width * 0.13, ship.y + 8);
          c.lineTo(pose.groundX + pose.width / 2, fleet.ground);
          c.lineTo(pose.groundX - pose.width / 2, fleet.ground);
          c.closePath();
          c.fill();
          c.globalAlpha = 0.7;
          c.lineWidth = 1;
          line(c, ship.x, ship.y + 9, pose.x, pose.y);
          c.globalAlpha = 1;
          c.fillStyle = t.text;
          c.strokeStyle = col;
          cargo(c, pose.x, pose.y, Math.max(12, ship.size * 0.23), ship.cargo);
        } else {
          zaps++;
          c.lineWidth = Math.max(0.5, pose.width * 0.065);
          c.globalAlpha = 0.85;
          c.shadowColor = col;
          c.shadowBlur = t.glow ? 8 : 0;
          c.beginPath();
          c.moveTo(ship.x, ship.y + 8);
          for (let step = 1; step <= 5; step++)
            c.lineTo(
              ship.x +
                ((pose.groundX - ship.x) * step) / 5 +
                (random(event.seed, step) - 0.5) * pose.width * 0.6,
              ship.y + ((fleet.ground - ship.y) * step) / 5,
            );
          c.stroke();
          c.shadowBlur = 0;
        }
      }
      if (firing && !ship.instrument.muted) {
        c.strokeStyle = col;
        c.shadowColor = col;
        c.shadowBlur = t.glow ? 7 : 0;
        for (let bit = 0; bit < 5; bit++) {
          spark(event.seed + bit * 31, age, particle);
          c.globalAlpha = particle.alpha;
          line(
            c,
            pose.groundX + particle.x * 28,
            fleet.ground + particle.y * 28,
            pose.groundX + particle.x * 40,
            fleet.ground + particle.y * 40,
          );
        }
        c.shadowBlur = 0;
      }
    }
    c.globalAlpha = 0.5;
    c.strokeStyle = col;
    c.fillStyle = t.ground;
    ellipse(c, ship.padX, fleet.ground, ship.size * 0.27, 3);
    if (!activeHeld.length) {
      c.globalAlpha = 0.4;
      c.fillStyle = t.panel;
      cargo(c, ship.padX, fleet.ground - 8, Math.max(12, ship.size * 0.23), ship.cargo);
    }
  }
  for (const ship of fleet.ships) {
    saucer(c, ship, f);
    c.fillStyle = ship.lit ? (t.glow ? ship.instrument.colour : t.text) : t.muted;
    c.textAlign = 'center';
    c.font = `10px "${t.fontMono}"`;
    const heldNotes = ship.active.filter((e) => held(e.note));
    const progress = heldNotes.length
      ? Math.round(
          (heldNotes.reduce((sum, e) => sum + beamPose(e, ship, fleet.ground, f.now).progress, 0) /
            heldNotes.length) *
            100,
        )
      : undefined;
    const status =
      ship.lit && ship.active.length
        ? progress === undefined
          ? 'zap'
          : `${String(progress)}% lifted${heldNotes.length > 1 ? ` ×${String(heldNotes.length)}` : ''}`
        : '';
    const compact = f.height < 600 && fleet.ships.length > 5;
    c.fillText(
      compact && status ? `${ship.instrument.name} · ${status}` : ship.instrument.name,
      ship.x,
      ship.y - ship.size * 0.34 - (compact ? 8 : 23),
      Math.max(40, ship.size * (compact ? 1.9 : 1.35)),
    );
    if (!compact && status) {
      c.fillStyle = t.muted;
      c.fillText(status, ship.x, ship.y - ship.size * 0.34 - 10, Math.max(40, ship.size * 1.35));
    }
  }
  c.textAlign = 'left';
  c.fillStyle = t.text;
  c.font = `600 24px "${t.fontDisplay}"`;
  c.fillText('Saucers', 18, 31);
  c.fillStyle = t.muted;
  c.font = `11px "${t.fontMono}"`;
  c.fillText(
    `BAR ${String(Math.floor(f.now) + 1)} · ${String(Math.round((f.now % 1) * 100))}% · ${section.name}`,
    18,
    51,
  );
  if (f.sections.length)
    c.fillText(
      `${String(f.instruments.filter((i) => !i.inSection).length)} sit out this section`,
      18,
      69,
    );
  c.fillText(
    `${String(fleet.ships.length)} saucers${fleet.squadron ? ` · ${String(Math.ceil(fleet.ships.length / 5))} squadrons` : ''} · ${String(lifts)} lift${lifts === 1 ? '' : 's'} · ${String(zaps)} zap${zaps === 1 ? '' : 's'}`,
    18,
    f.height - 13,
  );
  c.textAlign = 'right';
  c.fillStyle = t.accent;
  c.fillText(
    `${String(mothers.length)} room${mothers.length === 1 ? '' : 's'} in the sky`,
    f.width - 18,
    30,
  );
  c.globalAlpha = 1;
}
export default {
  id: 'saucers',
  group: 'arcade',
  name: 'Saucers',
  tag: 'invasion',
  mount: (el) => mount2d(el, analyse, draw),
} satisfies ViewDefinition;
