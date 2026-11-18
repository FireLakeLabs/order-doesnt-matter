import type { ViewDefinition, ViewFrame } from './types';
import { mount2d, line } from './shared/retro-2d';
import { analyse, scene, type Data } from './ash-run/model';
import { background, roofs, windows } from './ash-run/scenery';
import { blasts, walker, crates, pigeons, dust } from './ash-run/effects';
import { drawRunner } from './ash-run/runner';

function draw(c: CanvasRenderingContext2D, f: ViewFrame, data: Data) {
  const s = scene(f, data),
    t = f.theme;
  c.setLineDash([]);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const sky = c.createLinearGradient(0, 0, 0, f.height);
  sky.addColorStop(0, '#14111c');
  sky.addColorStop(0.55, '#2e2028');
  sky.addColorStop(1, '#4e3028');
  c.fillStyle = sky;
  c.fillRect(0, 0, f.width, f.height);
  background(c, f, s, 0);
  background(c, f, s, 1);
  background(c, f, s, 2);
  walker(c, f, s);
  blasts(c, f, s, data);
  windows(c, f, s, data);
  roofs(c, f, s);
  dust(c, f, s, data);
  crates(c, f, s, data);
  pigeons(c, f, s, data);
  drawRunner(c, f, s);
  c.fillStyle = '#f4f1ff';
  c.textAlign = 'left';
  c.font = `600 24px "${t.fontDisplay}"`;
  c.fillText('Ash Run', 18, 32);
  c.fillStyle = '#b5a3b4';
  c.font = `11px "${t.fontMono}"`;
  c.fillText(
    `BAR ${String(Math.floor(f.now) + 1)} · ${String(Math.round((((f.now % 1) + 1) % 1) * 100))}% · ${String(Math.round(s.speed))} px/s`,
    18,
    52,
  );
  c.textAlign = 'right';
  c.fillStyle = '#ffd23f';
  c.fillText(`${s.district.name} · ${s.district.section ?? 'open city'}`, f.width - 18, 30);
  if (s.light) {
    c.fillStyle = '#b5a3b4';
    const name =
      f.instruments.find((i) => i.id === s.light?.instrument)?.name ?? s.light.instrument;
    c.fillText(
      `${name} · ${s.light.key} ${s.light.value.toFixed(2)} → beam · per note`,
      f.width - 18,
      49,
      f.width - 36,
    );
  }
  const labels: [string, string | undefined][] = [
    ['footfalls', s.roles.footfalls],
    ['crates', s.roles.snare],
    ['pigeons', s.roles.openHat],
    ['blasts', s.roles.kick],
    ['walker', s.roles.walker],
  ];
  const roleIds = labels.filter(([role]) => role !== 'footfalls').map(([, id]) => id);
  const windowNames = f.instruments
    .filter((i) => data.parts.has(i.id) && !roleIds.includes(i.id))
    .map((i) => i.name);
  c.fillStyle = t.panel;
  c.fillRect(0, f.height - 66, f.width, 66);
  c.strokeStyle = t.line;
  c.lineWidth = 1;
  line(c, 0, f.height - 66, f.width, f.height - 66);
  c.textAlign = 'left';
  c.font = `10px "${t.fontMono}"`;
  labels.forEach(([role, id], i) => {
    const x = 18 + (i * (f.width - 36)) / 5;
    c.fillStyle = t.muted;
    c.fillText(role, x, f.height - 49);
    c.fillStyle = t.text;
    c.fillText(
      f.instruments.find((v) => v.id === id)?.name ??
        (role === 'footfalls' ? 'tempo cadence' : 'none'),
      x,
      f.height - 34,
      (f.width - 50) / 5,
    );
  });
  c.fillStyle = t.muted;
  c.fillText(
    `windows · ${windowNames.join(' · ') || 'no other parts'}`,
    18,
    f.height - 13,
    f.width - 36,
  );
}
export default {
  id: 'ash-run',
  group: 'arcade',
  name: 'Ash Run',
  tag: 'rooftop chase',
  mount: (el) => mount2d(el, analyse, draw),
} satisfies ViewDefinition;
