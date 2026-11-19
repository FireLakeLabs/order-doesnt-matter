import type { ViewDefinition, ViewFrame } from './types';
import { boutLayout, boutState, fighterAt, indexBout } from './bout/model';
import type { BoutScore, FighterState } from './bout/model';
import { random } from './shared/particles';
import { noteProgress } from './shared/timing';

type Point = [number, number];
function line(c: CanvasRenderingContext2D, points: Point[], ink: string, width = 2) {
  c.strokeStyle = ink;
  c.lineWidth = width;
  c.beginPath();
  points.forEach(([x, y], i) => {
    if (i) c.lineTo(x, y);
    else c.moveTo(x, y);
  });
  c.stroke();
}
function shape(c: CanvasRenderingContext2D, points: Point[], ink: string, edge?: string) {
  c.beginPath();
  points.forEach(([x, y], i) => {
    if (i) c.lineTo(x, y);
    else c.moveTo(x, y);
  });
  c.closePath();
  c.fillStyle = ink;
  c.fill();
  if (edge) {
    c.strokeStyle = edge;
    c.lineWidth = 2;
    c.stroke();
  }
}
function disc(c: CanvasRenderingContext2D, x: number, y: number, r: number, ink: string) {
  c.fillStyle = ink;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}
function fit(c: CanvasRenderingContext2D, value: string, width: number) {
  if (c.measureText(value).width <= width) return value;
  while (value && c.measureText(`${value}…`).width > width) value = value.slice(0, -1);
  return value ? `${value}…` : '';
}
function label(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  value: string,
  x: number,
  y: number,
  width: number,
  size = 11,
  align: CanvasTextAlign = 'center',
) {
  c.font = `${String(size)}px "${size > 16 ? f.theme.fontDisplay : f.theme.fontMono}"`;
  c.textAlign = align;
  const text = fit(c, value, Math.max(0, width));
  const w = c.measureText(text).width;
  c.fillStyle = f.theme.panel;
  c.fillRect(
    x - (align === 'center' ? w / 2 : align === 'right' ? w : 0) - 3,
    y - size - 2,
    w + 6,
    size + 5,
  );
  c.fillStyle = f.theme.text;
  c.fillText(text, x, y);
}
/** Original plated sparring automata: boots, bent knees, shoulder shells,
 * gauntlets and a visor. Every joint is derived from this frame's gesture. */
function fighter(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  state: FighterState,
  x: number,
  feet: number,
  scale: number,
  facing: number,
  part: ViewFrame['instruments'][number],
  reach: number,
) {
  const t = f.theme,
    ink = part.muted ? t.muted : part.colour,
    g = state.lead,
    e = state.extension;
  const guarding = !g || g.move === 'guard';
  const charge = state.charge;
  const lean = guarding
    ? e * 9
    : e * (g.move === 'bass blow' ? 38 : g.move === 'heavy' ? 28 : 20) - charge * 8;
  const step = guarding ? e * 19 : e * (g.move === 'bass blow' ? 15 : 7);
  c.save();
  c.translate(x, feet);
  c.scale(scale * facing, scale);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.fillStyle = t.ground;
  c.beginPath();
  c.ellipse(0, 5, 81, 10, 0, 0, Math.PI * 2);
  c.fill();
  // Far leg first; broad greaves and separate boots make a grounded stance.
  for (const side of [-1, 1]) {
    const hip: Point = [side * 17 + lean * 0.25, -85];
    const knee: Point = [side * 35 + step, -48 - (side === 1 ? step * 0.3 : 0)];
    const ankle: Point = [side * 57 + step, -10];
    line(c, [hip, knee, ankle], t.ground, 29);
    line(c, [hip, knee, ankle], ink, 23);
    line(
      c,
      [
        [knee[0], knee[1] + 5],
        [ankle[0], -15],
      ],
      t.panel,
      14,
    );
    disc(c, knee[0], knee[1], 11, t.text);
    disc(c, knee[0], knee[1], 6, ink);
    shape(
      c,
      [
        [ankle[0] - 14, -17],
        [ankle[0] + 8, -17],
        [ankle[0] + 23, -6],
        [ankle[0] + 21, 1],
        [ankle[0] - 15, 1],
      ],
      t.text,
      t.ground,
    );
    line(
      c,
      [
        [ankle[0] - 14, 1],
        [ankle[0] + 21, 1],
      ],
      t.ground,
      4,
    );
  }
  const shoulder = lean + 9;
  const limb = (points: Point[], width: number) => {
    line(c, points, t.ground, width + 7);
    line(c, points, ink, width);
    disc(c, points[1][0], points[1][1], width * 0.47, t.panel);
    disc(c, points[1][0], points[1][1], 3, t.text);
    const hand = points[2];
    const glove = g?.move === 'bass blow' ? 16 : g?.move === 'heavy' ? 13 : 11;
    disc(c, hand[0], hand[1], glove + 3, t.ground);
    disc(c, hand[0], hand[1], glove, t.text);
    line(
      c,
      [
        [hand[0] - 6, hand[1] + 4],
        [hand[0] + 6, hand[1] + 4],
      ],
      ink,
      5,
    );
  };
  // Rear arm braces the jaw, with its elbow visibly below the glove.
  limb(
    [
      [shoulder - 30, -167],
      [shoulder - 53, -136],
      [shoulder - 18, -193 + charge * 17],
    ],
    17,
  );
  shape(
    c,
    [
      [lean - 30, -172],
      [lean + 28, -179],
      [lean + 39, -130],
      [lean + 22, -91],
      [lean * 0.25 - 28, -92],
      [lean - 39, -139],
    ],
    ink,
    t.ground,
  );
  shape(
    c,
    [
      [lean - 20, -166],
      [lean + 20, -169],
      [lean + 25, -136],
      [lean - 18, -136],
    ],
    t.panel,
    t.text,
  );
  line(
    c,
    [
      [lean - 10, -155],
      [lean + 15, -156],
    ],
    ink,
    5,
  );
  shape(
    c,
    [
      [lean * 0.25 - 29, -103],
      [lean * 0.25 + 26, -103],
      [lean * 0.25 + 30, -77],
      [lean * 0.25 - 26, -78],
    ],
    t.panel,
    t.text,
  );
  line(
    c,
    [
      [lean * 0.25 - 23, -96],
      [lean * 0.25 + 23, -96],
    ],
    ink,
    6,
  );
  const extend = Math.max(0, e);
  const hand: Point = guarding
    ? [shoulder + 49 + extend * 7, -207 + extend * 4]
    : g.charging
      ? [shoulder + 31, -129]
      : [
          shoulder + 51 + extend * (reach - shoulder - 51),
          -192 - extend * (g.move === 'bass blow' ? -23 : g.move === 'heavy' ? -12 : 4),
        ];
  const elbow: Point = guarding
    ? [shoulder + 54, -151]
    : [shoulder + 57 + extend * (reach * 0.5 - 57), -139 - extend * 48];
  limb([[shoulder + 23, -167], elbow, hand], 19);
  disc(c, shoulder + 23, -167, 17, ink);
  line(
    c,
    [
      [shoulder + 14, -175],
      [shoulder + 31, -173],
    ],
    t.text,
    3,
  );
  // Asymmetric helmet crest, neck, jaw and luminous horizontal visor.
  line(
    c,
    [
      [lean, -176],
      [lean, -192],
    ],
    t.panel,
    18,
  );
  shape(
    c,
    [
      [lean - 28, -208],
      [lean - 25, -231],
      [lean - 4, -245],
      [lean + 23, -229],
      [lean + 30, -205],
      [lean + 15, -188],
      [lean - 16, -189],
    ],
    ink,
    t.ground,
  );
  shape(
    c,
    [
      [lean - 27, -229],
      [lean - 42, -248],
      [lean - 12, -237],
    ],
    t.text,
    t.ground,
  );
  shape(
    c,
    [
      [lean - 16, -221],
      [lean + 24, -219],
      [lean + 25, -208],
      [lean - 13, -207],
    ],
    t.panel,
  );
  line(
    c,
    [
      [lean + 5, -216],
      [lean + 20, -215],
    ],
    t.text,
    3,
  );
  line(
    c,
    [
      [lean - 9, -197],
      [lean + 13, -196],
    ],
    t.panel,
    3,
  );
  if (charge > 0) {
    c.strokeStyle = ink;
    c.lineWidth = 3;
    c.beginPath();
    c.arc(shoulder + 31, -129, 22 + charge * 16, -Math.PI / 2, -Math.PI / 2 + charge * Math.PI * 2);
    c.stroke();
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3 + (g ? noteProgress(g.note, f.now) : 0) * Math.PI;
      disc(
        c,
        shoulder + 31 + Math.cos(angle) * 37,
        -129 + Math.sin(angle) * 37,
        2 + charge * 2,
        t.text,
      );
    }
  }
  if (g && !g.charging && g.power > 0.1 && g.move !== 'guard') {
    c.globalAlpha = g.power;
    line(
      c,
      [
        [hand[0] - 17, hand[1] - 24],
        [hand[0] + 17, hand[1] - 13],
      ],
      ink,
      3,
    );
    line(
      c,
      [
        [hand[0] - 10, hand[1] + 24],
        [hand[0] + 21, hand[1] + 15],
      ],
      ink,
      3,
    );
  }
  // A released voice remains visible even while another held voice charges.
  const releases = state.layers.filter((l) => l.move === 'special' && !l.charging && l.age >= 0);
  if (releases.length) {
    const power = Math.max(...releases.map((l) => l.power));
    c.globalAlpha = power;
    c.strokeStyle = ink;
    c.lineWidth = 7;
    c.beginPath();
    c.ellipse(reach + 25, -185, 24 + power * 18, 33, 0, 0, Math.PI * 2);
    c.stroke();
  }
  c.restore();
}
function draw(c: CanvasRenderingContext2D, f: ViewFrame, score: BoutScore) {
  const { width: w, height: h, theme: t } = f,
    box = boutLayout(w, h),
    state = boutState(score, f);
  const poses = state.fighters.map((fighter) => fighterAt(score, fighter.part.id, f.now));
  c.fillStyle = t.ground;
  c.fillRect(0, 0, w, h);
  const floor = box.feet - 19;
  // Arena architecture: a suspended lighting truss, spectator tiers and a
  // broad perspective fighting platform, with no dashboard cells in the field.
  line(
    c,
    [
      [22, box.top + 12],
      [22, floor],
      [w - 22, floor],
      [w - 22, box.top + 12],
    ],
    t.line,
    6,
  );
  line(
    c,
    [
      [22, box.top + 12],
      [w - 22, box.top + 12],
    ],
    t.muted,
    4,
  );
  // The native hold ring is 45 px including its stroke; reserve a 1 px gutter.
  const lampScale = Math.min(1, (w - 70) / Math.max(1, f.instruments.length) / 46);
  for (let i = 0; i < Math.max(1, f.instruments.length); i++) {
    const x = 35 + ((i + 0.5) * (w - 70)) / Math.max(1, f.instruments.length);
    const a = state.arena.find((a) => a.part.index === i);
    const light = a ? Math.max(a.light, a.holds.length ? 0.65 : 0) : 0;
    if (light && a) {
      c.globalAlpha = light * 0.12;
      shape(
        c,
        [
          [x - 8, box.top + 21],
          [x + 8, box.top + 21],
          [x + 65, floor],
          [x - 65, floor],
        ],
        a.part.colour,
      );
      c.globalAlpha = 1;
    }
    shape(
      c,
      [
        [x - 10 * lampScale, box.top + 8],
        [x + 10 * lampScale, box.top + 8],
        [x + 15 * lampScale, box.top + 23],
        [x - 15 * lampScale, box.top + 23],
      ],
      t.panel,
      t.muted,
    );
    line(
      c,
      [
        [x - 9 * lampScale, box.top + 23],
        [x + 9 * lampScale, box.top + 23],
      ],
      light ? (a?.part.colour ?? t.line) : t.line,
      4 * lampScale,
    );
    for (const note of a?.holds ?? []) {
      c.strokeStyle = a?.part.colour ?? t.line;
      c.lineWidth = 3 * lampScale;
      c.beginPath();
      c.arc(
        x,
        box.top + 16,
        21 * lampScale,
        -Math.PI / 2,
        -Math.PI / 2 + noteProgress(note, f.now) * Math.PI * 2,
      );
      c.stroke();
    }
  }
  for (let tier = 0; tier < 3; tier++)
    for (let i = 0; i < Math.floor(w / 18); i++) {
      const x = 14 + i * 18 + (tier % 2) * 9,
        y = floor - 19 - tier * 22 + random(i, tier) * 7;
      const a = state.arena.find((a) => a.part.index === i % Math.max(1, f.instruments.length));
      const flash = a?.light ?? 0;
      const ink = flash > 0.12 && (i + tier) % 3 === 0 ? (a?.part.colour ?? t.line) : t.line;
      disc(c, x, y - 7, 4, ink);
      c.fillStyle = ink;
      c.fillRect(x - 5, y - 2, 10, 10);
      if (flash > 0.3)
        line(
          c,
          [
            [x - 7, y - 9],
            [x - 5, y + 1],
            [x + 5, y + 1],
            [x + 8, y - 12],
          ],
          ink,
          2,
        );
    }
  shape(
    c,
    [
      [28, floor],
      [w - 28, floor],
      [w - 7, h - box.footer - 4],
      [7, h - box.footer - 4],
    ],
    t.panel,
    t.line,
  );
  line(
    c,
    [
      [28, floor],
      [w - 28, floor],
    ],
    t.muted,
    3,
  );
  for (const fraction of [0.16, 0.34, 0.5, 0.66, 0.84])
    line(
      c,
      [
        [w * fraction, floor + 3],
        [w * (fraction * 1.12 - 0.06), h - box.footer - 5],
      ],
      t.line,
      1,
    );
  c.save();
  c.globalAlpha = 0.22;
  c.strokeStyle = t.muted;
  c.lineWidth = 2;
  c.beginPath();
  c.ellipse(w / 2, box.feet + 2, w * 0.3, 19, 0, 0, Math.PI * 2);
  c.stroke();
  c.restore();
  const xs = [box.left, box.right],
    reach = Math.min(190, (box.right - box.left) / 2 / box.scale);
  state.departures.forEach((ftr) => {
    if (state.tag >= 1) return;
    const side = state.previous.findIndex((p) => p.part.id === ftr.part.id);
    c.save();
    c.globalAlpha = 1 - state.tag;
    fighter(
      c,
      f,
      fighterAt(score, ftr.part.id, f.now),
      xs[side] + (side ? 1 : -1) * state.tag * w * 0.35,
      box.feet,
      box.scale,
      side ? -1 : 1,
      ftr.part,
      reach,
    );
    c.restore();
  });
  state.fighters.forEach((ftr, side) => {
    const old = state.previous.findIndex((p) => p.part.id === ftr.part.id);
    const start = old >= 0 ? xs[old] : side ? w + 70 : -70;
    const progress = state.tag * state.tag * (3 - 2 * state.tag);
    const x = start + (xs[side] - start) * progress;
    fighter(c, f, poses[side], x, box.feet, box.scale, side ? -1 : 1, ftr.part, reach);
  });
  const clash = state.clashes.at(-1);
  if (clash) {
    const age = (f.now - clash.time) / 0.16;
    c.globalAlpha = 1 - age;
    for (let i = 0; i < 16; i++) {
      const angle = random(i, Math.round(clash.time * 1000)) * Math.PI * 2;
      const radius = 9 + age * (35 + random(i, 7) * 48);
      line(
        c,
        [
          [w / 2 + Math.cos(angle) * radius, box.feet - 175 * box.scale + Math.sin(angle) * radius],
          [
            w / 2 + Math.cos(angle) * (radius + 10),
            box.feet - 175 * box.scale + Math.sin(angle) * (radius + 10),
          ],
        ],
        t.accent,
        3,
      );
    }
    c.globalAlpha = 1;
  }
  // Text comes last on opaque token plates. Names never double as moving ink.
  c.fillStyle = t.panel;
  c.fillRect(10, 8, w - 20, 83);
  label(c, f, 'BOUT', 22, 32, w * 0.2, 20, 'left');
  label(
    c,
    f,
    `ROUND ${String(state.round)} · ${state.section.toUpperCase()}`,
    w / 2,
    30,
    w * 0.52,
    14,
  );
  label(
    c,
    f,
    `bar ${String(Math.floor(f.now) + 1)} · ${String(Math.round((f.now % 1) * 100))}%`,
    w - 22,
    31,
    w * 0.2,
    11,
    'right',
  );
  state.fighters.forEach((ftr, side) => {
    const x = side ? w / 2 + 17 : 22,
      length = w / 2 - 39;
    label(
      c,
      f,
      `${String(ftr.noteCount)}/${String(state.total)} · ${ftr.part.name}`,
      side ? w - 22 : 22,
      53,
      length,
      11,
      side ? 'right' : 'left',
    );
    c.fillStyle = t.line;
    c.fillRect(x, 62, length, 8);
    c.fillStyle = ftr.part.colour;
    const filled = (length * ftr.noteCount) / Math.max(1, state.total);
    c.fillRect(side ? x + length - filled : x, 62, filled, 8);
    const pose = poses[side];
    const incoming = !state.previous.some((p) => p.part.id === ftr.part.id) && state.tag < 1;
    label(
      c,
      f,
      `${pose.count > 1 ? `×${String(pose.count)} · ` : ''}${incoming ? 'TAG IN · ' : ''}${pose.label}${ftr.part.muted ? ' · muted' : ''}`,
      xs[side],
      box.feet + 27,
      w * 0.25,
      12,
    );
    label(
      c,
      f,
      `${ftr.part.name} · ${score.moves.get(ftr.part.id) ?? 'jab'}`,
      xs[side],
      box.feet + 44,
      w * 0.25,
    );
  });
  label(
    c,
    f,
    `ACTIVITY SHARE · ${String(state.from + 1)}–${String(state.to)} · not damage`,
    w / 2,
    85,
    w - 36,
  );
  if (state.clashes.length)
    label(
      c,
      f,
      `CLASH ×${String(state.clashes.reduce((n, g) => n + g.count, 0))}`,
      w / 2,
      box.top + 4,
      w * 0.4,
      12,
    );
  if (!state.fighters.length)
    label(c, f, 'NO ONSETS IN WINDOW · ARENA HOLDS REMAIN', w / 2, h / 2, w - 40, 12);
  if (state.fighters.length === 1)
    label(c, f, 'WAITING FOR A CHALLENGER', box.right, box.feet - 100 * box.scale, w * 0.36);
  const start = h - box.footer;
  c.fillStyle = t.panel;
  c.fillRect(0, start, w, box.footer);
  line(
    c,
    [
      [12, start],
      [w - 12, start],
    ],
    t.line,
  );
  const columns = w < 700 ? 2 : Math.min(4, Math.max(2, Math.floor(w / 220))),
    rows = 2;
  const capacity = columns * rows;
  // Fixed row-index buckets keep each note's lamp and meter in place when
  // another part leaves the window. Crowded buckets merge with explicit counts.
  const buckets = Array.from({ length: capacity }, () => [] as typeof state.arena);
  for (const part of state.arena) buckets[part.part.index % capacity].push(part);
  buckets.forEach((entries, i) => {
    const first = entries.find((a) => a.holds.length > 0) ?? entries.at(0);
    if (!first) return;
    const x = 16 + ((i % columns) * (w - 32)) / columns;
    const y = start + 19 + Math.floor(i / columns) * 28;
    const cw = (w - 32) / columns - 15;
    const holds = entries.flatMap((a) => a.holds);
    const pulses = entries.reduce((n, a) => n + a.pulses.length, 0);
    const light = Math.max(...entries.map((a) => a.light));
    disc(c, x + 3, y - 4, 3, first.part.colour);
    const action =
      entries.length > 1
        ? `H${String(holds.length)} F${String(pulses)}`
        : holds.length
          ? `HOLD ×${String(holds.length)}`
          : pulses
            ? `FLASH ×${String(pulses)}`
            : 'light';
    label(
      c,
      f,
      `${action}${entries.length > 1 ? ` +${String(entries.length - 1)} parts` : ''} · ${first.part.name}`,
      x + 13,
      y,
      cw - 13,
      11,
      'left',
    );
    c.fillStyle = t.line;
    c.fillRect(x, y + 5, cw, 3);
    for (const a of entries)
      for (const n of a.holds) {
        c.fillStyle = a.part.colour;
        c.fillRect(x, y + 5, cw * noteProgress(n, f.now), 3);
      }
    if (!holds.length && light) {
      c.fillStyle = first.part.colour;
      c.fillRect(x, y + 5, cw * light, 3);
    }
  });
  const legend =
    w < 700
      ? ['Rhythm / pitch → moves · span → special', 'Arena: H hold · F flash · span fills lamp']
      : ['Rhythm / pitch → moves · span → special · H hold / F flash · crowds ×n'];
  legend.forEach((v, i) => {
    label(c, f, v, w / 2, h - 10 - (legend.length - 1 - i) * 16, w - 24);
  });
}
const view: ViewDefinition = {
  id: 'bout',
  name: 'Bout',
  group: 'arcade',
  tag: 'fighters',
  needs: 'score',
  span: 'window',
  mount(element) {
    const canvas = document.createElement('canvas'),
      c = canvas.getContext('2d');
    if (!c) throw Error('Canvas 2D is unavailable');
    element.append(canvas);
    let notes: ViewFrame['notes'] | undefined, score: BoutScore | undefined;
    return {
      frame(f) {
        if (f.width <= 0 || f.height <= 0) return;
        const w = Math.max(1, Math.round(f.width * f.dpr)),
          h = Math.max(1, Math.round(f.height * f.dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        canvas.style.width = `${String(f.width)}px`;
        canvas.style.height = `${String(f.height)}px`;
        c.reset();
        c.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
        if (notes !== f.notes) {
          notes = f.notes;
          score = indexBout(notes);
        }
        if (score) draw(c, f, score);
      },
      dispose() {
        canvas.remove();
        canvas.width = canvas.height = 0;
        notes = undefined;
        score = undefined;
      },
    };
  },
};
export default view;
