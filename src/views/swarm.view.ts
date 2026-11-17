import type { ViewDefinition, ViewFrame, ViewNote } from './types';
import { mount2d, line } from './shared/retro-2d';
import { burst, spark, star, type Particle } from './shared/particles';
import { clamp } from './shared/math';
import {
  enemyPose,
  enemySize,
  formation,
  hitCount,
  isCarrier,
  playerWidth,
  seed,
  wave,
} from './swarm/model';

function hull(c: CanvasRenderingContext2D, x: number, y: number, radius: number, variant: number) {
  // Original split-pod scouts: two pods joined by an offset diamond spine.
  c.beginPath();
  c.moveTo(x, y - radius);
  c.lineTo(x + radius * 0.9, y);
  c.lineTo(x, y + radius * 0.7);
  c.lineTo(x - radius * 0.9, y);
  c.closePath();
  c.fill();
  if (variant % 2) {
    c.fillRect(x - radius, y - radius * 0.45, radius * 0.3, radius);
    c.fillRect(x + radius * 0.7, y - radius * 0.45, radius * 0.3, radius);
  } else {
    c.strokeRect(x - radius, y - radius * 0.45, radius * 2, radius * 0.9);
  }
}
function draw(c: CanvasRenderingContext2D, f: ViewFrame) {
  const t = f.theme,
    w = f.width,
    h = f.height;
  const g = formation(f),
    currentWave = wave(f);
  const particle: Particle = { x: 0, y: 0, alpha: 0 };
  c.font = `11px "${t.fontMono}"`;
  for (let i = 0; i < Math.min(100, w / 9); i++) {
    star(i + currentWave.number * 101, f.now, particle);
    c.globalAlpha = particle.alpha * 0.4;
    c.fillStyle = t.muted;
    c.fillRect(particle.x * w, 65 + particle.y * (h - 100), i % 7 ? 1 : 2, 2);
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
  c.fillText(`BAR HITS ${String(hitCount(f))}`, w - 24, 32);
  c.fillStyle = t.muted;
  c.fillText(`${String(g.bar + 1)} · ${String(Math.round((f.now - g.bar) * 100))}%`, w - 24, 53);

  const effect = (note: ViewNote, x: number, y: number, carrier = false) => {
    const duration = carrier ? 0.18 : f.trails === 2 ? 0.3 : f.trails === 1 ? 0.18 : 0.045;
    const age = (f.now - note.start) / duration;
    if (!note.hasOnset || age < 0 || age >= 1) return;
    c.save();
    c.shadowColor = c.fillStyle as string;
    c.shadowBlur = t.glow ? 8 : 0;
    for (let bit = 0; bit < 7; bit++) {
      (carrier ? spark : burst)(seed(note) + bit * 37, age, particle);
      c.globalAlpha = particle.alpha;
      c.fillRect(x + particle.x * 38, y + particle.y * 38, 2, 2);
    }
    c.globalAlpha = 1 - age;
    c.fillStyle = t.text;
    c.beginPath();
    c.arc(x, y, 4 * (1 - age), 0, Math.PI * 2);
    c.fill();
    c.restore();
  };

  for (const row of g.rows) {
    const col = row.instrument.muted ? t.muted : row.instrument.colour;
    c.globalAlpha = 1;
    c.fillStyle = t.muted;
    c.textAlign = 'right';
    c.font = `10px "${t.fontMono}"`;
    c.fillText(row.instrument.name, g.left - 28, row.y + 4, g.left - 35);
    c.strokeStyle = t.line;
    c.globalAlpha = 0.35;
    line(c, g.left, row.y, g.right, row.y);
    // The actual next bar's notes, rather than clones of this bar's destroyed slots.
    c.fillStyle = col;
    c.strokeStyle = col;
    c.globalAlpha = 0.3;
    if (row.nextCrowded) {
      for (const n of row.nextEnemies)
        c.fillRect(g.x(n.start - 1), row.y - 5, Math.max(1, g.x(n.end - 1) - g.x(n.start - 1)), 10);
    } else
      for (const n of row.nextEnemies) {
        const x = g.x(n.start - 1);
        if (isCarrier(n)) c.fillRect(x, row.y - 5, Math.max(1, g.x(n.end - 1) - x), 10);
        else hull(c, x, row.y, enemySize(n, w), row.instrument.index);
      }
    c.globalAlpha = row.instrument.muted ? 0.35 : 1;
    c.fillStyle = col;
    c.strokeStyle = col;
    if (row.crowded) {
      // Every span contributes occupancy; the shield's count preserves stacked unisons too.
      c.strokeRect(g.left - 7, row.y - 9, g.right - g.left + 14, 18);
      for (const n of row.enemies) {
        c.globalAlpha = (n.start <= f.now ? 0.28 : 0.85) * (row.instrument.muted ? 0.35 : 1);
        c.fillRect(g.x(n.start), row.y - 5, Math.max(1, g.x(n.end) - g.x(n.start)), 10);
      }
      c.globalAlpha = 1;
      c.fillStyle = t.text;
      c.textAlign = 'right';
      c.fillText(`×${String(row.enemies.length)}`, g.right - 5, row.y - 13);
      if (!row.instrument.muted) for (const n of row.enemies) effect(n, g.x(n.start), row.y);
      continue;
    }
    for (const n of [...row.enemies, ...row.nextEnemies.filter((n) => n.start - f.now <= 1 / 8)]) {
      const x = g.x(n.start),
        carrier = isCarrier(n),
        hitY = g.shipY - 45;
      const pose = enemyPose(n, f.now, x, row.y, hitY);
      c.fillStyle = col;
      c.strokeStyle = col;
      c.globalAlpha = row.instrument.muted ? 0.35 : 1;
      if (carrier) {
        const halfHeight = enemySize(n, w) * 0.55;
        const end = g.x(n.end),
          burn = g.x(Math.max(n.start, f.now));
        c.globalAlpha *= 0.15;
        c.fillRect(x, row.y - halfHeight, Math.max(1, end - x), halfHeight * 2);
        c.globalAlpha = row.instrument.muted ? 0.35 : 1;
        if (pose.remaining > 0) {
          const start = Math.max(x, burn);
          c.fillRect(start, row.y - halfHeight, Math.max(1, end - start), halfHeight * 2);
          c.fillStyle = t.ground;
          for (let rib = start + 9; rib < end - 3; rib += 22)
            c.fillRect(rib, row.y - 2, Math.min(12, end - rib), 4);
          if (pose.hit && !row.instrument.muted) {
            c.fillStyle = col;
            const age = ((f.now - n.start) * 8) % 1;
            for (let bit = 0; bit < 4; bit++) {
              spark(seed(n) + bit * 53, age, particle);
              c.globalAlpha = particle.alpha;
              c.fillRect(start + particle.x * 20, row.y + particle.y * 22, 2, 2);
            }
          }
        }
      } else if (!pose.hit) {
        if (pose.diving) {
          c.globalAlpha *= 0.4;
          c.setLineDash([3, 5]);
          line(c, x, row.y, pose.x, pose.y);
          c.setLineDash([]);
          c.globalAlpha = row.instrument.muted ? 0.35 : 1;
          c.shadowColor = col;
          c.shadowBlur = t.glow ? 8 : 0;
        }
        hull(c, pose.x, pose.y, enemySize(n, w), row.instrument.index);
        c.shadowBlur = 0;
      }
      if (carrier && pose.diving) {
        // The carrier's nose dives; its scored hull remains in formation to show duration.
        c.fillStyle = col;
        c.globalAlpha = row.instrument.muted ? 0.35 : 1;
        hull(c, pose.x, pose.y, enemySize(n, w), row.instrument.index);
      }
      if (!row.instrument.muted) {
        c.fillStyle = col;
        effect(n, x, carrier ? row.y : hitY, carrier);
        if (pose.diving) {
          c.strokeStyle = t.text;
          c.globalAlpha = 0.7;
          const u = clamp(1 - (n.start - f.now) * 8);
          line(c, g.shipX, g.shipY - 13, g.shipX + (x - g.shipX) * u, g.shipY - 13 - 32 * u);
        }
      }
    }
  }
  c.globalAlpha = 0.4;
  c.strokeStyle = t.accent;
  c.setLineDash([2, 6]);
  line(c, g.shipX, 83, g.shipX, g.shipY - 18);
  c.setLineDash([]);
  c.globalAlpha = 1;
  c.fillStyle = t.text;
  // Asymmetric twin sails around an open central cockpit.
  c.save();
  c.translate(g.shipX, g.shipY);
  const playerScale = playerWidth(w) / 37;
  c.scale(playerScale, playerScale);
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
  line(c, g.left, h - 31, g.right, h - 31);
  c.strokeStyle = t.text;
  line(c, g.left, h - 31, g.shipX, h - 31);
  c.font = `10px "${t.fontMono}"`;
  c.fillStyle = t.muted;
  c.textAlign = 'left';
  c.fillText('bar start', g.left, h - 12);
  c.textAlign = 'right';
  c.fillText('bar end', g.right, h - 12);
  c.textAlign = 'center';
  c.fillStyle = t.text;
  c.fillText('ship = playhead', clamp(g.shipX, g.left + 100, g.right - 100), h - 12);
}
export default {
  id: 'swarm',
  group: 'arcade',
  name: 'Swarm',
  tag: 'shooter',
  mount: (el) => mount2d(el, () => null, draw),
} satisfies ViewDefinition;
