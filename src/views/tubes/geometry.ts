import type { ViewFrame } from '../types';
import { clamp } from '../shared/math';
import type { Rack, Tube } from './model';

export interface TubeBox {
  rack: Rack;
  tube: Tube;
  x: number;
  width: number;
  top: number;
  bottom: number;
  dense: boolean;
}
export interface LabelBox {
  rack: Rack;
  x: number;
  y: number;
  width: number;
  dense: boolean;
}
/** Every setting has its own vessel, including constants and unavailable values. */
export function tubeLayout(frame: Pick<ViewFrame, 'width' | 'height'>, racks: Rack[]) {
  const { width: w, height: h } = frame;
  const margin = 20;
  const gap = w < 700 ? 8 : 14;
  const available = Math.max(1, w - margin * 2);
  const minimum = w < 700 ? 44 : 52;
  const entries = racks.flatMap((rack) => rack.tubes.map((tube) => ({ rack, tube })));
  const groups = racks.filter((rack) => rack.tubes.length).length;
  const rowCount = Math.max(
    1,
    Math.min(
      entries.length,
      Math.ceil((entries.length * minimum + Math.max(0, groups - 1) * gap) / available),
    ),
  );
  // Balance rows rather than leaving one setting stranded on its own bench.
  const rows: (typeof entries)[] = [];
  let offset = 0;
  for (let r = 0; r < rowCount; r++) {
    const count = Math.ceil((entries.length - offset) / (rowCount - r));
    if (count) rows.push(entries.slice(offset, offset + count));
    offset += count;
  }
  const labels: LabelBox[] = [],
    tubes: TubeBox[] = [];
  const rowHeight = Math.max(1, h - 100) / Math.max(1, rows.length);
  const dense = rows.length > 2;
  const header = dense ? 18 : 45,
    footer = dense ? 33 : 47;
  for (const [r, entries] of rows.entries()) {
    const gaps = entries.filter((e, i) => i > 0 && e.rack !== entries[i - 1].rack).length;
    const cell = (available - gaps * gap) / entries.length;
    let x = margin;
    const y = 88 + r * rowHeight;
    for (const [i, entry] of entries.entries()) {
      if (i > 0 && entry.rack !== entries[i - 1].rack) x += gap;
      if (i === 0 || entry.rack !== entries[i - 1].rack) {
        let length = 1;
        while (i + length < entries.length && entries[i + length].rack === entry.rack) length++;
        labels.push({ rack: entry.rack, x, y, width: cell * length, dense });
      }
      tubes.push({
        ...entry,
        x: x + cell / 2,
        width: clamp(cell * 0.72, 26, 90),
        top: y + header,
        bottom: y + Math.max(header + 10, rowHeight - footer),
        dense,
      });
      x += cell;
    }
  }
  return { tubes, labels, rows: rows.length, stageWidth: w };
}
