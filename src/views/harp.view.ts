import type { ViewDefinition } from './types';
import { mount2d } from './shared/retro-2d';
import {
  analyse,
  displacement,
  layout,
  motion,
  partsAt,
  pitchLabel,
  sectionAt,
  shimmerWidth,
  stringGeometry,
  usesSection,
} from './harp/model';

const view: ViewDefinition = {
  id: 'harp',
  group: 'pitch',
  name: 'Harp',
  tag: 'pitch strings',
  span: 'song',
  mount(element) {
    return mount2d(element, analyse, (c, f, score) => {
      const { theme, width: w, height: h } = f,
        section = sectionAt(f);
      const g = layout(w, h, score.strings.length, score.drums.length);
      const owner = (id: string) => f.instruments.find((i) => i.id === id);
      const text = (
        value: string,
        x: number,
        y: number,
        size: number,
        colour = theme.muted,
        width = w - 40,
      ) => {
        c.font = `${String(size)}px "${theme.fontMono}"`;
        c.fillStyle = colour;
        let label = value;
        if (c.measureText(label).width > width) {
          while (label && c.measureText(label + '…').width > width) label = label.slice(0, -1);
          label += '…';
        }
        c.fillText(label, x, y);
      };
      const strings = score.strings.map((slot) => ({ slot, parts: partsAt(slot.voices, f) }));
      const heads = score.drums.map((head) => ({ head, parts: partsAt(head.voices, f) }));
      const sounding = [
        ...new Set(
          strings.flatMap(({ parts }) =>
            parts.flatMap((p) => p.voices.flatMap((v) => (v.midi === undefined ? [] : [v.midi]))),
          ),
        ),
      ].sort((a, b) => a - b);
      const activeCount = strings.reduce(
        (sum, s) => sum + s.parts.reduce((n, p) => n + p.voices.length, 0),
        0,
      );
      c.textAlign = 'left';
      c.fillStyle = theme.text;
      c.font = `600 24px "${theme.fontDisplay}"`;
      c.fillText('Harp', 20, 33);
      c.textAlign = 'right';
      text(
        `bar ${String(Math.floor(f.now) + 1)} · ${String(Math.floor((f.now % 1) * 100 + 1e-9))}% · ${section.name}`,
        w - 20,
        33,
        11,
        theme.muted,
        w - 110,
      );
      c.textAlign = 'left';
      text(
        `${String(score.pitchCount)} pitches · ${String(score.strings.length)} ${score.grouped ? 'octave groups' : 'strings'} · ${String(activeCount)} pitched notes · ${String(score.drums.length)} drumheads`,
        20,
        55,
        11,
      );
      text(
        `sounding (${String(sounding.length)}): ${sounding.length ? sounding.map(pitchLabel).join(' · ') : 'no pitched notes now'}`,
        20,
        74,
        11,
        theme.text,
      );
      if (strings.length) {
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.strokeStyle = theme.line;
        c.fillStyle = theme.panel;
        c.lineWidth = Math.max(12, 16 * g.scale);
        c.beginPath();
        c.moveTo(g.left - 20 * g.scale, g.top - 14);
        c.lineTo(g.left - 20 * g.scale, g.bottom + 12);
        c.stroke();
        c.beginPath();
        for (let i = 0; i <= 50; i++) {
          const v = stringGeometry(g, i, 51);
          if (!i) c.moveTo(v.x, v.top);
          else c.lineTo(v.x, v.top);
        }
        c.stroke();
        c.beginPath();
        c.moveTo(g.left, g.bottom);
        const last = stringGeometry(g, 1, 2);
        c.lineTo(g.right, last.bottom);
        c.stroke();
        for (const [i, { slot, parts }] of strings.entries()) {
          const line = stringGeometry(g, i, strings.length),
            length = line.bottom - line.top;
          const bright = usesSection(slot.voices, section);
          c.globalAlpha = 1;
          c.strokeStyle = bright ? theme.muted : theme.line;
          c.lineWidth = Math.max(1.2, (bright ? 1.8 : 1.2) * g.scale);
          c.beginPath();
          c.moveTo(line.x, line.top);
          c.lineTo(line.x, line.bottom);
          c.stroke();
          for (const [n, part] of parts.entries()) {
            const state = motion(part, f.now, (n * Math.PI * 2) / parts.length);
            const width = shimmerWidth(state.gain, g),
              colour = owner(part.instrument)?.colour ?? theme.accent;
            c.fillStyle = colour;
            c.globalAlpha = 0.12;
            c.beginPath();
            c.moveTo(line.x, line.top);
            c.quadraticCurveTo(
              line.x + width * 2,
              (line.top + line.bottom) / 2,
              line.x,
              line.bottom,
            );
            c.quadraticCurveTo(line.x - width * 2, (line.top + line.bottom) / 2, line.x, line.top);
            c.fill();
            c.globalAlpha = 1;
            c.strokeStyle = colour;
            c.lineWidth = Math.max(1.5, 2.5 * g.scale);
            c.shadowColor = colour;
            c.shadowBlur = theme.glow ? 6 : 0;
            c.beginPath();
            const amplitude = state.gain > 0 ? width / state.gain : 0;
            for (let j = 0; j <= 48; j++) {
              const u = j / 48,
                x = line.x + displacement(u, state) * amplitude;
              if (!j) c.moveTo(x, line.top);
              else c.lineTo(x, line.top + length * u);
            }
            c.stroke();
            c.shadowBlur = 0;
            if (state.pluck > 0) {
              c.globalAlpha = state.pluck;
              c.fillStyle = theme.text;
              c.beginPath();
              c.arc(
                line.x + displacement(1 / 3, state) * amplitude,
                line.top + length / 3,
                Math.max(2.5, 4 * g.scale),
                0,
                Math.PI * 2,
              );
              c.fill();
              c.globalAlpha = 1;
            }
          }
          c.save();
          c.translate(line.x, line.bottom + 17);
          const angled = g.spacing < 32;
          if (angled) c.rotate(Math.PI / 3);
          c.textAlign = angled ? 'left' : 'center';
          text(
            score.grouped ? `${slot.label} · ${String(slot.pitches.length)}` : slot.label,
            0,
            0,
            Math.max(10, Math.min(13, 10 * g.scale)),
            parts.length ? theme.text : bright ? theme.muted : theme.line,
            angled ? 55 : g.spacing - 2,
          );
          c.restore();
        }
      } else {
        c.textAlign = 'center';
        text('no pitched strings', w / 2, 120, 20, theme.text);
      }
      const onlyDrums = !strings.length;
      const columns = onlyDrums
        ? Math.max(1, Math.ceil(Math.sqrt((heads.length * w) / Math.max(120, h - 180))))
        : g.columns;
      const rows = Math.max(1, Math.ceil(heads.length / columns));
      for (const [i, { head, parts }] of heads.entries()) {
        const cell = onlyDrums ? (w - 40) / columns : g.drumWidth / Math.min(columns, heads.length);
        const cellHeight = onlyDrums ? (h - 180) / rows : 34;
        const x = (onlyDrums ? 20 : g.drumLeft) + ((i % columns) + 0.5) * cell;
        const y = onlyDrums
          ? 160 + (Math.floor(i / columns) + 0.5) * cellHeight
          : g.drumTop + Math.floor(i / columns) * 34 + 9;
        const ry = onlyDrums ? Math.min(cellHeight * 0.28, cell * 0.25) : Math.max(5, 7 * g.scale);
        const rx = onlyDrums
          ? Math.min(cell * 0.36, ry * 2.5)
          : Math.min(24 * g.scale, cell * 0.38);
        if (onlyDrums) {
          c.strokeStyle = theme.line;
          c.lineWidth = 4;
          c.beginPath();
          c.moveTo(x - cell * 0.45, y + ry + 3);
          c.lineTo(x + cell * 0.45, y + ry + 3);
          c.stroke();
        }
        const colour = owner(head.instrument)?.colour ?? theme.accent;
        c.globalAlpha = parts.length ? 1 : usesSection(head.voices, section) ? 0.65 : 0.3;
        c.fillStyle = parts.length ? colour : theme.panel;
        c.strokeStyle = colour;
        c.lineWidth = Math.max(1.5, 1.5 * g.scale);
        c.beginPath();
        c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.globalAlpha = 1;
        c.textAlign = 'center';
        text(
          owner(head.instrument)?.name ?? head.instrument,
          x,
          y + ry + 15,
          10,
          parts.length ? theme.text : theme.muted,
          cell - 4,
        );
      }
      c.globalAlpha = 1;
      c.textAlign = 'left';
    });
  },
};
export default view;
