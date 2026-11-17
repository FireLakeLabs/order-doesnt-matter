import type { ViewDefinition, ViewFrame } from './types';
import { bypass, departure, indexMetro, metroLayout } from './metro/model';
import type { MetroScore } from './metro/model';
import { clamp } from './shared/math';

function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  let end = text.length;
  while (end > 0 && ctx.measureText(`${text.slice(0, end)}…`).width > width) end--;
  return `${text.slice(0, end)}…`;
}
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function drawMap(ctx: CanvasRenderingContext2D, score: MetroScore, frame: ViewFrame) {
  const { width, height, theme, instruments } = frame;
  const box = metroLayout(score, width, height, instruments.length);
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'left';
  ctx.font = `20px "${theme.fontDisplay}"`;
  ctx.fillStyle = theme.text;
  ctx.fillText('Metro', 24, 32);
  ctx.font = `10px "${theme.fontMono}"`;
  ctx.textAlign = 'right';
  ctx.fillStyle = theme.muted;
  ctx.fillText(
    `${String(instruments.length)} LINES · ${score.arranged ? 'WHOLE SONG' : `${String(score.to - score.from)} CYCLES SHOWN`}`,
    width - 24,
    30,
  );
  ctx.textAlign = 'left';
  // Every line keeps a named legend entry, including when rests share a bypass.
  const columns = box.legendColumns;
  const cell = (width - 48) / columns;
  instruments.forEach((instrument, row) => {
    const x = 24 + (row % columns) * cell,
      y = 58 + Math.floor(row / columns) * 18;
    ctx.fillStyle = instrument.colour;
    ctx.beginPath();
    ctx.arc(x + 3, y - 3, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.muted;
    ctx.fillText(fit(ctx, instrument.name, cell - 22), x + 13, y);
  });
  if (box.shared) {
    ctx.setLineDash([3, 6]);
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = 2;
    const rests =
      score.routes.size < instruments.length ? [{ from: score.from, to: score.to }] : score.rests;
    for (const rest of rests) {
      ctx.beginPath();
      ctx.moveTo(box.x(rest.from), box.bypassY);
      ctx.lineTo(box.x(rest.to), box.bypassY);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  instruments.forEach((instrument, row) => {
    const y = box.ys[row];
    const runs = score.routes.get(instrument.id) ?? [
      { from: score.from, to: score.to, active: false },
    ];
    runs.forEach((run, index) => {
      const active = run.active;
      const x0 = box.x(run.from),
        x1 = box.x(run.to);
      ctx.strokeStyle = active ? instrument.colour : box.shared ? theme.muted : instrument.colour;
      ctx.lineWidth = active ? Math.max(1.5, Math.min(8, box.pitch * 0.42)) : 1.5;
      ctx.setLineDash(active ? [] : [3, 5]);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (active) {
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
      } else {
        const leaves = index > 0 && (runs.at(index - 1)?.active ?? false);
        const joins = runs.at(index + 1)?.active ?? false;
        const points = bypass(x0, x1, box.rest(row), y, leaves, joins);
        // Shared horizontal bypass was drawn once; only the two diagonal connections remain.
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[1].x, points[1].y);
        if (box.shared) ctx.moveTo(points[2].x, points[2].y);
        else ctx.lineTo(points[2].x, points[2].y);
        ctx.lineTo(points[3].x, points[3].y);
      }
      ctx.stroke();
    });
  });
  ctx.setLineDash([]);
  const stations = [...score.stations, { name: score.terminal, from: score.to }];
  stations.forEach((station, index) => {
    const x = box.x(station.from);
    const previous = index > 0 ? stations.at(index - 1) : undefined;
    const next = stations.at(index + 1);
    const labelWidth =
      Math.min(
        previous ? x - box.x(previous.from) : Infinity,
        next ? box.x(next.from) - x : Infinity,
      ) * 0.92;
    ctx.textAlign = index === 0 ? 'left' : index === stations.length - 1 ? 'right' : 'center';
    ctx.font = `${String(width < 700 ? 12 : 16)}px "${theme.fontDisplay}"`;
    ctx.fillStyle = theme.text;
    ctx.fillText(fit(ctx, station.name, labelWidth), x, box.top - 23);
    ctx.fillStyle = theme.text;
    ctx.strokeStyle = theme.ground;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(x - 6, box.top - 7, 12, box.bottom - box.top + 14, 6);
    ctx.fill();
    ctx.stroke();
    ctx.font = `10px "${theme.fontMono}"`;
    ctx.fillStyle = theme.muted;
    ctx.fillText(`bar ${String(station.from + 1)}`, x, box.bottom + 32);
  });
  ctx.textAlign = 'left';
  if (box.shared) {
    ctx.font = `10px "${theme.fontMono}"`;
    ctx.fillStyle = theme.muted;
    ctx.fillText('RESTING LINES SHARE THE DASHED BYPASS', box.left, height * 0.67);
  }
}

function drawLive(ctx: CanvasRenderingContext2D, score: MetroScore, frame: ViewFrame) {
  const { width, height, theme } = frame;
  const box = metroLayout(score, width, height, frame.instruments.length);
  const x = box.x(clamp(frame.now, score.from, score.to));
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  if (theme.glow) {
    ctx.shadowColor = theme.accent;
    ctx.shadowBlur = 14;
  }
  ctx.beginPath();
  ctx.roundRect(x - 9, box.top - 14, 18, box.bottom - box.top + 28, Math.min(6, theme.radius));
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = theme.accent;
  ctx.fillRect(x - 3, box.top - 8, 6, 3);
  ctx.font = `11px "${theme.fontMono}"`;
  ctx.textAlign = 'center';
  ctx.fillText(`now · ${(frame.now + 1).toFixed(1)}`, x, box.bottom + 51);
  ctx.textAlign = 'left';

  const board = departure(score, frame.now, frame.instruments);
  const top = height * 0.71,
    left = 24,
    boardWidth = width - 48,
    boardHeight = height - top - 22;
  ctx.fillStyle = theme.panel;
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(left, top, boardWidth, boardHeight, theme.radius);
  ctx.fill();
  ctx.stroke();
  const compact = width < 700;
  const size = compact ? 10 : 12;
  ctx.font = `${String(size)}px "${theme.fontMono}"`;
  const rows = [
    ['NEXT STOP', `${board.name.toUpperCase()}  ·  IN ${board.bars.toFixed(1)} BARS`],
    ['LEAVING', board.leaving.join('  /  ').toUpperCase() || '—'],
    ['JOINING', board.joining.join('  /  ').toUpperCase() || '—'],
  ];
  const labelWidth = compact ? 86 : 108;
  const available = boardWidth - labelWidth - 32;
  const wrapped = rows.map(([label, value]) => ({ label, lines: wrap(ctx, value, available) }));
  const lineCount = wrapped.reduce((sum, row) => sum + Math.max(2, row.lines.length) + 0.3, 0);
  const lineHeight = Math.min(size + 6, (boardHeight - 22) / lineCount);
  let y = top + 19;
  for (const row of wrapped) {
    ctx.fillStyle = theme.muted;
    ctx.fillText(row.label, left + 14, y);
    ctx.fillStyle = row.label === 'NEXT STOP' ? theme.text : theme.accent;
    for (const line of row.lines) {
      ctx.fillText(fit(ctx, line, available), left + labelWidth, y);
      y += lineHeight;
    }
    y += Math.max(0, 2 - row.lines.length) * lineHeight + lineHeight * 0.3;
  }
}

const view: ViewDefinition = {
  id: 'metro',
  name: 'Metro',
  group: 'song',
  tag: 'whole song',
  span: 'song',
  mount(element) {
    const canvas = document.createElement('canvas'),
      backing = document.createElement('canvas');
    const ctx = canvas.getContext('2d'),
      base = backing.getContext('2d');
    if (!ctx || !base) throw Error('Canvas 2D is unavailable');
    element.append(canvas);
    let score: MetroScore | undefined, notes: ViewFrame['notes'] | undefined;
    let scoreKey = '',
      paintKey = '';
    return {
      frame(frame) {
        if (frame.width <= 0 || frame.height <= 0) return;
        const nextScore = JSON.stringify([frame.from, frame.to, frame.sections]);
        const changed = !score || notes !== frame.notes || scoreKey !== nextScore;
        if (changed) {
          score = indexMetro(frame);
          notes = frame.notes;
          scoreKey = nextScore;
        }
        if (!score) return;
        const nextPaint = JSON.stringify([
          frame.width,
          frame.height,
          frame.dpr,
          frame.theme,
          document.fonts.check(`12px "${frame.theme.fontMono}"`),
          document.fonts.check(`16px "${frame.theme.fontDisplay}"`),
          frame.instruments.map(({ id, name, colour }) => [id, name, colour]),
        ]);
        if (changed || nextPaint !== paintKey) {
          canvas.width = backing.width = Math.max(1, Math.round(frame.width * frame.dpr));
          canvas.height = backing.height = Math.max(1, Math.round(frame.height * frame.dpr));
          canvas.style.width = `${String(frame.width)}px`;
          canvas.style.height = `${String(frame.height)}px`;
          base.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
          drawMap(base, score, frame);
          paintKey = nextPaint;
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(backing, 0, 0);
        ctx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
        drawLive(ctx, score, frame);
      },
      dispose() {
        canvas.remove();
        canvas.width = backing.width = 0;
        canvas.height = backing.height = 0;
        score = undefined;
        notes = undefined;
      },
    };
  },
};
export default view;
