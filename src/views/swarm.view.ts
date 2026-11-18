import type { ViewDefinition, ViewFrame, ViewNote } from './types';
import { mount2d, line } from './shared/retro-2d';
import { burst, type Particle } from './shared/particles';
import {
  drumPart,
  enemyPose,
  formation,
  hitCount,
  isCarrier,
  playerWidth,
  seed,
  spriteRadius,
  starPoint,
  wave,
} from './swarm/model';

/** Original lantern beetles: split wing cases, articulated legs and a luminous abdomen. */
function beetle(
  c: CanvasRenderingContext2D,
  radius: number,
  flagship: boolean,
  now: number,
  colour: string,
  light: string,
  ground: string,
  variant: number,
) {
  const wing = 0.8 + Math.sin(now * 35 + variant) * 0.1;
  c.strokeStyle = colour;
  c.lineWidth = Math.max(1.2, radius * 0.09);
  for (const side of [-1, 1]) {
    for (let leg = 0; leg < 3; leg++) {
      const y = radius * (-0.42 + leg * 0.42);
      c.beginPath();
      c.moveTo(side * radius * 0.35, y);
      c.lineTo(side * radius * 0.82, y - radius * 0.2);
      c.lineTo(side * radius * 1.08, y + radius * (leg === 0 ? -0.55 : 0.12));
      c.stroke();
    }
    c.fillStyle = colour;
    c.beginPath();
    c.ellipse(
      side * radius * 0.43,
      -radius * 0.12,
      radius * 0.4 * wing,
      radius * (flagship ? 0.82 : 0.62),
      side * -0.28,
      0,
      Math.PI * 2,
    );
    c.fill();
    if (flagship) {
      c.strokeStyle = light;
      line(c, side * radius * 0.35, -radius * 0.62, side * radius * 0.61, radius * 0.12);
      c.strokeStyle = colour;
    }
  }
  c.fillStyle = ground;
  c.beginPath();
  c.ellipse(0, radius * 0.02, radius * 0.23, radius * 0.75, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = flagship ? light : colour;
  for (let i = 0; i < 3; i++)
    c.fillRect(-radius * 0.13, radius * (i * 0.27 - 0.28), radius * 0.26, radius * 0.15);
  c.beginPath();
  c.ellipse(0, radius * 0.65, radius * 0.32, radius * 0.23, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = ground;
  for (const side of [-1, 1]) c.fillRect(side * radius * 0.13 - 1, radius * 0.64, 2, 2);
}
function draw(c: CanvasRenderingContext2D, f: ViewFrame, drum: string | null) {
  const t = f.theme,
    w = f.width,
    h = f.height;
  // Deliberately replace mount2d's preparation with a reset of both context and
  // pixels. Reused raster state can otherwise shade the same rotated wing
  // differently after visiting another time.
  c.reset();
  c.fillStyle = t.ground;
  c.fillRect(0, 0, c.canvas.width, c.canvas.height);
  c.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
  const g = formation(f, drum),
    currentWave = wave(f);
  const particle: Particle = { x: 0, y: 0, alpha: 0 };
  for (const layer of [0, 1]) {
    for (let i = 0; i < Math.min(90, w / 12); i++) {
      const p = starPoint(i, f.now, layer);
      c.globalAlpha = layer ? 0.55 : 0.28;
      c.fillStyle = [t.muted, t.accent, t.text][i % 3];
      c.fillRect(p.x * w, p.y * h, layer ? 2 : 1, layer ? 3 : 1);
    }
  }
  c.globalAlpha = 1;
  c.textAlign = 'left';
  c.fillStyle = t.text;
  c.font = `600 24px "${t.fontDisplay}"`;
  c.fillText('Swarm', 24, 35);
  c.font = `12px "${t.fontMono}"`;
  c.fillStyle = t.accent;
  c.fillText(
    `WAVE ${String(currentWave.number)} · ${currentWave.name.toUpperCase()}`,
    24,
    60,
    w * 0.62,
  );
  c.textAlign = 'right';
  c.fillStyle = t.text;
  c.fillText(`BAR HITS ${String(hitCount(f))}`, w - 24, 35);

  const effect = (note: ViewNote, x: number, y: number) => {
    const duration = Math.max(0.001, f.cps) * (f.trails === 2 ? 0.3 : f.trails === 1 ? 0.18 : 0.08);
    const age = (f.now - note.start) / duration;
    if (!note.hasOnset || age < 0 || age >= 1) return;
    c.save();
    c.shadowColor = c.fillStyle as string;
    c.shadowBlur = t.glow ? 8 : 0;
    for (let bit = 0; bit < 12; bit++) {
      burst(seed(note) + bit * 37, age, particle);
      c.globalAlpha = particle.alpha;
      c.fillRect(x + particle.x * 45, y + particle.y * 45, 3, 3);
    }
    c.globalAlpha = 1 - age;
    c.strokeStyle = t.text;
    c.beginPath();
    c.arc(x, y, 3 + age * 22, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = t.text;
    c.beginPath();
    c.arc(x, y, 7 * (1 - age), 0, Math.PI * 2);
    c.fill();
    c.restore();
  };
  for (const row of g.rows) {
    const col = row.instrument.muted ? t.muted : row.instrument.colour;
    c.globalAlpha = 1;
    c.font = `10px "${t.fontMono}"`;
    for (const [notes, crowded] of [
      [row.enemies, row.crowded],
      [row.nextEnemies, row.nextCrowded],
    ] as const) {
      let squadron = false;
      for (const n of notes) {
        const pose = enemyPose(n, f, g.y(n), g.x),
          flagship = isCarrier(n);
        if (!pose.visible) continue;
        const alive = !pose.hit || (flagship && pose.remaining > 0);
        c.fillStyle = col;
        c.strokeStyle = col;
        // Crowded formation slots remain a counted squadron; every attack and hit still exists.
        if (crowded && alive && !pose.diving && !pose.hit) {
          if (!squadron) {
            squadron = true;
            c.save();
            c.translate(pose.entering ? pose.x : w / 2, pose.entering ? pose.y : row.y);
            c.globalAlpha = row.instrument.muted ? 0.3 : 0.75;
            c.strokeRect(-w * 0.2, -9, w * 0.4, 18);
            c.textAlign = 'center';
            c.fillStyle = col;
            c.fillText(`SQUADRON ×${String(notes.length)}`, 0, 4);
            c.restore();
          }
          c.globalAlpha = 0.3;
          c.fillRect(g.x(n.start), row.y - 5, 2, 10);
        } else if (alive) {
          // A short curved wake makes the loop and curling dive readable in a still frame.
          if (pose.diving || pose.entering) {
            c.save();
            c.globalAlpha = row.instrument.muted ? 0.12 : 0.35;
            c.lineWidth = 1.5;
            c.beginPath();
            for (let step = 0; step <= 12; step++) {
              const past = enemyPose(
                n,
                { ...f, now: f.now - (12 - step) * f.cps * 0.014 },
                g.y(n),
                g.x,
              );
              if (step === 0) c.moveTo(past.x, past.y);
              else c.lineTo(past.x, past.y);
            }
            c.stroke();
            c.restore();
          }
          if (flagship && pose.hit && pose.remaining > 0) {
            const origin = pose.y + spriteRadius(n, w, h) * 0.85;
            const length = (g.shipY - origin - 15) * pose.remaining;
            c.save();
            const beam = c.createLinearGradient(0, pose.y, 0, pose.y + Math.max(1, length));
            beam.addColorStop(0, col);
            beam.addColorStop(1, t.ground);
            c.fillStyle = beam;
            c.globalAlpha = row.instrument.muted ? 0.08 : 0.3;
            c.beginPath();
            c.moveTo(pose.x - 5, origin);
            c.lineTo(pose.x - 26, origin + length);
            c.lineTo(pose.x + 26, origin + length);
            c.lineTo(pose.x + 5, origin);
            c.fill();
            c.globalAlpha = row.instrument.muted ? 0.15 : 0.8;
            c.strokeStyle = col;
            line(c, pose.x - 26, origin + length, pose.x + 26, origin + length);
            c.restore();
          }
          c.save();
          c.translate(pose.x, pose.y);
          c.rotate(pose.angle);
          c.globalAlpha = row.instrument.muted ? 0.3 : 1;
          c.shadowColor = col;
          c.shadowBlur = t.glow && (pose.diving || pose.hit) ? 10 : 0;
          beetle(
            c,
            spriteRadius(n, w, h),
            flagship,
            f.now,
            col,
            t.text,
            t.ground,
            row.instrument.index,
          );
          c.restore();
        }
        if (!row.instrument.muted) {
          c.fillStyle = col;
          effect(n, pose.hitX, pose.hitY);
          const shotDuration = Math.max(0.001, f.cps) * 0.09;
          const u = 1 + (f.now - n.start) / shotDuration;
          if (n.hasOnset && !flagship && u >= 0 && u <= 1) {
            // The projectile's head arrives at the enemy's hit point exactly on its onset.
            c.save();
            c.globalAlpha = 1;
            c.strokeStyle = t.text;
            c.lineWidth = 3;
            const startY = g.shipY - playerWidth(w) * 0.5;
            line(
              c,
              g.shipX + (pose.hitX - g.shipX) * Math.max(0, u - 0.18),
              startY + (pose.hitY - startY) * Math.max(0, u - 0.18),
              g.shipX + (pose.hitX - g.shipX) * u,
              startY + (pose.hitY - startY) * u,
            );
            c.restore();
          }
        }
      }
    }
    if (!row.instrument.muted)
      for (const n of row.recent) {
        const pose = enemyPose(n, f, g.y(n), g.x);
        c.fillStyle = col;
        effect(n, pose.hitX, pose.hitY);
      }
  }
  c.globalAlpha = 1;
  c.fillStyle = t.text;
  c.save();
  c.translate(g.shipX, g.shipY);
  const playerScale = playerWidth(w) / 37;
  c.scale(playerScale, playerScale);
  // Asymmetric twin sails around an open central cockpit.
  c.beginPath();
  c.moveTo(-4, -19);
  c.lineTo(-21, 15);
  c.lineTo(-5, 8);
  c.lineTo(5, 8);
  c.lineTo(16, 20);
  c.lineTo(8, -10);
  c.closePath();
  c.fill();
  c.fillStyle = t.accent;
  c.fillRect(-2, -4, 5, 10);
  c.globalAlpha = 0.6 + Math.sin(f.now * 75) * 0.25;
  c.fillRect(-3, 16, 6, 6 + 4 * Math.sin(f.now * 41));
  c.restore();
  c.globalAlpha = 1;
  c.strokeStyle = t.line;
  line(c, g.left, h - 27, g.right, h - 27);
  c.strokeStyle = t.accent;
  line(c, g.left, h - 27, g.left + (f.now - g.bar) * (g.right - g.left), h - 27);

  // Names sit above every squadron. The soft ground-coloured edge fades wakes
  // beneath each small plate without changing any flight path.
  c.save();
  c.textAlign = 'right';
  c.font = `10px "${t.fontMono}"`;
  const labels = g.rows.map((row) => ({
    y: row.y,
    name:
      row.crowded && row.enemies.length
        ? `${row.instrument.name} ×${String(row.enemies.length)}`
        : row.instrument.name,
  }));
  const right = w * 0.1;
  for (const label of labels) {
    const width = Math.min(c.measureText(label.name).width, right - 10);
    c.fillStyle = t.ground;
    c.shadowColor = t.ground;
    c.shadowBlur = 8;
    c.fillRect(right - width - 4, label.y - 10, width + 8, 20);
  }
  c.shadowBlur = 0;
  c.shadowColor = 'transparent';
  c.fillStyle = t.muted;
  for (const label of labels) c.fillText(label.name, right, label.y + 4, right - 10);
  c.restore();
}
export default {
  id: 'swarm',
  group: 'arcade',
  name: 'Swarm',
  tag: 'shooter',
  mount: (el) =>
    mount2d(
      el,
      (notes) => ({ drum: drumPart(notes) ?? null }),
      (c, f, data) => {
        draw(c, f, data.drum);
      },
    ),
} satisfies ViewDefinition;
