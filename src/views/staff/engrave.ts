import type { Stave, StaveNote, GhostNote, Voice } from 'vexflow';
import type { ViewFrame } from '../types';
import license from './vexflow-license.txt?raw';
import {
  readPitch,
  duration,
  measure,
  scoreRange,
  staffScore,
  writtenPitch,
  staffLayout,
  staffCapacity,
} from './model';
import type { Mark, Part } from './model';

type Score = ReturnType<typeof staffScore>;
interface Row {
  parts: Part[];
  clef: Part['clef'];
  octave: number;
}
interface BarGeometry {
  bands: { top: number; bottom: number }[];
  start: number;
  end: number;
  points: { time: number; x: number }[];
}
export interface Engraving {
  bars: BarGeometry[];
  avoid: { x: number; y: number; width: number; height: number }[];
}
function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, width: number) {
  if (ctx.measureText(value).width <= width) {
    ctx.fillText(value, x, y);
    return;
  }
  while (value && ctx.measureText(`${value}…`).width > width) value = value.slice(0, -1);
  ctx.fillText(`${value}…`, x, y);
}
function wrap(
  ctx: CanvasRenderingContext2D,
  labels: string[],
  x: number,
  y: number,
  width: number,
  lines: number,
) {
  let line = '',
    row = 0,
    lineStart = 0;
  for (let i = 0; i < labels.length; i++) {
    const next = line ? `${line} · ${labels[i]}` : labels[i];
    if (ctx.measureText(next).width > width && line) {
      if (row === lines - 1) {
        text(ctx, `+${String(labels.length - lineStart)} entries`, x, y + row * 16, width);
        return;
      }
      text(ctx, line, x, y + row++ * 16, width);
      line = labels[i];
      lineStart = i;
    } else line = next;
  }
  if (line) text(ctx, line, x, y + row * 16, width);
}
export function createEngraver(library: typeof import('vexflow')) {
  const {
    Accidental,
    Annotation,
    Beam,
    CanvasContext,
    Dot,
    Formatter,
    Fraction,
    GhostNote,
    Stave,
    StaveConnector,
    StaveNote,
    StaveTie,
    Voice,
  } = library;
  // Keep the moving line out of VexFlow's own approximation text as well as our labels.
  class NotationContext extends CanvasContext {
    avoid: { x: number; y: number; width: number; height: number }[] = [];
    override fillText(value: string, x: number, y: number) {
      if (value === '≈') {
        const m = this.context2D.measureText(value);
        this.avoid.push({
          x: x - 2,
          y: y - m.actualBoundingBoxAscent - 2,
          width: m.width + 4,
          height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + 4,
        });
      }
      super.fillText(value, x, y);
      return this;
    }
  }
  function drawTie(context: NotationContext, first?: StaveNote, last?: StaveNote) {
    const reference = last ?? first;
    if (!reference) return;
    const stave = reference.checkStave();
    reference.getKeys().forEach((_, index) => {
      const y = reference.getYs()[index];
      // Extreme ledger notes curve into the staff, clear of the next part label.
      const direction =
        y > stave.getYForLine(4) + 5
          ? -1
          : y < stave.getYForLine(0) - 5
            ? 1
            : reference.getStemDirection();
      new StaveTie({
        first_note: first,
        last_note: last,
        first_indices: [index],
        last_indices: [index],
      })
        .setDirection(direction)
        .setContext(context)
        .draw();
    });
  }

  function noteFor(mark: Mark, part: Part, score: Score, stem: number, hideRest: boolean) {
    const d = duration(mark.ticks);
    const value = `${d.value}${d.dotted ? 'd' : ''}`;
    // Kit voices keep silent ticks without stacking four rests on top of the heads.
    // A completely resting kit still receives one visible whole-bar rest.
    if (mark.rest && hideRest) return new GhostNote(value);
    const drumKey =
      part.role === 'kick'
        ? 'f/4'
        : part.role === 'snare'
          ? 'c/5'
          : part.role === 'hat'
            ? 'g/5/X2'
            : part.role === 'open hat'
              ? 'g/5/X3'
              : 'a/4';
    const keys = mark.rest
      ? [
          part.clef === 'percussion'
            ? drumKey.split('/').slice(0, 2).join('/')
            : part.clef === 'bass'
              ? 'd/3'
              : 'b/4',
        ]
      : [
          ...new Set(
            mark.notes.map((n) =>
              part.clef === 'percussion'
                ? drumKey
                : writtenPitch(readPitch(n) ?? NaN, score.key.flats, part.octave),
            ),
          ),
        ];
    const note = new StaveNote({
      keys,
      duration: `${d.value}${d.dotted ? 'd' : ''}${mark.rest ? 'r' : ''}`,
      clef: part.clef,
      stem_direction: stem,
      auto_stem: part.clef !== 'percussion',
      align_center: mark.rest && mark.ticks === 64,
    });
    if (d.dotted) Dot.buildAndAttach([note], { all: true });
    if (mark.approximate)
      note.addModifier(
        new Annotation('≈')
          .setFont('sans-serif', 11)
          .setVerticalJustification(Annotation.VerticalJustify.TOP),
      );
    return note;
  }

  function engrave(ctx: CanvasRenderingContext2D, frame: ViewFrame, score: Score): Engraving {
    const { width, height, theme } = frame;
    const range = scoreRange(frame);
    const inRange = (p: Part) =>
      p.notes.some(
        (n) =>
          n.start < range.from + range.bars &&
          (n.end > range.from || (n.end <= n.start && n.start >= range.from)),
      );
    const pitched = score.parts
      .filter((p) => p.clef !== 'percussion' && inRange(p))
      .sort((a, b) => {
        // Upper bass first, then lower bass. Remaining staves follow document order.
        return Number(a.clef === 'treble') - Number(b.clef === 'treble') || a.octave - b.octave;
      });
    const drums = score.parts.filter((p) => p.clef === 'percussion' && inRange(p));
    const pitchedRows: Row[] = pitched.map((p) => ({ parts: [p], clef: p.clef, octave: p.octave }));
    const drumRow: Row | undefined = drums.length
      ? { parts: drums, clef: 'percussion', octave: 0 }
      : undefined;
    const all = [...pitchedRows, ...(drumRow ? [drumRow] : [])];
    const capacity = staffCapacity(height, !!drumRow);
    const rows = drumRow
      ? [...pitchedRows.slice(0, capacity - 1), drumRow]
      : pitchedRows.slice(0, capacity);
    const { top, bottom, columns, systems, systemHeight, tops } = staffLayout(
      rows.map((r) => r.clef),
      height,
      range.bars,
    );
    ctx.fillStyle = theme.ground;
    ctx.fillRect(0, 0, width, height);
    const context = new NotationContext(ctx);
    context.setFillStyle(theme.text).setStrokeStyle(theme.text);
    const count = range.bars;
    const signature = (stave: Stave, row: Row) => {
      stave.addClef(row.clef);
      if (row.clef !== 'percussion') stave.addKeySignature(score.key.name);
      return stave.addTimeSignature('4/4');
    };
    const prefix = Math.max(
      0,
      ...rows.map((row) => signature(new Stave(0, 0, width), row).getNoteStartX()),
    );
    const barWidth = (width - 48 - prefix) / columns;
    const bars: BarGeometry[] = [];
    const labels: { value: string; x: number; y: number; width: number; italic?: boolean }[] = [];
    let roundings = 0,
      total = 0,
      grouped = 0;
    const ties = new Map<string, { note: StaveNote; system: number }>();
    for (let b = 0; b < count; b++) {
      context.setFillStyle(theme.text).setStrokeStyle(theme.text);
      const column = b % columns,
        system = Math.floor(b / columns);
      const offset = system * systemHeight;
      const x = 24 + column * barWidth + (column ? prefix : 0),
        bar = range.from + b;
      const staveWidth = barWidth + (column ? 0 : prefix);
      const staves = rows.map((row, r) => {
        const stave = new Stave(
          x,
          top + offset + tops[r] + (row.clef === 'percussion' ? 16 : -4),
          staveWidth,
        );
        if (column === 0) signature(stave, row);
        stave.setStyle({ strokeStyle: theme.text, fillStyle: theme.text });
        return stave;
      });
      const start = Math.max(x + 18, ...staves.map((s) => s.getNoteStartX()));
      staves.forEach((s) => s.setNoteStartX(start));
      const end = x + staveWidth - 14;
      const geometry: BarGeometry = {
        start,
        end,
        points: [],
        bands: rows.map((row, r) => ({
          top: top + offset + tops[r] + (row.clef === 'percussion' ? 16 : 26),
          bottom: top + offset + tops[r] + (row.clef === 'percussion' ? 128 : 99),
        })),
      };
      bars.push(geometry);
      const formatter = new Formatter();
      const voices: Voice[] = [];
      const drawings: {
        voice: Voice;
        stave: Stave;
        notes: (StaveNote | GhostNote)[];
        marks: Mark[];
        part: Part;
      }[] = [];
      const rowCounts: { count: number; approx: number }[] = [];
      const groups: { r: number; count: number; approx: number; unasked: boolean }[] = [];
      rows.forEach((row, r) => {
        const stave = staves[r];
        stave.setContext(context).draw();
        const rowVoices: Voice[] = [];
        const measures = row.parts.map((p) =>
          measure(p.notes, bar, Math.max(4, Math.floor((end - start) / 14))),
        );
        rowCounts.push({
          count: measures.reduce((sum, m) => sum + m.count, 0),
          approx: measures.reduce((sum, m) => sum + m.approximate, 0),
        });
        const dense =
          row.parts.length > 4 ||
          measures.some(
            (m, i) =>
              m.grouped ||
              (row.parts[i].clef !== 'percussion' &&
                m.marks.some((mark) =>
                  mark.notes.some((n) => {
                    const p = readPitch(n);
                    const written = p === undefined ? NaN : p + row.parts[i].octave * 12;
                    return (
                      !Number.isFinite(written) ||
                      written < (row.clef === 'bass' ? 36 : 60) ||
                      written > (row.clef === 'bass' ? 60 : 84)
                    );
                  }),
                )),
          ) ||
          end - start < 70;
        if (dense || !range.asked[b]) {
          const n = measures.reduce((sum, m) => sum + m.count, 0),
            approx = measures.reduce((sum, m) => sum + m.approximate, 0);
          groups.push({ r, count: n, approx, unasked: !range.asked[b] });
          grouped += n;
          roundings += approx;
          total += n;
          return;
        }
        measures.forEach((m, v) => {
          const part = row.parts[v];
          total += m.count;
          roundings += m.approximate;
          const notes = m.marks.map((mark) =>
            noteFor(
              mark,
              part,
              score,
              part.clef === 'percussion' && part.role !== 'hat' ? -1 : 1,
              part.clef === 'percussion' && (v > 0 || measures.some((m) => m.count > 0)),
            ),
          );
          const voice = new Voice({ num_beats: 4, beat_value: 4 })
            .addTickables(notes)
            .setStave(stave);
          Accidental.applyAccidentals([voice], part.clef === 'percussion' ? 'C' : score.key.name);
          rowVoices.push(voice);
          voices.push(voice);
          drawings.push({ voice, stave, notes, marks: m.marks, part });
        });
        if (
          new Formatter().joinVoices(rowVoices).preCalculateMinTotalWidth(rowVoices) +
            (row.parts.some((p) => p.role === 'open hat') ? 14 : 0) >
          Math.max(20, end - start - 12)
        ) {
          voices.splice(voices.length - rowVoices.length);
          drawings.splice(drawings.length - rowVoices.length);
          const counts = rowCounts[r];
          groups.push({ r, ...counts, unasked: false });
          grouped += counts.count;
        } else formatter.joinVoices(rowVoices);
      });
      // Real glyph widths (especially accidentals and ≈) decide the final crowd limit.
      if (
        voices.length &&
        formatter.preCalculateMinTotalWidth(voices) > Math.max(20, end - start - 12)
      ) {
        rowCounts.forEach((counts, r) => {
          if (groups.some((g) => g.r === r)) return;
          groups.push({ r, ...counts, unasked: false });
          grouped += counts.count;
        });
        voices.length = 0;
      }
      if (voices.length) {
        // One formatter aligns every staff at the same musical instant.
        formatter.format(voices, Math.max(20, end - start - 12), { context });
        for (const drawing of drawings) {
          const { notes, marks, part, voice, stave } = drawing;
          // Simultaneous closed and open hats are two real hits. Keep their heads
          // separate instead of accepting the library's shared unison head.
          if (part.role === 'open hat')
            for (const note of notes) if (!note.isRest()) note.setXShift(14);
          const beams = Beam.generateBeams(notes, {
            groups: [new Fraction(1, 4)],
            maintain_stem_directions: true,
          });
          voice.draw(context, stave);
          beams.forEach((beam) => {
            beam.setContext(context).draw();
          });
          notes.forEach((note, i) => {
            const mark = marks[i];
            if (!mark.rest || mark.ticks !== 64)
              geometry.points.push({ time: bar + mark.tick / 64, x: note.getAbsoluteX() });
            if (mark.rest || note instanceof GhostNote) return;
            const identity = JSON.stringify([
              part.id,
              mark.notes.map((n) => [n.start, n.end, readPitch(n)]),
            ]);
            const previous = ties.get(identity);
            if (mark.tieIn && previous && previous.system !== system)
              drawTie(context, previous.note);
            if (mark.tieIn)
              drawTie(context, previous?.system === system ? previous.note : undefined, note);
            if (mark.tieOut) ties.set(identity, { note, system });
            else ties.delete(identity);
          });
        }
      }
      for (const group of groups) {
        if (!group.unasked && !group.count) {
          context.setFillStyle(theme.text).setStrokeStyle(theme.text);
          const rest = new StaveNote({
            keys: [rows[group.r].clef === 'bass' ? 'd/3' : 'b/4'],
            duration: '1r',
            align_center: true,
            clef: rows[group.r].clef,
          });
          const voice = new Voice({ num_beats: 4, beat_value: 4 }).addTickables([rest]);
          new Formatter().joinVoices([voice]).format([voice], Math.max(20, end - start - 12));
          voice.draw(context, staves[group.r]);
          continue;
        }
        const y = top + offset + tops[group.r] + (rows[group.r].clef === 'percussion' ? 76 : 56);
        ctx.fillStyle = theme.ground;
        const groupX = x + (column ? 0 : prefix);
        ctx.fillRect(groupX + 2, y - 14, Math.max(1, barWidth - 4), 28);
        context.avoid.push({ x: groupX, y: y - 16, width: barWidth, height: 32 });
        labels.push({
          value: group.unasked
            ? barWidth > 100
              ? 'not asked yet'
              : '?'
            : `${group.approx ? '≈' : ''}×${String(group.count)}${barWidth > 110 ? ' notes' : ''}`,
          x: groupX + 4,
          y: y + 4,
          width: barWidth - 8,
        });
      }
      labels.push({
        value: String(bar + 1),
        x: column ? x + 8 : start,
        y: top + offset - 2,
        width: barWidth - 15,
      });
      context.setFillStyle(theme.text).setStrokeStyle(theme.text);
      if (column === 0 && rows.length >= 2 && rows[0].clef === 'bass' && rows[1].clef === 'bass')
        new StaveConnector(staves[0], staves[1]).setType('brace').setContext(context).draw();
    }
    // Continuations leaving the score get a real open-ended tie.
    for (const previous of ties.values()) drawTie(context, previous.note);
    for (let system = 0; system < systems; system++)
      rows.forEach((row, r) => {
        const y = top + system * systemHeight + tops[r];
        const name =
          row.clef === 'percussion'
            ? `Percussion · ${String(row.parts.length)} voices · timing roles`
            : `${row.parts[0].name}${row.octave ? ' · 8vb' : ''}`;
        ctx.font = `11px "${theme.fontMono}"`;
        const nameWidth =
          row.clef === 'percussion'
            ? width - 48
            : Math.min(width * 0.45, ctx.measureText(name).width + 12);
        labels.push({ value: name, x: 24, y: y + 12, width: nameWidth });
        const detail = row.parts
          .map(
            (p) =>
              `${p.clef === 'percussion' ? `${p.role === 'percussion' ? p.name : (p.role ?? 'percussion')} ` : ''}${p.dynamics}${p.cutoff ? ` · ${p.cutoff}` : ''}`,
          )
          .join(' · ');
        const detailX = row.clef === 'percussion' ? 24 : 24 + nameWidth + 8;
        labels.push({
          value: detail,
          x: detailX,
          y: y + (row.clef === 'percussion' ? 138 : 12),
          width: width - detailX - 24,
          italic: true,
        });
      });
    // Text has reserved lanes and always uses the high-contrast text token.
    ctx.fillStyle = theme.text;
    ctx.font = `22px "${theme.fontDisplay}"`;
    ctx.fillText('Staff', 24, 32);
    ctx.font = `11px "${theme.fontMono}"`;
    text(
      ctx,
      `${score.key.label} (inferred) · 4/4 (cycle = bar) · bars ${String(range.from + 1)}–${String(range.from + count)}`,
      24,
      47,
      width - 48,
    );
    for (const label of labels) {
      ctx.font = label.italic ? 'italic 12px serif' : `11px "${theme.fontMono}"`;
      text(ctx, label.value, label.x, label.y, label.width);
    }
    ctx.font = `11px "${theme.fontMono}"`;
    const omitted = all.filter((r) => !rows.includes(r)).flatMap((r) => r.parts);
    const omittedNotes = omitted.reduce(
      (sum, p) =>
        sum +
        Array.from({ length: count }, (_, b) => measure(p.notes, range.from + b, 0).count).reduce(
          (a, b) => a + b,
          0,
        ),
      0,
    );
    total += omittedNotes;
    grouped += omittedNotes;
    const resting = frame.instruments.filter(
      (i) => !score.parts.some((p) => p.source === i.id && inRange(p)),
    );
    const entries = [
      ...omitted.map(
        (p) =>
          `${p.name}: ×${String(p.notes.filter((n) => n.start < range.from + count && n.end > range.from).length)} notes`,
      ),
      ...resting.map((p) => `${p.name}: ${range.asked.every(Boolean) ? 'rest' : 'not asked'}`),
    ];
    const footer = Math.max(bottom + 12, height - 67);
    text(
      ctx,
      `${String(total)} notes · ${String(roundings)} ≈ · ${String(grouped)} counted${range.asked.every(Boolean) ? '' : ' · ? not asked yet'}${omitted.length ? ` · +${String(omitted.length)} voices below` : ''}`,
      24,
      footer,
      width - 48,
    );
    wrap(ctx, entries.length ? entries : ['All parts entered'], 24, footer + 20, width - 48, 2);
    if (!rows.length)
      text(
        ctx,
        range.asked.every(Boolean) ? 'No scored notes in this window' : 'Window not asked yet',
        24,
        top + 70,
        width - 48,
      );
    return { bars, avoid: context.avoid };
  }

  function playhead(ctx: CanvasRenderingContext2D, frame: ViewFrame, engraving: Engraving) {
    const b = engraving.bars.at(0);
    if (!b) return;
    const time = frame.now;
    const points = [
      ...b.points,
      { time: Math.floor(time), x: b.start },
      { time: Math.floor(time) + 1, x: b.end },
    ].sort((a, b) => a.time - b.time || a.x - b.x);
    const before = points.filter((p) => p.time <= time).at(-1) ?? points[0];
    const after = points.find((p) => p.time > time) ?? before;
    const t = after.time === before.time ? 0 : (time - before.time) / (after.time - before.time);
    const x = before.x + (after.x - before.x) * t;
    ctx.strokeStyle = frame.theme.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const band of b.bands) {
      let segments = [band];
      for (const rect of engraving.avoid) {
        if (x < rect.x || x > rect.x + rect.width) continue;
        segments = segments.flatMap((s) =>
          rect.y >= s.bottom || rect.y + rect.height <= s.top
            ? [s]
            : [
                { top: s.top, bottom: Math.max(s.top, rect.y) },
                { top: Math.min(s.bottom, rect.y + rect.height), bottom: s.bottom },
              ],
        );
      }
      for (const segment of segments) {
        ctx.moveTo(x, segment.top);
        ctx.lineTo(x, segment.bottom);
      }
    }
    ctx.stroke();
    ctx.fillStyle = frame.theme.text;
    ctx.font = `11px "${frame.theme.fontMono}"`;
    ctx.textAlign = 'right';
    ctx.fillText(`${String(Math.round((time - Math.floor(time)) * 100))}%`, frame.width - 24, 32);
  }

  return { engrave, playhead, license };
}
