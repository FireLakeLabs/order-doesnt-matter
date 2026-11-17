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
export interface ChipBox {
  rack: Rack;
  tube?: Tube;
  text: string;
  x: number;
  y: number;
  width: number;
}
export interface TubeLayout {
  tubes: TubeBox[];
  labels: LabelBox[];
  chips: ChipBox[];
  folded: boolean;
  compact: boolean;
  rows: number;
  stageWidth: number;
  trayLeft: number;
  trayTop: number;
  trayWidth: number;
}
/** All settings remain represented. Sampled constants may fold; a signal
 * with flat sampled values remains a tube, making that distinction visible. */
export function tubeLayout(frame: Pick<ViewFrame, 'width' | 'height'>, racks: Rack[]): TubeLayout {
  const { width: w, height: h } = frame;
  const margin = 20;
  const gap = w < 700 ? 8 : 14;
  const count = racks.reduce((n, r) => n + r.tubes.length, 0);
  const folded = count * 60 + Math.max(0, racks.length - 1) * gap > w - margin * 2;
  const entries: { rack: Rack; tube: Tube }[] = [];
  const tokens: Omit<ChipBox, 'x' | 'y' | 'width'>[] = [];
  for (const rack of racks) {
    const constants = rack.tubes.filter(
      (t) => folded && t.setting.kind !== 'signal' && !!t.range && !t.moving,
    );
    entries.push(
      ...rack.tubes.filter((t) => !constants.includes(t)).map((tube) => ({ rack, tube })),
    );
    if (!constants.length) continue;
    tokens.push({ rack, text: rack.instrument.name });
    tokens.push(
      ...constants.map((tube) => ({ rack, tube, text: `${tube.setting.name} ${tube.text}` })),
    );
  }
  const aside = folded && tokens.length > 0 && w >= 1000;
  const trayWidth = aside ? clamp(w * 0.27, 260, 360) : w;
  const stageWidth = aside ? w - trayWidth - 12 : w;
  const available = Math.max(1, stageWidth - margin * 2);
  const trayLeft = aside ? w - trayWidth : 0;
  const chipLeft = trayLeft + (aside ? 12 : margin);
  const chipRight = trayLeft + trayWidth - (aside ? 12 : margin);
  const packChips = (compact: boolean) => {
    const chips: ChipBox[] = [];
    let x = chipLeft,
      row = 0;
    for (const token of tokens) {
      const text = compact && token.tube ? token.tube.setting.name : token.text;
      const characters =
        token.tube && !compact
          ? token.tube.setting.name.length + 1 + token.tube.valueWidth
          : text.length;
      const width = Math.min(chipRight - chipLeft, Math.max(34, characters * 6 + 14));
      if (x > chipLeft && x + width > chipRight) {
        x = chipLeft;
        row++;
      }
      chips.push({ ...token, text, x, y: row * 21, width });
      x += width + (token.tube ? 5 : 3);
    }
    return { chips, height: tokens.length ? (row + 1) * 21 + 26 : 0 };
  };
  let packed = packChips(false);
  const compact = packed.height > (aside ? h - 100 : h * 0.31);
  if (compact) packed = packChips(true);
  const trayTop = aside ? 88 : h - packed.height - 12;
  const chips = packed.chips.map((c) => ({ ...c, y: trayTop + 24 + c.y }));
  // Crowded groups continue on the next row without omitting a moving control.
  const minimum = w < 700 ? 44 : 60;
  const rows: (typeof entries)[] = [];
  let row: typeof entries = [],
    used = 0;
  for (const entry of entries) {
    const before = row.length && row.at(-1)?.rack !== entry.rack ? gap : 0;
    if (row.length && used + before + minimum > available) {
      rows.push(row);
      row = [];
      used = 0;
    }
    used += minimum + (row.length && row.at(-1)?.rack !== entry.rack ? gap : 0);
    row.push(entry);
  }
  if (row.length) rows.push(row);
  const labels: LabelBox[] = [],
    tubes: TubeBox[] = [];
  const usableHeight = Math.max(1, (aside ? h - 12 : trayTop) - 88);
  const rowHeight = usableHeight / Math.max(1, rows.length);
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
        width: clamp(cell * 0.57, 26, 60),
        top: y + header,
        bottom: y + Math.max(header + 10, rowHeight - footer),
        dense,
      });
      x += cell;
    }
  }
  return {
    tubes,
    labels,
    chips,
    folded,
    compact,
    rows: rows.length,
    stageWidth,
    trayLeft,
    trayTop,
    trayWidth,
  };
}
