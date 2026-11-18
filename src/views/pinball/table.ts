import type { ViewFrame, ViewNote, ViewInstrument } from '../types';
import type { Point, TargetKind } from './model';
import { clamp } from '../shared/math';
import { noteProgress } from '../shared/timing';

function cubic(a: Point, b: Point, c: Point, d: Point, steps = 32): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps,
      u = 1 - t;
    return {
      x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x,
      y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y,
    };
  });
}
const distances = new WeakMap<Point[], { lengths: number[]; total: number }>();
export function routeAt(points: Point[], progress: number) {
  const unit = clamp(progress);
  if (unit === 0 || unit === 1) {
    const endpoint = points[unit === 0 ? 0 : points.length - 1];
    const position = { x: endpoint.x, y: endpoint.y };
    return { position, ahead: unit === 0 ? [position, ...points.slice(1)] : [position] };
  }
  let data = distances.get(points);
  if (!data) {
    const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
    data = { lengths, total: lengths.reduce((a, b) => a + b, 0) };
    distances.set(points, data);
  }
  let distance = data.total * unit;
  for (let i = 0; i < data.lengths.length; i++) {
    if (distance <= data.lengths[i] && data.lengths[i] > 0) {
      const t = distance / data.lengths[i];
      const position = {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
      return { position, ahead: [position, ...points.slice(i + 1)] };
    }
    distance -= data.lengths[i];
  }
  const position = points[points.length - 1];
  return { position, ahead: [position] };
}
export function pointOnRoute(points: Point[], progress: number): Point {
  return routeAt(points, progress).position;
}

/** Immutable mechanical assignment: computed once for a whole-score identity. */
export function assignFeatures(
  instruments: readonly ViewInstrument[],
  kinds: ReadonlyMap<string, TargetKind>,
) {
  const ordered = instruments.slice().sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
  const totals = new Map<TargetKind, number>(),
    ranks = new Map<TargetKind, number>();
  for (const i of ordered) {
    const kind = kinds.get(i.id) ?? 'bumper';
    totals.set(kind, (totals.get(kind) ?? 0) + 1);
  }
  return ordered.map((instrument, slot) => {
    const kind = kinds.get(instrument.id) ?? 'bumper',
      rank = ranks.get(kind) ?? 0;
    ranks.set(kind, rank + 1);
    return { instrument, slot, kind, rank, total: totals.get(kind) ?? 1 };
  });
}
export type FeatureAssignments = ReturnType<typeof assignFeatures>;

/** Mechanical addresses are chosen from the whole score, never the current occupants. */
export function pinballLayout(
  frame: Pick<ViewFrame, 'width' | 'height' | 'instruments'>,
  kinds: ReadonlyMap<string, TargetKind> = new Map(),
  assignments: FeatureAssignments = assignFeatures(frame.instruments, kinds),
) {
  const { width, height } = frame;
  const top = 82,
    bottom = Math.max(top + 100, height - 65);
  const fieldHeight = bottom - top,
    fieldWidth = Math.min(width * 0.78, fieldHeight * 1.55);
  const left = (width - fieldWidth) / 2,
    right = left + fieldWidth;
  const point = (x: number, y: number): Point => ({
    x: left + x * fieldWidth,
    y: top + y * fieldHeight,
  });
  const current = new Map(frame.instruments.map((i) => [i.id, i]));
  const count = (kind: TargetKind) => assignments.filter((a) => a.kind === kind).length;
  const capRadius =
    Math.min(8, Math.max(5.5, fieldWidth * 0.014)) *
    Math.min(1, Math.sqrt(4 / Math.max(1, count('bumper'))));
  const ballRadius = capRadius * 1.5,
    bumperRadius = capRadius * 2.25;
  const targets = assignments.map(({ instrument: original, slot, kind, rank, total }) => {
    const instrument = current.get(original.id) ?? original;
    let position: Point,
      track: Point[] = [];
    if (kind === 'rollover') position = point(0.3 + (0.4 * (rank + 0.5)) / total, 0.16);
    else if (kind === 'bumper') {
      const triangle = [
        [0.38, 0.36],
        [0.62, 0.36],
        [0.5, 0.52],
        [0.5, 0.24],
      ];
      if (total <= 4) position = point(triangle[rank][0], triangle[rank][1]);
      else {
        const vertices = [
            [0.34, 0.3],
            [0.66, 0.3],
            [0.5, 0.56],
          ],
          edge = (rank * 3) / total;
        const a = vertices[Math.floor(edge)],
          b = vertices[(Math.floor(edge) + 1) % 3],
          t = edge % 1;
        position = point(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      }
    } else if (kind === 'ramp') {
      const side = rank % 2,
        lane = Math.floor(rank / 2),
        lanes = Math.ceil(total / 2);
      const inset = lanes > 1 ? (lane / (lanes - 1)) * 0.09 : 0;
      const p = (x: number, y: number) => point(side ? 1 - x : x, y);
      track = [
        ...cubic(p(0.15, 0.81), p(0.05 + inset, 0.6), p(0.32 + inset, 0.57), p(0.22 + inset, 0.39)),
        ...cubic(
          p(0.22 + inset, 0.39),
          p(0.14 + inset, 0.23),
          p(0.3 + inset, 0.22),
          p(0.3 + inset, 0.1),
        ).slice(1),
      ];
      position = pointOnRoute(track, 0.45);
    } else {
      const angle = ((rank + 1) / (total + 1)) * Math.PI;
      position = point(0.5 + 0.19 * Math.cos(angle), 0.59 + 0.12 * Math.sin(angle));
    }
    return {
      instrument,
      slot,
      kind,
      rank,
      x: position.x,
      y: position.y,
      radius: bumperRadius,
      track,
      tag: {
        x: 0,
        y: 0,
        width: Math.max(20, Math.min(116, left - 13)),
        align: 'left' as 'left' | 'right',
      },
    };
  });
  // Tags sit outside the playfield. Their rows are reserved for the complete inventory.
  for (const side of [0, 1]) {
    const members = targets
      .filter((t) => Number(t.x >= width / 2) === side)
      .sort((a, b) => a.y - b.y || a.slot - b.slot);
    let y = top + 30;
    members.forEach((t, i) => {
      const remaining = members.length - i - 1;
      y = Math.max(y, Math.min(t.y + 4, bottom - 24 - remaining * 17));
      t.tag = {
        x: side ? right + 10 : left - 10,
        y,
        width: t.tag.width,
        align: side ? 'left' : 'right',
      };
      y += 17;
    });
  }
  return {
    left,
    right,
    top,
    bottom,
    fieldWidth,
    fieldHeight,
    ballRadius,
    capRadius,
    bumperRadius,
    point,
    targets,
    paths: new Map<string, Point[]>(),
  };
}
export type PinballLayout = ReturnType<typeof pinballLayout>;
export type Target = PinballLayout['targets'][number];

export function captivePoint(target: Target, note: ViewNote, now: number): Point {
  const phase = noteProgress(note, now) * Math.PI * 2;
  if (target.track.length) return pointOnRoute(target.track, 0.45 + Math.sin(phase) * 0.3);
  return {
    x: target.x + Math.sin(phase) * target.radius * 0.65,
    y: target.y - (1 - Math.cos(phase)) * target.radius * 0.4,
  };
}
function segmentDistance(a: Point, b: Point, p: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
/** Rounded visibility paths keep the entire ball clear of other pop bumpers. */
export function routeBetween(a: Target, b: Target, layout: PinballLayout): Point[] {
  const key = `${String(a.slot)}:${String(b.slot)}`;
  const cached = layout.paths.get(key);
  if (cached) return cached;
  const pad = Math.min(8, layout.bumperRadius * 0.25);
  const radius = layout.bumperRadius + layout.ballRadius + pad;
  const obstacles = layout.targets.filter((t) => t.kind === 'bumper' && t !== a && t !== b);
  const inside = (p: Point) => {
    const y = (p.y - layout.top) / layout.fieldHeight,
      x = (p.x - layout.left) / layout.fieldWidth;
    return y >= 0.05 && y <= 0.91 && x >= 0.19 * (1 - y) + 0.035 && x <= 0.81 + 0.19 * y - 0.1;
  };
  const clear = (points: Point[], margin = radius) =>
    points.every(
      (p, i) =>
        inside(p) && (!i || obstacles.every((o) => segmentDistance(points[i - 1], p, o) >= margin)),
    );
  let result: Point[] | undefined;
  if (a === b) {
    const r = layout.ballRadius * 3.5;
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      const turn = (x: number, y: number) => ({
        x: a.x + Math.cos(angle) * x - Math.sin(angle) * y,
        y: a.y + Math.sin(angle) * x + Math.cos(angle) * y,
      });
      const loop = cubic(a, turn(r, r), turn(-r, r), b, 48);
      if (clear(loop)) {
        result = loop;
        break;
      }
    }
  } else {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy);
    for (const bow of [0.08, -0.08, 0.16, -0.16, 0.02, -0.02]) {
      const bend = layout.fieldHeight * bow;
      const curve = cubic(
        a,
        { x: a.x + dx / 3 - (dy / length) * bend, y: a.y + dy / 3 + (dx / length) * bend },
        {
          x: a.x + (dx * 2) / 3 - (dy / length) * bend,
          y: a.y + (dy * 2) / 3 + (dx / length) * bend,
        },
        b,
        48,
      );
      if (clear(curve)) {
        result = curve;
        break;
      }
    }
  }
  if (!result) {
    const nodes: Point[] = [a, b];
    for (const o of obstacles)
      for (const dx of [-1, 1])
        for (const dy of [-1, 1]) {
          const p = { x: o.x + dx * radius * 1.02, y: o.y + dy * radius * 1.02 };
          if (
            inside(p) &&
            obstacles.every((other) => Math.hypot(p.x - other.x, p.y - other.y) >= radius)
          )
            nodes.push(p);
        }
    const costs = nodes.map(() => Infinity),
      previous = nodes.map(() => -1),
      visited = new Set<number>();
    costs[0] = 0;
    while (visited.size < nodes.length) {
      let current = -1;
      for (let i = 0; i < nodes.length; i++)
        if (!visited.has(i) && (current < 0 || costs[i] < costs[current])) current = i;
      if (current < 0 || !Number.isFinite(costs[current]) || current === 1) break;
      visited.add(current);
      for (let i = 0; i < nodes.length; i++) {
        if (visited.has(i) || !clear([nodes[current], nodes[i]])) continue;
        const cost =
          costs[current] + Math.hypot(nodes[i].x - nodes[current].x, nodes[i].y - nodes[current].y);
        if (cost < costs[i]) {
          costs[i] = cost;
          previous[i] = current;
        }
      }
    }
    const corners: Point[] = [b];
    for (let i = previous[1]; i >= 0; i = previous[i]) corners.unshift(nodes[i]);
    if (corners.length < 2) corners.unshift(a);
    result = [a];
    for (let i = 1; i < corners.length - 1; i++) {
      const p = corners[i],
        before = corners[i - 1],
        after = corners[i + 1];
      const r = Math.min(
        pad * 1.5,
        Math.hypot(p.x - before.x, p.y - before.y) / 4,
        Math.hypot(after.x - p.x, after.y - p.y) / 4,
      );
      const enter = {
        x: p.x + ((before.x - p.x) * r) / Math.hypot(before.x - p.x, before.y - p.y),
        y: p.y + ((before.y - p.y) * r) / Math.hypot(before.x - p.x, before.y - p.y),
      };
      const leave = {
        x: p.x + ((after.x - p.x) * r) / Math.hypot(after.x - p.x, after.y - p.y),
        y: p.y + ((after.y - p.y) * r) / Math.hypot(after.x - p.x, after.y - p.y),
      };
      result.push(enter, ...cubic(enter, p, p, leave, 10).slice(1));
    }
    result.push(b);
    if (result.length === 2 && a !== b) {
      const dx = b.x - a.x,
        dy = b.y - a.y,
        length = Math.hypot(dx, dy);
      const bend = pad * 0.3;
      result = cubic(
        a,
        { x: a.x + dx / 3 - (dy / length) * bend, y: a.y + dy / 3 + (dx / length) * bend },
        {
          x: a.x + (dx * 2) / 3 - (dy / length) * bend,
          y: a.y + (dy * 2) / 3 + (dx / length) * bend,
        },
        b,
        48,
      );
    }
  }
  layout.paths.set(key, result);
  return result;
}
