import type { ViewDefinition, ViewFrame } from './types';
import { mount2d, line } from './shared/retro-2d';
import { ash, burst, spark, random, type Particle } from './shared/particles';
import { analyse, scene, roofY, roofAt, kind, parallaxRates, type Data } from './ash-run/model';

function city(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  s: ReturnType<typeof scene>,
  layer: number,
) {
  const tile = f.width * [0.36, 0.15, 0.26][layer];
  const travel = f.now * s.scale * parallaxRates[layer];
  const first = Math.floor(travel / tile) - 1;
  const base = f.height * [0.56, 0.67, 0.88][layer];
  c.fillStyle = f.theme.muted;
  c.strokeStyle = f.theme.line;
  c.globalAlpha = [0.11, 0.19, 0.3][layer];
  c.lineWidth = 1;
  for (let i = first; i <= first + Math.ceil(f.width / tile) + 2; i++) {
    const seed = i * 773 + s.district.index * 2203 + layer * 101;
    const x = i * tile - travel,
      top = base - f.height * (0.08 + random(seed) * [0.2, 0.29, 0.24][layer]);
    c.beginPath();
    c.moveTo(x, f.height);
    c.lineTo(x, top + 18);
    c.lineTo(x + tile * 0.16, top + 4);
    c.lineTo(x + tile * 0.26, top + 14);
    c.lineTo(x + tile * 0.34, top - 12);
    c.lineTo(x + tile * 0.56, top + 6);
    c.lineTo(x + tile * 0.64, top - 5);
    c.lineTo(x + tile * 0.78, top + 22);
    c.lineTo(x + tile * 0.78, f.height);
    c.closePath();
    c.fill();
    c.stroke();
    if (layer === 0 && random(seed, 2) > 0.4) {
      c.lineWidth = f.height * 0.022;
      c.beginPath();
      c.ellipse(
        x + tile * 0.6,
        top + 45,
        tile * 0.6,
        f.height * 0.28,
        -0.2,
        Math.PI,
        Math.PI * 1.8,
      );
      c.stroke();
      c.lineWidth = 1;
    }
    if (layer === 2) {
      line(c, x + tile * 0.35, top + 12, x + tile * 0.35, top - f.height * 0.09);
      line(c, x + tile * 0.22, top - f.height * 0.07, x + tile * 0.51, top - f.height * 0.075);
    }
  }
  c.globalAlpha = 1;
}
function walker(c: CanvasRenderingContext2D, f: ViewFrame, s: ReturnType<typeof scene>) {
  const t = f.theme,
    x = f.width * 0.83,
    y = f.height * 0.4,
    size = f.height * 0.13;
  const angle = s.light?.angle ?? 2.6,
    reach = f.width * 0.65;
  c.fillStyle = t.accent;
  c.globalAlpha = 0.13;
  c.beginPath();
  c.moveTo(x + size * 0.3, y);
  c.lineTo(x + Math.cos(angle - 0.05) * reach, y + Math.sin(angle - 0.05) * reach);
  c.lineTo(x + Math.cos(angle + 0.05) * reach, y + Math.sin(angle + 0.05) * reach);
  c.closePath();
  c.fill();
  c.globalAlpha = 0.7;
  c.strokeStyle = t.muted;
  c.fillStyle = t.line;
  c.lineWidth = Math.max(2, size * 0.045);
  // A three-strut survey walker with a canted shield and an offset sensor mast.
  for (const leg of [-1, 0, 1]) {
    const sway = Math.sin(f.now * 0.6 + leg) * size * 0.08;
    c.beginPath();
    c.moveTo(x + leg * size * 0.2, y + size * 0.25);
    c.lineTo(x + leg * size * 0.45 + sway, y + size * 0.65);
    c.lineTo(x + leg * size * 0.62 - sway, y + size);
    c.stroke();
  }
  c.beginPath();
  c.moveTo(x - size * 0.48, y + size * 0.2);
  c.lineTo(x - size * 0.2, y - size * 0.12);
  c.lineTo(x + size * 0.37, y + size * 0.02);
  c.lineTo(x + size * 0.25, y + size * 0.4);
  c.closePath();
  c.fill();
  c.stroke();
  line(c, x + size * 0.1, y + size * 0.1, x + size * 0.3, y - size * 0.25);
  c.globalAlpha = 1;
  c.fillStyle = t.accent;
  c.shadowColor = t.accent;
  c.shadowBlur = t.glow ? 9 : 0;
  c.beginPath();
  c.arc(x + size * 0.3, y, 3, 0, Math.PI * 2);
  c.fill();
  c.shadowBlur = 0;
  if (s.light) {
    c.font = `10px "${t.fontMono}"`;
    c.textAlign = 'right';
    c.fillStyle = t.muted;
    c.fillText(
      `${s.light.key} ${s.light.value.toFixed(2)} · per note`,
      f.width - 18,
      y - size * 0.4,
      f.width * 0.4,
    );
  }
}
function runner(c: CanvasRenderingContext2D, f: ViewFrame, s: ReturnType<typeof scene>) {
  const t = f.theme,
    x = s.gate,
    y = s.feet,
    size = s.size;
  const ink = t.glow ? t.ground : t.text;
  const stride = Math.sin(s.stride * Math.PI * 2),
    airborne = s.leap > size * 0.08 || s.chasm;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = ink;
  c.fillStyle = ink;
  const limb = (points: number[], width: number) => {
    c.lineWidth = size * width;
    c.beginPath();
    c.moveTo(x + points[0] * size, y + points[1] * size);
    for (let i = 2; i < points.length; i += 2)
      c.lineTo(x + points[i] * size, y + points[i + 1] * size);
    c.stroke();
  };
  limb(
    [
      0,
      -0.46,
      airborne ? -0.24 : 0.1 + stride * 0.22,
      -0.25,
      airborne ? -0.4 : 0.15 + stride * 0.28,
      airborne ? -0.25 : 0,
    ],
    0.075,
  );
  limb(
    [
      0,
      -0.46,
      airborne ? 0.25 : -0.1 - stride * 0.2,
      -0.2,
      airborne ? 0.05 : -0.15 - stride * 0.3,
      airborne ? -0.08 : -0.02,
    ],
    0.08,
  );
  c.beginPath();
  c.moveTo(x - size * 0.16, y - size * 0.7);
  c.lineTo(x + size * 0.12, y - size * 0.82);
  c.lineTo(x + size * 0.04, y - size * 0.43);
  c.lineTo(x - size * 0.27, y - size * 0.3);
  c.lineTo(x - size * 0.21, y - size * 0.49);
  c.lineTo(x - size * 0.36, y - size * 0.4);
  c.closePath();
  c.fill();
  c.strokeStyle = t.accent;
  c.globalAlpha = 0.5;
  c.lineWidth = 1.2;
  c.stroke();
  c.globalAlpha = 1;
  c.strokeStyle = ink;
  limb([0.04, -0.72, 0.22, -0.58, 0.35, -0.7], 0.055);
  limb([0.02, -0.74, -0.18, -0.63, -0.29, -0.48], 0.055);
  c.beginPath();
  c.moveTo(x + size * 0.05, y - size * 0.86);
  c.lineTo(x + size * 0.02, y - size * 1.03);
  c.lineTo(x + size * 0.2, y - size * 1.06);
  c.lineTo(x + size * 0.28, y - size * 0.91);
  c.closePath();
  c.fill();
  c.strokeStyle = t.accent;
  c.lineWidth = size * 0.027;
  c.shadowColor = t.accent;
  c.shadowBlur = t.glow ? 6 : 0;
  line(c, x + size * 0.21, y - size * 1.015, x + size * 0.25, y - size * 0.94);
  c.shadowBlur = 0;
}
function draw(c: CanvasRenderingContext2D, f: ViewFrame, data: Data) {
  const t = f.theme,
    s = scene(f, data),
    ink = t.glow ? t.ground : t.text;
  c.setLineDash([]);
  c.textAlign = 'left';
  c.lineJoin = 'round';
  c.lineCap = 'round';
  const sky = c.createLinearGradient(0, 0, 0, f.height);
  sky.addColorStop(0, t.ground);
  sky.addColorStop(1, t.panel);
  c.fillStyle = sky;
  c.fillRect(0, 0, Math.ceil(f.width), Math.ceil(f.height));
  c.fillStyle = t.accent;
  c.globalAlpha = 0.07;
  c.beginPath();
  c.ellipse(f.width * 0.47, f.height * 0.51, f.width * 0.42, f.height * 0.36, 0, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 1;
  city(c, f, s, 0);
  city(c, f, s, 1);
  walker(c, f, s);
  city(c, f, s, 2);
  const roofColour = f.instruments.find((i) => i.id === s.roles.rooftops)?.colour ?? t.accent;
  const visible = s.roofs.filter((e) => s.x(e.note.end) >= 0 && s.x(e.note.start) <= f.width);
  for (const e of visible) {
    const left = Math.max(-1, s.x(e.note.start)),
      right = Math.min(f.width + 1, s.x(e.note.end)),
      y = roofY(e.midi, f.height);
    c.fillStyle = ink;
    c.fillRect(left, y, right - left, f.height - y);
    c.strokeStyle = t.muted;
    c.globalAlpha = 0.18;
    c.lineWidth = 1;
    for (let x = left + 30; x < right; x += 94) {
      line(c, x, y + 28, x + 20, y + 59);
      line(c, x + 20, y + 59, x + 12, y + 88);
    }
    c.globalAlpha = 1;
  }
  for (const e of visible) {
    c.strokeStyle = t.glow ? roofColour : t.text;
    c.lineWidth = 2;
    line(c, s.x(e.note.start), roofY(e.midi, f.height), s.x(e.note.end), roofY(e.midi, f.height));
  }
  const particle: Particle = { x: 0, y: 0, alpha: 0 };
  let represented = visible.length;
  for (const [id, events] of data.parts) {
    if (id === s.roles.rooftops) continue;
    const instrument = f.instruments.find((i) => i.id === id),
      col = instrument?.muted ? t.muted : (instrument?.colour ?? t.accent);
    const role = kind(id, s.roles);
    for (const e of events) {
      const n = e.note,
        x = s.x(n.start);
      if (s.x(n.end) < -60 || x > f.width + 60) continue;
      represented++;
      const y = roofY(roofAt(s.roofs, n.start)?.midi, f.height),
        future = f.now < n.start;
      c.strokeStyle = t.glow ? col : t.text;
      c.fillStyle = ink;
      c.lineWidth = 2;
      if (!n.hasOnset) {
        c.globalAlpha = 0.3;
        line(c, x, y - 18, s.x(n.end), y - 18);
        c.globalAlpha = 1;
        continue;
      }
      if (role === 'cable') {
        const high = y - s.size * 0.9;
        line(c, x - 14, y, x - 14, high);
        c.beginPath();
        c.moveTo(x - 14, high);
        c.quadraticCurveTo(x + 15, high + 22, x + 44, high + 5);
        c.stroke();
      } else if (future && (role === 'snare' || role === 'generic')) {
        const h = role === 'snare' ? s.size * 0.42 : s.size * 0.19;
        c.beginPath();
        c.moveTo(x - h * 0.65, y);
        c.lineTo(x - h * 0.5, y - h * 0.6);
        c.lineTo(x - h * 0.1, y - h * 0.45);
        c.lineTo(x + h * 0.05, y - h);
        c.lineTo(x + h * 0.5, y - h * 0.7);
        c.lineTo(x + h * 0.65, y);
        c.closePath();
        c.fill();
        c.stroke();
        line(c, x - h * 0.3, y - h * 0.4, x + h * 0.45, y - h * 0.6);
      }
      if (future) continue;
      const seconds = role === 'kick' ? 0.95 : role === 'cable' ? 0.5 : 0.24;
      const age = (f.now - n.start) / (Math.max(0.001, f.cps) * seconds);
      if (age < 0 || age >= 1 || instrument?.muted) continue;
      const origin = role === 'cable' ? y - s.size * 0.75 : y;
      c.strokeStyle = t.glow ? col : t.text;
      c.fillStyle = role === 'kick' ? t.muted : col;
      if (role === 'kick') {
        c.globalAlpha = (1 - age) * 0.3;
        c.beginPath();
        c.ellipse(x - 18 * age, y - 7, 10 + age * 33, 3 + age * 7, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.shadowColor = col;
      c.shadowBlur = t.glow ? 5 : 0;
      for (let bit = 0; bit < (role === 'snare' ? 9 : 5); bit++) {
        if (role === 'cable') spark(e.seed + bit * 53, age, particle);
        else burst(e.seed + bit * 53, age, particle);
        c.globalAlpha = particle.alpha;
        const radius = role === 'snare' ? s.size * 0.62 : s.size * 0.4;
        line(
          c,
          x + particle.x * radius,
          origin - Math.abs(particle.y) * radius,
          x + particle.x * radius + 3,
          origin - Math.abs(particle.y) * radius - 3,
        );
      }
      c.shadowBlur = 0;
      c.globalAlpha = 1;
    }
  }
  // Footfall stamps use the same selected drum that phases the runner's joints.
  for (const e of data.parts.get(s.roles.footfalls ?? '') ?? []) {
    const age = (f.now - e.note.start) / (Math.max(0.001, f.cps) * 1.1);
    if (!e.note.hasOnset || age < 0 || age >= 1) continue;
    const x = s.x(e.note.start),
      y = roofY(roofAt(s.roofs, e.note.start)?.midi, f.height);
    c.globalAlpha = (1 - age) * 0.45;
    c.strokeStyle = t.muted;
    c.lineWidth = 3;
    line(c, x - 7, y + 3, x + 4, y + 3);
  }
  c.globalAlpha = 1;
  runner(c, f, s);
  c.fillStyle = t.muted;
  for (let i = 0; i < 70; i++) {
    ash(i * 97 + s.district.index * 31, f.now, particle);
    c.globalAlpha = particle.alpha;
    c.beginPath();
    c.ellipse(
      particle.x * f.width,
      80 + particle.y * (f.height - 125),
      1 + random(i) * 1.2,
      0.7,
      -0.3,
      0,
      Math.PI * 2,
    );
    c.fill();
  }
  c.globalAlpha = 1;
  c.textAlign = 'left';
  c.fillStyle = t.text;
  c.font = `600 24px "${t.fontDisplay}"`;
  c.fillText('Ash Run', 18, 31);
  c.font = `11px "${t.fontMono}"`;
  c.fillStyle = t.muted;
  c.fillText(
    `BAR ${String(Math.floor(f.now) + 1)} · ${String(Math.round((f.now % 1) * 100))}% · ${String(Math.round(f.cps * 240))} BPM · ${String(Math.round(s.speed))} px/s`,
    18,
    51,
  );
  if (s.chasm) c.fillText('CHASM · no bass roof here', 18, 69);
  c.textAlign = 'right';
  c.fillStyle = t.accent;
  c.fillText(`${s.district.name.toUpperCase()} DISTRICT`, f.width - 18, 30, f.width * 0.45);
  c.fillStyle = t.muted;
  c.fillText(`${String(represented)} visible score spans`, f.width - 18, 49, f.width * 0.4);
  c.fillStyle = t.panel;
  c.fillRect(0, f.height - 43, f.width, 43);
  c.strokeStyle = t.line;
  c.lineWidth = 1;
  line(c, 0, f.height - 43, f.width, f.height - 43);
  const labels: [string, string | undefined][] = [
    ['rooftops', s.roles.rooftops],
    ['footfalls', s.roles.footfalls],
    ['snare', s.roles.snare],
    ['kick', s.roles.kick],
    ['open hat', s.roles.openHat],
  ];
  c.textAlign = 'left';
  c.font = `10px "${t.fontMono}"`;
  labels.forEach(([role, id], i) => {
    const x = 18 + (i * (f.width - 36)) / 5;
    c.fillStyle = t.muted;
    c.fillText(role, x, f.height - 30);
    c.fillStyle = t.text;
    c.fillText(
      f.instruments.find((instrument) => instrument.id === id)?.name ?? 'generic / none',
      x,
      f.height - 14,
      (f.width - 50) / 5,
    );
  });
}
export default {
  id: 'ash-run',
  group: 'arcade',
  name: 'Ash Run',
  tag: 'rooftop chase',
  mount: (el) => mount2d(el, analyse, draw),
} satisfies ViewDefinition;
