import type { ViewFrame } from '../types';
import { line } from '../shared/retro-2d';
import type { Figure } from './model';

export function drawFigure(c: CanvasRenderingContext2D, f: Figure, frame: ViewFrame) {
  const { theme } = frame;
  const { gait: g } = f;
  const ink = theme.text;
  const colour = f.instrument.colour;
  const build = 1 + (f.instrument.index % 3) * 0.07;
  const hip = g.hips + (f.posing ? [-4, 2, 4][f.pose] : 0);
  const shoulder = g.shoulders + (f.posing ? [2, -3, -7][f.pose] : 0);
  c.save();
  c.translate(f.x, f.y);
  c.scale(f.scale, f.scale);
  c.globalAlpha = f.instrument.muted ? 0.35 : f.walking ? 1 : 0.8;
  c.fillStyle = colour;
  c.globalAlpha *= 0.18;
  c.beginPath();
  c.ellipse(0, 3, 25, 5, 0, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha /= 0.18;
  // Narrow through the turn; the back of the same jacket is revealed on return.
  c.scale(0.22 + Math.abs(f.facing) * 0.78, 1);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = colour;
  c.lineWidth = 7;
  const feet = [
    [g.leftX, g.leftY],
    [g.rightX, g.rightY],
  ];
  for (const [i, [x, y]] of feet.entries()) {
    const h = i === 0 ? -7 : 7;
    line(c, h, -47, h * 0.6 + x * 0.4, -24 + y * 0.4);
    line(c, h * 0.6 + x * 0.4, -24 + y * 0.4, x, y - 3);
    c.strokeStyle = ink;
    c.lineWidth = 2;
    line(c, x - 3, y, x + 5, y);
    c.strokeStyle = colour;
    c.lineWidth = 7;
  }
  for (const item of f.outfit.filter((i) => i.garment === 'boots')) {
    for (const [x, y] of feet) {
      c.fillStyle = ink;
      c.beginPath();
      c.moveTo(x - 4, y - 8 - item.size * 17);
      c.lineTo(x + 4, y - 8 - item.size * 17);
      c.lineTo(x + 4, y - 3);
      c.quadraticCurveTo(x + 12, y - 2, x + 9, y + 2);
      c.lineTo(x - 5, y + 2);
      c.closePath();
      c.fill();
      c.strokeStyle = theme.ground;
      c.lineWidth = 1;
      c.stroke();
    }
  }
  c.save();
  c.translate(0, -47);
  c.rotate((hip * Math.PI) / 180);
  c.fillStyle = colour;
  c.strokeStyle = ink;
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(-11 * build, -13);
  c.quadraticCurveTo(-19 * build, 1, -10 * build, 8);
  c.lineTo(11 * build, 8);
  c.quadraticCurveTo(18 * build, 0, 10 * build, -13);
  c.closePath();
  c.fill();
  c.stroke();
  c.restore();

  c.save();
  c.translate(0, -84);
  c.rotate((shoulder * Math.PI) / 180);
  // Room is a tailored shawl, draped from both shoulders with a folded hem.
  for (const item of f.outfit.filter((i) => i.garment === 'cape')) {
    const length = 24 + item.size * 60;
    c.fillStyle = colour;
    c.strokeStyle = ink;
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(-19 * build, -8);
    c.quadraticCurveTo(-30, length * 0.4, -35 - item.size * 12, length);
    c.quadraticCurveTo(0, length - 12, 35 + item.size * 12, length);
    c.quadraticCurveTo(30, length * 0.4, 19 * build, -8);
    c.closePath();
    c.fill();
    c.stroke();
    c.globalAlpha *= 0.45;
    for (const side of [-1, 1]) line(c, side * 15, -4, side * 25, length - 6);
    c.globalAlpha /= 0.45;
  }
  c.strokeStyle = colour;
  c.lineWidth = 6;
  const flourish = f.walking ? 0 : f.flourish * 15;
  const handOnHip = f.posing && f.pose === 0;
  line(c, -16 * build, -2, -29 - g.arm * 0.3, 18 - flourish);
  line(
    c,
    -29 - g.arm * 0.3,
    18 - flourish,
    handOnHip ? -11 : -25 - g.arm,
    handOnHip ? 26 : 38 - flourish * 2,
  );
  line(c, 16 * build, -2, 27 + g.arm * 0.3, 17 - flourish);
  line(c, 27 + g.arm * 0.3, 17 - flourish, 23 + g.arm, 36 - flourish * 2);
  // A shaped jacket, lapels and waist seam make the body read as clothing.
  c.fillStyle = colour;
  c.strokeStyle = ink;
  c.lineWidth = 1.2;
  c.beginPath();
  c.moveTo(-17 * build, -7);
  c.quadraticCurveTo(-18, 5, -10, 28);
  c.lineTo(-12, 39);
  c.lineTo(12, 39);
  c.lineTo(10, 28);
  c.quadraticCurveTo(18, 5, 17 * build, -7);
  c.closePath();
  c.fill();
  c.stroke();
  line(c, -10, 28, 10, 28);
  if (!f.returning) {
    line(c, -9, -5, 0, 16);
    line(c, 9, -5, 0, 16);
    line(c, 0, 16, 0, 28);
  }
  for (const item of f.outfit.filter((i) => i.garment === 'spikes')) {
    c.fillStyle = ink;
    c.beginPath();
    c.moveTo(-20, -5);
    for (let i = 0; i < 5; i++) {
      c.lineTo(-16 + i * 8, -11 - item.size * 17);
      c.lineTo(-12 + i * 8, -5);
    }
    c.closePath();
    c.fill();
  }
  // Badges stay on the jacket, with a count when the bag exceeds its six slots.
  const badges = f.outfit.filter((i) => i.garment === 'badge');
  for (let i = 0; i < Math.min(6, badges.length); i++) {
    c.fillStyle = ink;
    c.fillRect(-8 + (i % 2) * 10, 9 + Math.floor(i / 2) * 7, 6, 4);
  }
  if (badges.length > 6) {
    c.fillStyle = theme.ground;
    c.font = `bold 8px "${theme.fontMono}"`;
    c.textAlign = 'center';
    c.fillText(String(badges.length), 0, 21);
  }
  c.restore();

  c.save();
  c.translate(f.posing && f.pose === 1 ? 4 : 0, -105);
  c.rotate(((f.posing && f.pose === 1 ? 12 : shoulder * 0.3) * Math.PI) / 180);
  c.fillStyle = colour;
  c.strokeStyle = ink;
  c.lineWidth = 1;
  c.beginPath();
  c.ellipse(0, 0, 11, 15, 0, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  if (!f.returning) {
    c.fillStyle = theme.ground;
    for (const x of [-4, 4]) {
      c.beginPath();
      c.arc(x, -2, 1.5, 0, Math.PI * 2);
      c.fill();
    }
    c.strokeStyle = theme.ground;
    line(c, -3, 6, 3, 6);
  }
  c.fillStyle = ink;
  c.strokeStyle = ink;
  for (const item of f.outfit) {
    if (item.garment === 'hat') {
      const width = 13 + item.size * 19,
        height = 6 + item.size * 23;
      c.beginPath();
      c.moveTo(-width * 0.65, -13);
      c.lineTo(-width * 0.48, -13 - height);
      c.quadraticCurveTo(0, -18 - height, width * 0.48, -13 - height);
      c.lineTo(width * 0.65, -13);
      c.closePath();
      c.fill();
      c.beginPath();
      c.ellipse(0, -13, width, 3.5, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = colour;
      c.lineWidth = 2;
      line(c, -width * 0.6, -17, width * 0.6, -17);
    }
    if (item.garment === 'antenna') {
      c.strokeStyle = ink;
      c.lineWidth = 2;
      line(c, 7, -10, 20 + item.size * 14, -27 - item.size * 27);
      c.beginPath();
      c.arc(20 + item.size * 14, -27 - item.size * 27, 3, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.restore();
  c.restore();

  c.save();
  c.textAlign = 'center';
  c.fillStyle = f.next ? theme.accent : theme.text;
  c.font = `${f.walking ? 'bold 14' : '10'}px "${theme.fontDisplay}"`;
  const label = f.instrument.name;
  const labelWidth = f.walking
    ? frame.width * 0.28
    : Math.max(12, (frame.width * 0.31) / Math.ceil(frame.instruments.length / 2) - 5) *
      (f.next ? 0.75 : 1);
  if (f.next) {
    c.font = `bold 10px "${theme.fontMono}"`;
    c.fillText('NEXT', f.x, f.y - 155 * f.scale, labelWidth);
    c.font = `10px "${theme.fontDisplay}"`;
  }
  c.fillText(label, f.x, f.y + (f.walking ? Math.min(29, frame.height * 0.035) : 18), labelWidth);
  if (f.members.length) {
    c.font = `10px "${theme.fontMono}"`;
    c.fillText(
      `×${String(f.members.length)}${f.walking ? ' notes this bar' : ''}`,
      f.x,
      f.y + (f.walking ? Math.min(45, frame.height * 0.06) : 31),
      labelWidth,
    );
  }
  c.restore();
}
