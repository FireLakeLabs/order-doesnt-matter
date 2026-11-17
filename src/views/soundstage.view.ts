import type { ViewDefinition, ViewFrame } from './types';
import { line, mount2d, flash } from './shared/retro-2d';
import { indexStage, stageMarks, roomRugs, type StageIndex } from './soundstage/model';
import { stageLayout, truePlace } from './soundstage/geometry';

const number = (n: number) => String(Number(n.toFixed(2))).replace(/^0\./, '.');
function drawStage(c: CanvasRenderingContext2D, f: ViewFrame, index: StageIndex) {
  const { width: w, height: h, theme } = f;
  const marks = stageMarks(f, index);
  c.font = `11px "${theme.fontMono}"`;
  const { box, spots } = stageLayout(f, marks, (s) => c.measureText(s).width);
  c.fillStyle = theme.text;
  c.font = `bold 26px "${theme.fontDisplay}"`;
  c.fillText('Soundstage', 20, 36);
  c.font = `11px "${theme.fontMono}"`;
  c.fillStyle = theme.muted;
  c.fillText('scored settings only · not measured sound', 21, 58, w - 42);
  c.textAlign = 'right';
  c.font = `10px "${theme.fontMono}"`;
  c.fillText(
    `bar ${String(Math.floor(f.now) + 1)} · ${String(Math.floor((f.now % 1) * 100))}%`,
    w - 20,
    33,
  );
  c.textAlign = 'left';
  c.fillStyle = theme.panel;
  c.strokeStyle = theme.line;
  c.lineWidth = 2;
  c.beginPath();
  c.roundRect(box.left, box.top, box.right - box.left, box.bottom - box.top, theme.radius);
  c.fill();
  c.stroke();
  c.font = `10px "${theme.fontMono}"`;
  for (const room of [0, 0.25, 0.5, 0.75, 1]) {
    const p = truePlace(box, 0.5, room);
    c.setLineDash([3, 6]);
    c.strokeStyle = theme.line;
    line(c, box.left + 8, p.y, box.right - 8, p.y);
    c.setLineDash([]);
    c.fillStyle = theme.muted;
    c.textAlign = 'right';
    c.fillText(room === 0 ? 'dry' : room === 1 ? 'wet' : number(room), box.left - 9, p.y + 4);
  }
  const centre = truePlace(box, 0.5, 0).x;
  c.setLineDash([8, 6]);
  line(c, centre, box.top + 5, centre, box.bottom - 5);
  c.setLineDash([]);
  c.fillStyle = theme.muted;
  c.textAlign = 'left';
  c.fillText('← left', box.left, box.top - 12);
  c.textAlign = 'center';
  c.fillText('centre · pan 0.5', centre, box.top - 12);
  c.textAlign = 'right';
  c.fillText('right →', box.right, box.top - 12);
  c.textAlign = 'left';

  // Rugs enclose both the true positions and their fanned markers.
  for (const [i, rug] of roomRugs(f, marks).entries()) {
    const members = spots.filter((s) => rug.marks.includes(s.mark));
    const places = members.flatMap((s) => [
      { x: s.x, y: s.y },
      ...s.mark.positions
        .filter((p) => p.orbit === rug.orbit)
        .map((p) => truePlace(box, p.pan, p.room)),
    ]);
    const left = Math.max(box.left + 4, Math.min(...places.map((p) => p.x)) - 44);
    const right = Math.min(box.right - 4, Math.max(...places.map((p) => p.x)) + 44);
    const top = Math.max(box.top + 4, Math.min(...places.map((p) => p.y)) - 47);
    const bottom = Math.min(box.bottom - 4, Math.max(...places.map((p) => p.y)) + 44);
    const colour = rug.requests[0]?.instrument.colour ?? members[0].mark.instruments[0].colour;
    c.save();
    c.globalAlpha = theme.glow ? 0.12 : 0.09;
    c.fillStyle = colour;
    c.beginPath();
    c.roundRect(left, top, right - left, bottom - top, Math.min(32, theme.radius * 3));
    c.fill();
    c.globalAlpha = 0.6;
    c.strokeStyle = colour;
    c.lineWidth = 1;
    c.setLineDash([4, 4]);
    c.stroke();
    c.restore();
    // Requests identify who supplied the scored room size, not an audible winner.
    const title = `room ${String(rug.orbit)}`;
    const requests = rug.requests.length
      ? rug.requests.map((r) => `${r.instrument.name} ${number(r.size)}`).join(' · ')
      : 'size not specified';
    const rowY = 76 + i * 16;
    c.font = `10px "${theme.fontMono}"`;
    c.fillStyle = theme.text;
    c.fillText(`${title} · size requested by ${requests}`, box.left, rowY, box.right - box.left);
  }
  // Hairlines and tiny crosses always expose the unshifted scored placement.
  for (const spot of spots) {
    const unique = new Map(
      spot.mark.positions.map((p) => [`${String(p.pan)}:${String(p.room)}`, p]),
    );
    c.save();
    c.globalAlpha = 0.55;
    c.strokeStyle = theme.muted;
    c.lineWidth = 1;
    for (const p of unique.values()) {
      const truePoint = truePlace(box, p.pan, p.room);
      if (Math.hypot(spot.x - truePoint.x, spot.y - truePoint.y) > 1 || unique.size > 1) {
        line(c, truePoint.x, truePoint.y, spot.x, spot.y);
        line(c, truePoint.x - 3, truePoint.y, truePoint.x + 3, truePoint.y);
        line(c, truePoint.x, truePoint.y - 3, truePoint.x, truePoint.y + 3);
      }
    }
    c.restore();
  }
  for (const spot of spots) {
    const { mark, x, y, radius } = spot;
    const instrument = mark.instruments[0];
    const pulse = instrument.muted ? 0 : Math.max(0, ...mark.samples.map((n) => flash(n, f)));
    if (pulse > 0) {
      c.save();
      c.globalAlpha = pulse * 0.8;
      c.strokeStyle = instrument.colour;
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(x, y, radius + (1 - pulse) * 24 + 4, 0, Math.PI * 2);
      c.stroke();
      c.restore();
    }
    c.save();
    c.fillStyle = instrument.colour;
    c.strokeStyle = instrument.colour;
    c.lineWidth = 2;
    c.shadowColor = instrument.colour;
    c.shadowBlur = mark.held && theme.glow ? 18 : 0;
    c.globalAlpha = mark.held ? 0.88 : 0.2;
    c.beginPath();
    c.arc(x, y, radius, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;
    c.globalAlpha = mark.held ? 1 : 0.7;
    c.stroke();
    c.restore();
    c.textAlign = 'center';
    c.fillStyle = theme.text;
    c.font = `11px "${theme.fontMono}"`;
    const suffix = mark.count > 1 ? ` ×${String(mark.count)}` : '';
    const beside = mark.room > 0 && !spot.compact;
    const side = x + radius + 10 + spot.labelWidth < box.right ? 1 : -1;
    const labelX = beside ? x + side * (radius + 10 + spot.labelWidth / 2) : x;
    const labelY = beside ? y + 2 : y + radius + 15;
    c.fillText(`${instrument.name}${suffix}`, labelX, labelY, spot.labelWidth);
    if (!spot.compact) {
      c.fillStyle = theme.muted;
      c.font = `9px "${theme.fontMono}"`;
      const range =
        new Set(mark.positions.map((p) => `${String(p.pan)}:${String(p.room)}`)).size > 1;
      c.fillText(
        range
          ? `${String(mark.positions.length)} placements · gain ≤${number(mark.gain)}`
          : `p ${number(mark.pan)} · r ${number(mark.room)} · g ${number(mark.gain)}${mark.unknown ? ' ?' : ''}`,
        labelX,
        labelY + 14,
        spot.labelWidth,
      );
    }
    c.textAlign = 'left';
  }
  // Audience faces the stage from its dry edge.
  c.fillStyle = theme.line;
  const seats = Math.max(5, Math.floor((box.right - box.left) / 37));
  for (let i = 0; i < seats; i++) {
    c.beginPath();
    c.arc(
      box.left + ((i + 0.5) / seats) * (box.right - box.left),
      box.bottom + 24,
      3.5,
      0,
      Math.PI * 2,
    );
    c.fill();
  }
  const panUsers = marks.filter((m) => m.positions.some((p) => p.pan !== 0.5));
  c.font = `10px "${theme.fontMono}"`;
  c.fillStyle = theme.muted;
  c.textAlign = 'center';
  c.fillText('you are here', centre, box.bottom + 44);
  c.textAlign = 'left';
  c.fillText(
    panUsers.length ? 'pan sampled per note' : 'all at centre · pan 0.5',
    20,
    h - 14,
    w * 0.48,
  );
  c.textAlign = 'right';
  c.fillText('hairlines → true place · gain 0–2', w - 20, h - 14, w * 0.48);
  c.textAlign = 'left';
  if (marks.some((m) => m.unknown)) {
    c.fillStyle = theme.text;
    c.fillText(
      '? unsampled setting uses defaults',
      box.left + 6,
      box.bottom - 7,
      box.right - box.left - 12,
    );
  }
  if (!marks.length) {
    c.fillStyle = theme.muted;
    c.textAlign = 'center';
    c.fillText('No instruments in this section', centre, (box.top + box.bottom) / 2);
    c.textAlign = 'left';
  }
}
const view: ViewDefinition = {
  id: 'soundstage',
  name: 'Soundstage',
  group: 'settings',
  tag: 'where it sits',
  span: 'window',
  mount: (element) => mount2d(element, indexStage, drawStage),
};
export default view;
