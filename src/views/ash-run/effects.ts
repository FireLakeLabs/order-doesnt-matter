import type { ViewFrame } from '../types';
import { line } from '../shared/retro-2d';
import { random } from '../shared/particles';
import { building, buildingAt, route } from './city';
import { accented, type Scene, type Data, type Event } from './model';
import { clamp } from '../shared/math';

export function crateState(s: Scene, event: Event, now: number) {
  const n = event.note;
  const d = (n.start * s.pace) / s.size;
  const b = buildingAt(d, s.maxGap),
    onset = route(s, n.start);
  const next = onset.jump?.to ?? building(b.index + 1, s.maxGap);
  const age = now - n.start;
  const tumble = onset.airborne;
  const origin = onset.jump ? onset.jump.from.end - 0.25 : d;
  const originY = onset.jump ? s.y(onset.jump.from) : onset.feet;
  const target = Math.max(origin, next.start + 0.45);
  const u = clamp(age / 0.24);
  return {
    tumble,
    age,
    x: tumble && age >= 0 ? origin + (target - origin) * u : origin,
    y:
      tumble && age >= 0
        ? originY + (s.y(next) - originY) * u - s.size * 0.6 * 4 * u * (1 - u)
        : originY,
    rotation: tumble && age >= 0 ? u * Math.PI * 3 : 0,
  };
}
export function crates(c: CanvasRenderingContext2D, f: ViewFrame, s: Scene, data: Data) {
  for (const e of data.parts.get(s.roles.snare ?? '') ?? []) {
    if (!e.note.hasOnset) continue;
    const a = crateState(s, e, f.now),
      x = s.x(a.x),
      size = s.size * 0.36;
    if (x < -size * 3 || x > f.width + size * 3) continue;
    const crash = accented(e, data) && !a.tumble && a.age >= 0;
    if (crash) {
      const age = a.age / Math.max(0.001, f.cps);
      if (age > 1) continue;
      c.fillStyle = '#a8784c';
      c.strokeStyle = '#4b3328';
      c.lineWidth = 1;
      for (let bit = 0; bit < 9; bit++) {
        const vx = (random(e.seed, bit * 2) - 0.1) * s.size * 2;
        const vy = -(random(e.seed, bit * 2 + 1) + 0.4) * s.size * 2;
        const bx = x + vx * age,
          by = a.y + vy * age + s.size * 3 * age * age;
        c.save();
        c.translate(bx, Math.min(a.y - 2, by));
        c.rotate(bit + age * 8);
        c.fillRect(-size * 0.12, -size * 0.08, size * 0.35, size * 0.16);
        c.restore();
      }
      continue;
    }
    c.save();
    c.translate(x, a.y - size * 0.5);
    c.rotate(a.rotation);
    c.fillStyle = '#8a5d3d';
    c.strokeStyle = '#3b291e';
    c.lineWidth = 2;
    c.fillRect(-size / 2, -size / 2, size, size);
    c.strokeRect(-size / 2, -size / 2, size, size);
    line(c, -size / 2, -size / 2, size / 2, size / 2);
    line(c, -size / 2, size / 2, size / 2, -size / 2);
    c.restore();
  }
}
export function pigeons(c: CanvasRenderingContext2D, f: ViewFrame, s: Scene, data: Data) {
  c.fillStyle = '#cfc8da';
  c.strokeStyle = '#cfc8da';
  c.lineWidth = 2.3;
  for (const e of data.parts.get(s.roles.openHat ?? '') ?? []) {
    if (!e.note.hasOnset) continue;
    const d = (e.note.start * s.pace) / s.size;
    const b = buildingAt(d, s.maxGap),
      support = d > b.end ? building(b.index + 1, s.maxGap) : b;
    const age = (f.now - e.note.start) / Math.max(0.001, f.cps);
    if (age > 1.7) continue;
    for (let i = 0; i < 4; i++) {
      const x =
        s.x(Math.max(d, support.start)) +
        (i - 1.5) * s.size * 0.31 -
        Math.max(0, age) * s.size * (0.7 + i * 0.24);
      const y = s.y(support) - 4 - Math.max(0, age) * s.size * (1.1 + random(e.seed, i) * 1.4);
      if (x < -20 || x > f.width + 20) continue;
      const r = s.size * 0.085;
      c.beginPath();
      c.ellipse(x, y - 3, r, r * 0.65, -0.1, 0, Math.PI * 2);
      c.fill();
      if (age <= 0) {
        c.beginPath();
        c.arc(x + r * 0.8, y - r, r * 0.45, 0, Math.PI * 2);
        c.fill();
        line(c, x, y, x - 1, y + 4);
      } else {
        const flap = Math.sin(age * 24 + i) * r * 1.8;
        c.beginPath();
        c.moveTo(x - r * 2.4, y - flap);
        c.quadraticCurveTo(x - r, y - 3, x, y);
        c.quadraticCurveTo(x + r, y - 3, x + r * 2.4, y - flap);
        c.stroke();
      }
    }
  }
}
export function blasts(c: CanvasRenderingContext2D, f: ViewFrame, s: Scene, data: Data) {
  for (const e of data.parts.get(s.roles.kick ?? '') ?? []) {
    const age = (f.now - e.note.start) / Math.max(0.001, f.cps);
    if (!e.note.hasOnset || age < 0 || age > 1) continue;
    const x = f.width * (0.45 + random(e.seed) * 0.3) - age * s.speed * 0.06;
    const base = f.height * 0.55;
    c.globalAlpha = 1 - age;
    c.fillStyle = '#55404a';
    for (let puff = 0; puff < 5; puff++) {
      const radius = s.size * (0.16 + 0.16 * age + 0.05 * (5 - puff));
      c.beginPath();
      c.arc(
        x + Math.sin(puff * 3) * 8,
        base - puff * s.size * 0.33 - age * 20,
        radius,
        0,
        Math.PI * 2,
      );
      c.fill();
    }
    c.fillStyle = '#ff8a3d';
    c.beginPath();
    c.ellipse(x, base, s.size * 0.24, s.size * 0.35, 0, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
  }
}
export function dust(c: CanvasRenderingContext2D, f: ViewFrame, s: Scene, data: Data) {
  const hits = (data.parts.get(s.roles.kick ?? '') ?? []).filter(
    (e) =>
      e.note.hasOnset &&
      e.note.start <= f.now &&
      (f.now - e.note.start) / Math.max(0.001, f.cps) < 0.5,
  );
  c.fillStyle = '#a18b8c';
  for (const e of hits) {
    const age = (f.now - e.note.start) / Math.max(0.001, f.cps);
    for (const b of s.buildings)
      for (let i = 0; i < 6; i++) {
        const x = s.x(b.start + (b.end - b.start) * random(e.seed + b.index, i));
        const y = s.y(b) + age * age * s.size * 2;
        c.globalAlpha = 1 - age * 2;
        c.fillRect(x, y, 2, 3);
      }
  }
  c.globalAlpha = 1;
}
export function walker(c: CanvasRenderingContext2D, f: ViewFrame, s: Scene) {
  const x = f.width * 0.83,
    y = f.height * 0.3,
    size = f.height * 0.24;
  const angle = s.light?.angle ?? 2.65,
    lampX = x - size * 0.27,
    lampY = y + size * 0.03;
  if (s.lamp) {
    const reach = f.width * 0.48;
    const glow = c.createLinearGradient(
      lampX,
      lampY,
      lampX + Math.cos(angle) * reach,
      lampY + Math.sin(angle) * reach,
    );
    glow.addColorStop(0, '#ffb27a66');
    glow.addColorStop(1, '#ffb27a00');
    c.fillStyle = glow;
    c.beginPath();
    c.moveTo(lampX, lampY);
    c.lineTo(lampX + Math.cos(angle - 0.05) * reach, lampY + Math.sin(angle - 0.05) * reach);
    c.lineTo(lampX + Math.cos(angle + 0.05) * reach, lampY + Math.sin(angle + 0.05) * reach);
    c.fill();
  }
  c.strokeStyle = '#3a2b33';
  c.fillStyle = '#3a2b33';
  c.lineWidth = size * 0.047;
  const step = Math.sin(s.walkerStep * Math.PI);
  for (let i = -1; i <= 1; i++) {
    const swing = step * size * 0.14 * ((i + s.walkerSide) % 2 ? -1 : 1);
    c.beginPath();
    c.moveTo(x + i * size * 0.15, y + size * 0.1);
    c.lineTo(x + i * size * 0.25 + swing, y + size * 0.5 - Math.abs(swing) * 0.3);
    c.lineTo(x + i * size * 0.38 - swing, y + size);
    c.stroke();
  }
  c.beginPath();
  c.moveTo(x - size * 0.4, y);
  c.quadraticCurveTo(x, y - size * 0.2, x + size * 0.4, y - size * 0.03);
  c.lineTo(x + size * 0.44, y + size * 0.15);
  c.quadraticCurveTo(x, y + size * 0.26, x - size * 0.42, y + size * 0.14);
  c.fill();
  c.fillStyle = s.lamp ? '#ffb27a' : '#66505b';
  c.beginPath();
  c.arc(lampX, lampY, size * 0.035, 0, Math.PI * 2);
  c.fill();
}
