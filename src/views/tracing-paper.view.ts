import type { ViewDefinition, ViewFrame, ViewHistorySnapshot } from './types';
import {
  indexSheet,
  markGeometry,
  compareScores,
  countBins,
  defaultPair,
  pencilOpacity,
} from './tracing-paper/model';
import type { TraceNote, TraceSheet } from './tracing-paper/model';

function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  while (text && ctx.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return `${text}…`;
}
function line(ctx: CanvasRenderingContext2D, x: number, y: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function draw(
  ctx: CanvasRenderingContext2D,
  f: ViewFrame,
  sheet: TraceSheet | undefined,
  status: string,
  age: number,
  label: string,
) {
  const { width: w, height: h, theme: t } = f;
  const diff = sheet?.diff;
  ctx.reset();
  ctx.scale(f.dpr, f.dpr);
  ctx.fillStyle = t.ground;
  ctx.fillRect(0, 0, w, h);
  const text = (s: string, x: number, y: number, width = w - x - 24) => {
    ctx.fillStyle = t.text;
    ctx.fillText(fit(ctx, s, width), x, y);
  };
  ctx.font = `22px "${t.fontDisplay}"`;
  text('Tracing paper', 24, 32);
  ctx.font = `11px "${t.fontMono}"`;
  text(label, 24, 55);
  const narrow = w < 700,
    left = narrow ? 100 : 150,
    right = w - 38,
    top = 124,
    bottom = Math.max(top + 80, h - 128),
    bar = Math.floor(f.now);
  const inkWidth = right - left - 18,
    x = (time: number) => left + 9 + (time - bar) * inkWidth;
  // An offset lower sheet, registration corners, and the curled translucent top sheet.
  ctx.fillStyle = t.panel;
  ctx.strokeStyle = t.muted;
  ctx.lineWidth = 1;
  ctx.fillRect(left - 13, top - 17, right - left + 19, bottom - top + 35);
  ctx.strokeRect(left - 13, top - 17, right - left + 19, bottom - top + 35);
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = t.text;
  ctx.beginPath();
  ctx.moveTo(left - 20, top - 26);
  ctx.lineTo(right - 54, top - 26);
  ctx.quadraticCurveTo(right - 5, top - 25, right + 9, top + 24);
  ctx.lineTo(right + 9, bottom + 9);
  ctx.lineTo(left - 20, bottom + 9);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = t.muted;
  ctx.beginPath();
  ctx.moveTo(left - 20, bottom + 9);
  ctx.lineTo(left - 20, top - 26);
  ctx.lineTo(right - 54, top - 26);
  ctx.quadraticCurveTo(right - 8, top - 20, right + 9, top + 24);
  ctx.lineTo(right + 9, bottom + 9);
  ctx.stroke();
  ctx.fillStyle = t.panel;
  ctx.beginPath();
  ctx.moveTo(right - 54, top - 26);
  ctx.quadraticCurveTo(right - 40, top + 12, right + 9, top + 24);
  ctx.quadraticCurveTo(right - 8, top - 20, right - 54, top - 26);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = t.muted;
  ctx.lineWidth = 1;
  for (const [a, b] of [
    [left - 26, top - 32],
    [right + 15, bottom + 15],
  ]) {
    line(ctx, a - 5, b, a + 5, b);
    line(ctx, a, b - 5, a, b + 5);
  }
  ctx.font = `11px "${t.fontMono}"`;
  text(`BAR ${String(bar + 1)} · ${String(Math.round((f.now - bar) * 100))}%`, left, top - 8);
  if (!diff || diff.errors.length) {
    ctx.font = `20px "${t.fontDisplay}"`;
    text(status, left + 10, top + 65, right - left - 40);
    ctx.font = `11px "${t.fontMono}"`;
    text(
      diff?.errors[0] ??
        (status === 'No edits yet'
          ? 'Your next edit leaves a pencil trace here.'
          : 'Two scores, fetched only for the selected peel.'),
      left + 10,
      top + 91,
      right - left - 40,
    );
    return;
  }
  const active = (n: TraceNote) => n.start < bar + 1 && n.end > bar;
  // A section keeps its own fixed part slots, including its rests. A held note
  // never changes lanes when another part stops inside the section.
  const section = f.sections.find((s) => bar >= s.from + f.from && bar < s.to + f.from);
  const laneFrom = section ? section.from + f.from : f.from,
    laneTo = section ? section.to + f.from : f.to;
  const ids = [
    ...new Set(
      [...diff.old, ...diff.fresh]
        .filter((n) => n.start < laneTo && n.end > laneFrom)
        .map((n) => n.instrument),
    ),
  ].sort(
    (a, b) =>
      (f.instruments.find((i) => i.id === a)?.index ?? 999) -
        (f.instruments.find((i) => i.id === b)?.index ?? 999) || a.localeCompare(b),
  );
  const contentTop = top + 28;
  const maxRows = Math.max(1, Math.floor((bottom - contentTop) / 30));
  const visible = ids.slice(0, maxRows),
    overflow = ids.slice(maxRows);
  const rowHeight = (bottom - contentTop) / Math.max(1, visible.length);
  const colours = new Map(f.instruments.map((i) => [i.id, i.colour]));
  ctx.strokeStyle = t.line;
  for (let beat = 0; beat <= 4; beat++) {
    line(ctx, x(bar + beat / 4), contentTop - 4, x(bar + beat / 4), bottom - 8);
    if (beat < 4) text(String(beat + 1), x(bar + beat / 4) - 3, top + 12, 24);
  }
  ctx.strokeStyle = t.accent;
  ctx.lineWidth = 1.5;
  line(ctx, x(f.now), contentTop - 4, x(f.now), bottom - 9);
  const summary = sheet.bars.get(bar);
  const counts = summary?.counts ?? { added: 0, removed: 0, moved: 0, settings: 0 };
  const marksBox = markGeometry(rowHeight);
  for (const [index, id] of visible.entries()) {
    const y = contentTop + (index + 0.5) * rowHeight;
    ctx.strokeStyle = t.line;
    line(ctx, left, y, right, y);
    const old = diff.old.filter((n) => n.instrument === id && active(n)),
      fresh = diff.fresh.filter((n) => n.instrument === id && active(n));
    const notes = (items: TraceNote[], pencil: boolean) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(left - 8, top, right - left + 12, bottom - top);
      ctx.clip();
      ctx.strokeStyle = pencil ? t.muted : (colours.get(id) ?? t.text);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.globalAlpha = pencil ? pencilOpacity(age) : 1;
      ctx.lineCap = 'round';
      for (const n of items) {
        const a = x(Math.max(bar, n.start)),
          b = x(Math.min(bar + 1, n.end));
        if (pencil) {
          ctx.lineWidth = 0.8;
          ctx.setLineDash([3, 1.7]);
          line(ctx, a + 3, y - 6, b + 3, y - 6);
          line(ctx, a + 2, y - 3.7, b + 2, y - 4.2);
        } else {
          ctx.lineWidth = 3;
          ctx.setLineDash(n.hasOnset ? [] : [2, 2]);
          line(ctx, a, y, b, y);
          if (n.hasOnset && n.start >= bar) {
            ctx.beginPath();
            ctx.arc(a, y, 2.8, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.restore();
    };
    notes(old, true);
    notes(fresh, false);
    interface Edit {
      kind: 'added' | 'removed' | 'moved';
      note: TraceNote;
      old?: TraceNote;
    }
    const edits: Edit[] = [
      ...diff.added
        .filter((n) => n.instrument === id && n.start >= bar && n.start < bar + 1)
        .map((note) => ({ kind: 'added' as const, note })),
      ...diff.removed
        .filter((n) => n.instrument === id && n.start >= bar && n.start < bar + 1)
        .map((note) => ({ kind: 'removed' as const, note })),
      ...diff.moved
        .filter(
          (p) =>
            p.old.instrument === id &&
            ((p.old.start >= bar && p.old.start < bar + 1) ||
              (p.fresh.start >= bar && p.fresh.start < bar + 1)),
        )
        .map((p) => ({ kind: 'moved' as const, note: p.fresh, old: p.old })),
    ];
    const cell = inkWidth / Math.max(1, Math.floor(inkWidth / 96));
    for (const bin of countBins(
      edits,
      (e) => Math.max(0, Math.min(inkWidth - 1e-6, x(e.note.start) - left)),
      cell,
    )) {
      const first = bin.items[0],
        a = x(Math.max(bar, Math.min(bar + 1, first.note.start)));
      ctx.strokeStyle = t.text;
      ctx.lineWidth = 1.5;
      if (bin.items.length === 1) {
        if (first.kind === 'added') {
          ctx.beginPath();
          ctx.ellipse(a, y, 8, marksBox.ringRadius, -0.2, 0, Math.PI * 2);
          ctx.stroke();
        } else if (first.kind === 'removed') {
          ctx.save();
          ctx.fillStyle = t.muted;
          ctx.globalAlpha = 0.18;
          for (let k = 0; k < 5; k++) {
            ctx.beginPath();
            ctx.ellipse(a + k - 2, y - 5 + (k % 3) * 2, 12 - k, 4, 0.2 * k, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
          ctx.strokeStyle = t.ground;
          line(ctx, a - 8, y - 5, a + 7, y + 2);
        } else if (first.old) {
          const b = x(Math.max(bar, Math.min(bar + 1, first.old.start)));
          ctx.beginPath();
          ctx.moveTo(b, y - 7);
          ctx.quadraticCurveTo((a + b) / 2, y - 30, a, y - 7);
          ctx.stroke();
          line(ctx, a, y - 7, a - Math.sign(a - b) * 5, y - 13);
          line(ctx, a, y - 7, a - Math.sign(a - b) * 7, y - 7);
        }
      } else {
        ctx.setLineDash([2, 2]);
        ctx.strokeRect(
          left + bin.slot * cell,
          y - 9,
          Math.min(cell - 8, right - left - bin.slot * cell),
          16,
        );
        ctx.setLineDash([]);
      }
      // Count all kinds together so dense additions/removals/moves cannot label over one another.
      const caption = (['added', 'removed', 'moved'] as const)
        .flatMap((kind, i) => {
          const n = bin.items.filter((e) => e.kind === kind).length;
          return n ? [`${['+', '−', '↔'][i]}${String(n)}`] : [];
        })
        .join(' ');
      if (first.kind !== 'moved' || bin.items.length > 1) {
        ctx.font = `11px "${t.fontMono}"`;
        const tw = ctx.measureText(caption).width,
          binLeft = left + bin.slot * cell,
          tx =
            bin.items.length === 1
              ? Math.max(binLeft, Math.min(a - 7, binLeft + cell - tw - 7))
              : binLeft;
        ctx.fillStyle = t.panel;
        ctx.fillRect(
          tx - 2,
          y + marksBox.captionTop,
          Math.min(cell - 3, tw + 4),
          marksBox.captionHeight,
        );
        text(caption, tx, y + marksBox.captionBaseline, cell - 7);
      }
    }
    // Text occupies its own margin and is painted after every note/mark.
    ctx.font = `12px "${t.fontDisplay}"`;
    const name = diff.names.get(id) ?? 'Stored part';
    if (name.includes(' → ')) {
      ctx.fillStyle = t.text;
      ctx.fillText(name, 20, y - 1, left - 48);
    } else text(name, 20, y - 1, left - 48);
    ctx.font = `11px "${t.fontMono}"`;
    text(`${String(old.length)} → ${String(fresh.length)}`, 20, y + 15, left - 48);
  }
  if (!ids.length) {
    ctx.font = `18px "${t.fontDisplay}"`;
    text('Both sheets rest in this bar', left + 12, top + 60, right - left - 35);
  }
  ctx.font = `11px "${t.fontMono}"`;
  text(
    `BAR +${String(counts.added)} / −${String(counts.removed)} / ↔${String(counts.moved)} / ${String(counts.settings)} settings${overflow.length ? ` · +${String(overflow.length)} parts (${String([...diff.old, ...diff.fresh].filter((n) => overflow.includes(n.instrument) && active(n)).length)} notes)` : ''}`,
    24,
    bottom + 30,
  );
  const margin = summary?.settings ?? [];
  ctx.font = `italic 13px "${t.fontDisplay}"`;
  if (diff.identical) text('Same score in the queried song range.', 24, bottom + 51);
  else if (diff.opaque)
    text('Some values are opaque; equality cannot be confirmed.', 24, bottom + 51);
  else if (margin.length) {
    const mark = margin[0];
    text(
      `${diff.names.get(mark.instrument) ?? 'Stored part'} ${mark.name}: ${mark.summary ?? `${mark.before} → ${mark.after}`}${margin.length > 1 ? ` · +${String(margin.length - 1)} margin notes` : ''}`,
      24,
      bottom + 51,
    );
  } else text('Pencil: before · ring: added · smudge: removed · arrow: moved', 24, bottom + 51);
  ctx.font = `11px "${t.fontMono}"`;
  const total = (kind: 'added' | 'removed' | 'moved' | 'settings') => diff[kind].length;
  text(
    `BARS ${String(f.from + 1)}–${String(f.to)} +${String(total('added'))} / −${String(total('removed'))} / ↔${String(total('moved'))} / ${String(total('settings'))} settings · ${String(diff.resized.length)} spans`,
    24,
    h - 58,
  );
  const from = Math.floor(f.from),
    bars = Math.max(1, Math.ceil(f.to) - from),
    cell = (w - 48) / bars;
  for (let i = 0; i < bars; i++) {
    const c = sheet.bars.get(from + i)?.counts ?? { added: 0, removed: 0, moved: 0, settings: 0 },
      sum = c.added + c.removed + c.moved + c.settings;
    ctx.fillStyle = from + i === bar ? t.accent : t.line;
    ctx.fillRect(24 + i * cell, h - 43, Math.max(1, cell - 2), 5);
    if (sum) {
      ctx.fillStyle = t.text;
      ctx.fillRect(
        24 + i * cell,
        h - 34,
        Math.max(1, cell - 2),
        Math.min(14, 4 + Math.log2(sum + 1) * 2),
      );
    }
    if (cell >= 27 || i % Math.ceil(27 / cell) === 0)
      text(String(from + i + 1), 24 + i * cell, h - 6, cell * Math.ceil(27 / cell) - 2);
  }
}
const view: ViewDefinition = {
  id: 'tracing-paper',
  name: 'Tracing paper',
  tag: 'your edits',
  group: 'song',
  span: 'song',
  history: true,
  mount(element) {
    const canvas = document.createElement('canvas'),
      ctx = canvas.getContext('2d');
    if (!ctx) throw Error('Canvas 2D is unavailable');
    const context = ctx;
    const controls = document.createElement('div'),
      oldSelect = document.createElement('select'),
      newSelect = document.createElement('select'),
      retry = document.createElement('button');
    controls.style.cssText =
      'position:absolute;top:66px;left:24px;right:24px;display:flex;gap:8px;align-items:center;font-size:11px';
    const label = document.createElement('span');
    label.textContent = 'Peel';
    controls.title = 'Double-click the paper to reset the peel';
    oldSelect.setAttribute('aria-label', 'Peel pencil version');
    newSelect.setAttribute('aria-label', 'Peel ink version');
    retry.textContent = 'Retry';
    retry.hidden = true;
    controls.append(label, oldSelect, newSelect, retry);
    element.append(canvas, controls);
    let latest: ViewFrame | undefined,
      selected: [string, string] | undefined,
      key = '',
      versionKey = '',
      requestedPair = '',
      requestedRange: [number, number] | undefined,
      generation = 0,
      disposed = false;
    let sheet: TraceSheet | undefined,
      preview: TraceSheet | undefined,
      retained: { pair: string; sheet: TraceSheet } | undefined,
      answers: ViewHistorySnapshot[] | undefined,
      status = 'No edits yet';
    function repaint() {
      if (latest && !disposed) render(latest);
    }
    function select() {
      selected = [oldSelect.value, newSelect.value];
      key = '';
      repaint();
    }
    function reset() {
      selected = undefined;
      key = '';
      repaint();
    }
    function again() {
      key = '';
      repaint();
    }
    oldSelect.addEventListener('change', select);
    newSelect.addEventListener('change', select);
    retry.addEventListener('click', again);
    element.addEventListener('dblclick', reset);
    function render(f: ViewFrame) {
      latest = f;
      if (f.width <= 0 || f.height <= 0) return;
      const versions = f.history?.versions ?? [];
      if (selected && !selected.every((id) => versions.some((v) => v.id === id)))
        selected = undefined;
      const pair = selected ?? defaultPair(versions);
      const nextVersions = JSON.stringify(versions);
      if (versionKey !== nextVersions) {
        versionKey = nextVersions;
        for (const s of [oldSelect, newSelect]) {
          s.replaceChildren();
          for (const v of versions) {
            const o = document.createElement('option');
            o.value = v.id;
            o.textContent = `v${String(v.ordinal)} · ${v.position}`;
            s.append(o);
          }
        }
      }
      controls.style.color = f.theme.text;
      controls.style.fontFamily = f.theme.fontMono;
      for (const s of [oldSelect, newSelect, retry])
        s.style.cssText = `font:inherit;color:${f.theme.text};background:${f.theme.panel};border:1px solid ${f.theme.muted};padding:3px 5px;min-width:0;max-width:40%`;
      oldSelect.disabled = newSelect.disabled = versions.length < 2;
      if (pair) {
        oldSelect.value = pair[0];
        newSelect.value = pair[1];
      }
      const requestKey = JSON.stringify([pair, f.from, f.to]);
      if (requestKey !== key) {
        key = requestKey;
        const token = ++generation;
        const pairKey = JSON.stringify(pair ?? null);
        preview =
          retained !== undefined &&
          pairKey === requestedPair &&
          retained.pair === pairKey &&
          requestedRange &&
          (requestedRange[0] !== f.from || requestedRange[1] !== f.to)
            ? retained.sheet
            : undefined;
        if (requestedPair !== pairKey) retained = undefined;
        requestedPair = pairKey;
        requestedRange = [f.from, f.to];
        sheet = undefined;
        answers = undefined;
        status = pair
          ? 'Lifting the sheets…'
          : versions.length > 1
            ? 'No earlier version'
            : 'No edits yet';
        const history = f.history;
        if (pair && history)
          void Promise.all(pair.map((id) => history.score(id)))
            .then((value) => {
              if (disposed || token !== generation) return;
              answers = value;
              preview = undefined;
              if (value[0].status === 'available' && value[1].status === 'available') {
                sheet = indexSheet(compareScores(value[0].score, value[1].score), f.from, f.to);
                status = sheet.diff.errors.length ? 'Could not compare scores' : '';
                if (!sheet.diff.errors.length) retained = { pair: JSON.stringify(pair), sheet };
              } else
                status =
                  value.find((v) => v.status === 'unavailable')?.reason ?? 'History unavailable';
              repaint();
            })
            .catch((error: unknown) => {
              if (!disposed && token === generation) {
                status = error instanceof Error ? error.message : String(error);
                answers = [];
                preview = undefined;
                repaint();
              }
            });
      }
      retry.hidden = !answers || (!!sheet && !sheet.diff.errors.length);
      canvas.width = Math.max(1, Math.round(f.width * f.dpr));
      canvas.height = Math.max(1, Math.round(f.height * f.dpr));
      canvas.style.width = `${String(f.width)}px`;
      canvas.style.height = `${String(f.height)}px`;
      const present = versions.findIndex((v) => v.position === 'present'),
        old = versions.findIndex((v) => v.id === pair?.[0]);
      const age = present - old;
      const description = pair
        ? `v${String(versions.find((v) => v.id === pair[0])?.ordinal)} pencil → v${String(versions.find((v) => v.id === pair[1])?.ordinal)} ink`
        : 'Pencil before · fresh ink after';
      canvas.dataset.state = !pair
        ? 'empty'
        : !answers
          ? preview
            ? 'pending-preview'
            : 'pending'
          : sheet?.diff.errors.length || !sheet
            ? 'error'
            : sheet.diff.identical
              ? 'identical'
              : 'ready';
      const shown = sheet ?? preview;
      canvas.dataset.sheetFrom = shown ? String(shown.from) : '';
      // A pending range keeps the previous, explicitly labelled sheet at its own
      // coordinates. Arbitrary Strudel programs need not repeat: never shift
      // those old notes into the new, still unqueried score range.
      draw(
        context,
        preview
          ? { ...f, from: preview.from, to: preview.to, now: preview.from + f.now - f.from }
          : f,
        shown,
        status,
        Math.abs(age),
        preview
          ? `Loading bars ${String(f.from + 1)}–${String(f.to)} · previous bars ${String(preview.from + 1)}–${String(preview.to)}`
          : pair
            ? `${description} · pencil ${String(Math.abs(age))} edit${Math.abs(age) === 1 ? '' : 's'} ${age >= 0 ? 'back' : 'ahead'}`
            : description,
      );
    }
    return {
      frame: render,
      dispose() {
        disposed = true;
        generation++;
        oldSelect.removeEventListener('change', select);
        newSelect.removeEventListener('change', select);
        retry.removeEventListener('click', again);
        element.removeEventListener('dblclick', reset);
        canvas.remove();
        controls.remove();
        canvas.width = canvas.height = 0;
        latest = undefined;
        preview = undefined;
        retained = undefined;
        requestedRange = undefined;
        sheet = undefined;
        answers = undefined;
      },
    };
  },
};
export default view;
