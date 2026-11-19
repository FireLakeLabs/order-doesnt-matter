import type { ViewDefinition, ViewFrame } from './types';
import { clamp } from './shared/math';
import { noteName } from './shared/pitch';
import { line } from './shared/retro-2d';
import {
  clusterTags,
  clusterGrowth,
  plantNumbers,
  gardenLayout,
  gardenMoment,
  gardenRange,
  indexGarden,
  leafClusters,
  leafRadius,
  seasons,
  seed,
  type Cluster,
  type ClusterTags,
  type Garden,
  type Layout,
  type Plant,
} from './garden/model';

function fit(c: CanvasRenderingContext2D, text: string, width: number) {
  if (c.measureText(text).width <= width) return text;
  while (text && c.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return text ? `${text}…` : '';
}
function plate(c: CanvasRenderingContext2D, f: ViewFrame, text: string, x: number, y: number) {
  c.fillStyle = f.theme.panel;
  c.fillRect(x - 3, y - 12, c.measureText(text).width + 6, 16);
  c.fillStyle = f.theme.text;
  c.fillText(text, x, y);
}
function ink(f: ViewFrame, id: string) {
  return f.instruments.find((p) => p.id === id)?.colour ?? f.theme.accent;
}
/** Orbit identity picks a stable theme tint; sampled room membership is live data. */
function roomInk(f: ViewFrame, cluster: Cluster) {
  const n = (cluster.leaves.find((l) => l.send === cluster.send) ?? cluster.leaves[0]).note;
  const raw = Number(n.value.orbit ?? f.instruments.find((p) => p.id === n.instrument)?.room ?? 1);
  const orbit = Number.isFinite(raw) ? Math.trunc(raw) : 1;
  return [f.theme.accent, f.theme.muted, f.theme.text, f.theme.line][((orbit % 4) + 4) % 4];
}
function leaf(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  shape: number,
  curl: number,
) {
  const direction = curl < 0.5 ? -1 : 1;
  c.beginPath();
  c.moveTo(x, y + r * 0.4);
  if (shape % 3 === 0) {
    c.bezierCurveTo(
      x - r * 1.7,
      y + r * 0.1,
      x - r * 1.4,
      y - r * 1.6,
      x + direction * r * 0.5,
      y - r * 1.7,
    );
    c.bezierCurveTo(x + r * 1.5, y - r * 0.7, x + r * 0.9, y, x, y + r * 0.4);
  } else if (shape % 3 === 1) {
    for (let i = 0; i <= 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      c.quadraticCurveTo(
        x + Math.sin(a - 0.4) * r * 1.8,
        y - r * 0.5 + Math.cos(a - 0.4) * r * 1.8,
        x + Math.sin(a) * r * 0.7,
        y - r * 0.5 + Math.cos(a) * r * 0.7,
      );
    }
  } else {
    c.bezierCurveTo(x - r * 1.2, y - r * 0.8, x - r * 0.5, y - r * 1.6, x, y - r * 1.8);
    c.bezierCurveTo(x + r * 0.7, y - r * 1.2, x + r * 1.2, y - r * 0.3, x, y + r * 0.4);
  }
  c.closePath();
}
function foliage(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  g: Garden,
  b: Layout,
  clusters: Cluster[],
  grown: boolean,
) {
  c.reset();
  c.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
  c.lineCap = 'round';
  for (const p of g.plants) {
    c.strokeStyle = ink(f, p.id);
    c.globalAlpha = grown ? 0.8 : 0.18;
    c.lineWidth = grown ? 2 : 1;
    if (!p.leaves.length) continue;
    const first = Math.max(g.from, p.leaves[0].note.start);
    const last = Math.min(g.to, (p.leaves.at(-1) ?? p.leaves[0]).note.start + 0.65);
    if (!grown) drawRoot(c, f, b, p, first, false);
    c.save();
    if (grown) {
      c.beginPath();
      c.rect(b.x(first), 0, f.width - b.x(first), f.height);
      c.clip();
    }
    c.globalAlpha = grown ? 0.8 : 0.18;
    c.strokeStyle = ink(f, p.id);
    c.lineWidth = grown ? 2 : 1;
    c.beginPath();
    c.moveTo(b.x(first), b.vineY(p, first));
    for (let time = first; time < last; time += 0.125) {
      const next = Math.min(time + 0.125, last);
      c.lineTo(b.x(next), b.vineY(p, next));
    }
    c.stroke();
    for (let bar = g.from; bar < g.to; bar++) {
      if (!p.leaves.some((l) => Math.floor(l.note.start) === bar)) continue;
      c.beginPath();
      c.moveTo(b.x(bar), b.sprigY(p, bar));
      const width = b.x(bar + 1) - b.x(bar);
      c.bezierCurveTo(
        b.x(bar) + width * 0.25,
        b.sprigY(p, bar) + 5,
        b.x(bar) + width * 0.75,
        b.sprigY(p, bar) - 5,
        b.x(bar + 1),
        b.sprigY(p, bar),
      );
      c.stroke();
    }
    // Curling tendrils repeat every bar, like a plant trained across a trellis.
    for (let time = g.from; time < g.to; time++) {
      if (!p.leaves.some((l) => Math.floor(l.note.start) === time)) continue;
      const x = b.x(time + 0.65),
        y = b.sprigY(p, time + 0.65),
        r = Math.min(7, b.plantBand(p) * 0.23);
      c.beginPath();
      c.moveTo(x, y);
      c.bezierCurveTo(x + r * 2, y + r * 2, x - r, y + r * 2, x + r * 0.2, y + r * 0.6);
      c.stroke();
    }
    c.restore();
  }
  for (const cluster of clusters) drawCluster(c, f, b, cluster, grown);
  c.globalAlpha = 1;
}
function drawRoot(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  b: Layout,
  p: Plant,
  first: number,
  grown: boolean,
) {
  const root = b.rootX(p, first);
  c.globalAlpha = grown ? 0.8 : 0.18;
  c.strokeStyle = ink(f, p.id);
  c.lineWidth = grown ? 2 : 1;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(root, b.bottom + 12);
  c.bezierCurveTo(
    root,
    b.bottom - 30,
    b.x(first) - 45,
    b.vineY(p, first) + 18,
    b.x(first),
    b.vineY(p, first),
  );
  c.stroke();
  c.globalAlpha = 1;
}
function drawCluster(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  b: Layout,
  cluster: Cluster,
  grown: boolean,
) {
  const { plant: p, leaves } = cluster;
  const x = b.x(cluster.start),
    y = b.y(p, cluster.pitch, cluster.start);
  const r = leafRadius(cluster.gain, b);
  const muted = f.instruments.find((p) => p.id === cluster.plant.id)?.muted;
  c.globalAlpha = (grown ? 0.9 : 0.23) * (muted ? 0.35 : 1);
  c.strokeStyle = ink(f, p.id);
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(x, b.sprigY(p, cluster.start));
  c.quadraticCurveTo(x - r * (1 + leaves[0].curl), y + r, x, y);
  c.stroke();
  c.beginPath();
  c.moveTo(x - r * 0.15, y + r * 0.8);
  c.bezierCurveTo(x - r * 2.3, y + r * 0.9, x - r * 1.8, y - r * 0.5, x - r * 0.15, y + r * 0.8);
  c.moveTo(x, y + r * 1.1);
  c.bezierCurveTo(x + r * 2.4, y + r * 0.8, x + r * 1.9, y - r * 0.4, x, y + r * 1.1);
  c.fillStyle = ink(f, p.id);
  if (grown) c.fill();
  c.stroke();
  // Mixed settings remain a layered bloom, rather than silently choosing one member's shape.
  cluster.shapes.forEach((shape, i) => {
    const offset =
      cluster.shapes.length > 1 ? (i / Math.max(1, cluster.shapes.length - 1) - 0.5) * r : 0;
    leaf(c, x + offset, y, r, shape, leaves[0].curl);
    c.fillStyle = ink(f, p.id);
    if (grown) c.fill();
    c.strokeStyle = ink(f, p.id);
    c.lineWidth = 0.8;
    c.stroke();
    if (cluster.send > 0) {
      c.strokeStyle = roomInk(f, cluster);
      c.lineWidth = 1 + cluster.send * 2;
      c.stroke();
      c.strokeStyle = ['riso', 'pocket'].includes(f.theme.name) ? f.theme.ground : f.theme.text;
      c.lineWidth = 0.5 + cluster.send;
      c.stroke();
    }
    if (grown) {
      c.strokeStyle = f.theme.ground;
      c.globalAlpha *= 0.45;
      line(c, x + offset, y + r * 0.1, x + offset, y - r);
      c.globalAlpha /= 0.45;
    }
  });
  if (grown && cluster.pitch !== undefined) {
    // A stamen pins the exact pitch height even where neighbouring petals overlap.
    c.globalAlpha = 1;
    c.fillStyle = f.theme.text;
    c.beginPath();
    c.arc(x, y, 1.3, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
}
function landscape(c: CanvasRenderingContext2D, f: ViewFrame, g: Garden, b: Layout) {
  const { theme: t, width: w, height: h } = f;
  c.reset();
  c.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
  c.fillStyle = t.ground;
  c.fillRect(0, 0, w, h);
  for (const s of g.sections) {
    const x = b.x(s.from),
      width = b.x(s.to) - x;
    const tint = [t.accent, t.text, t.accent, t.muted][s.season];
    const sky = c.createLinearGradient(x, 64, x, b.bottom);
    sky.addColorStop(0, tint);
    sky.addColorStop(1, t.ground);
    c.fillStyle = sky;
    c.globalAlpha = [0.1, 0.14, 0.07, 0.18][s.season];
    c.fillRect(x, 64, width, b.bottom - 64);
    c.globalAlpha = 0.35;
    c.strokeStyle = tint;
    c.lineWidth = 1.4;
    const cx = x + width / 2,
      cy = 102;
    if (s.season === 1) {
      c.beginPath();
      c.arc(cx, cy, 8, 0, Math.PI * 2);
      c.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        line(
          c,
          cx + Math.cos(a) * 12,
          cy + Math.sin(a) * 12,
          cx + Math.cos(a) * 16,
          cy + Math.sin(a) * 16,
        );
      }
    } else if (s.season === 3) {
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        line(
          c,
          cx - Math.cos(a) * 11,
          cy - Math.sin(a) * 11,
          cx + Math.cos(a) * 11,
          cy + Math.sin(a) * 11,
        );
      }
    } else {
      leaf(c, cx, cy + 8, 8, s.season === 0 ? 1 : 0, 0.2);
      c.stroke();
    }
  }
  c.globalAlpha = 1;
  c.fillStyle = t.panel;
  c.beginPath();
  c.moveTo(0, b.bottom + 14);
  c.bezierCurveTo(w * 0.3, b.bottom - 3, w * 0.6, b.bottom + 29, w, b.bottom + 8);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.closePath();
  c.fill();
  c.strokeStyle = t.muted;
  c.globalAlpha = 0.28;
  c.stroke();
  for (let i = 0; i < w / 8; i++) {
    const x = seed(String(i)) % Math.max(1, Math.floor(w)),
      y = b.bottom + 20 + (seed(`soil${String(i)}`) % 9);
    line(c, x, y, x + 2, y - 1);
  }
  // Light local pitch guides: pitch never inherits vine sway or sibling positions.
  for (const p of g.plants) {
    if (!Number.isFinite(p.low)) continue;
    c.strokeStyle = t.muted;
    c.globalAlpha = 0.13;
    for (const v of new Set([p.low, p.high])) line(c, b.left, b.y(p, v), b.right, b.y(p, v));
  }
  for (const [a, z] of [
    [g.from, g.knownFrom],
    [g.knownTo, g.to],
  ]) {
    if (z <= a) continue;
    c.save();
    c.beginPath();
    c.rect(b.x(a), b.top, b.x(z) - b.x(a), b.bottom - b.top);
    c.clip();
    c.strokeStyle = t.muted;
    c.globalAlpha = 0.18;
    for (let x = b.x(a) - (b.bottom - b.top); x < b.x(z); x += 12)
      line(c, x, b.bottom, x + b.bottom - b.top, b.top);
    c.restore();
  }
  c.globalAlpha = 1;
}
function labels(
  c: CanvasRenderingContext2D,
  f: ViewFrame,
  g: Garden,
  b: Layout,
  clusters: Cluster[],
  tags: ClusterTags,
  live = false,
) {
  const { theme: t, width: w, height: h } = f;
  c.font = `11px "${t.fontMono}"`;
  c.textAlign = 'left';
  for (const { cluster: group, x, y, width } of tags.placed) {
    const grown = group.leaves.filter((l) => l.note.start <= f.now).length;
    const text = live
      ? `${String(grown)}/${String(group.leaves.length)}`
      : `×${String(group.leaves.length)}`;
    if (!live || (group.start <= f.now && group.end > f.now)) {
      c.fillStyle = t.panel;
      c.fillRect(x - 3, y - 12, width, 16);
      plate(c, f, text, x, y);
    }
  }
  if (live) {
    c.fillStyle = t.ground;
    c.fillRect(0, 0, w, 62);
    c.fillStyle = t.text;
    c.font = `23px "${t.fontDisplay}"`;
    c.fillText('Garden', 18, 28);
    c.font = `11px "${t.fontMono}"`;
    const moment = gardenMoment(g, clusters, f.now);
    c.textAlign = 'right';
    c.fillText(`${moment.season} · bar ${String(Math.floor(f.now - g.from) + 1)}`, w - 18, 27);
    c.textAlign = 'left';
    c.fillText(
      fit(
        c,
        `${String(moment.plants)} plants · ${String(moment.grown)}/${String(moment.total)} leaves grown · ${String(moment.waiting)} seeds`,
        w - 36,
      ),
      18,
      50,
    );
    return;
  }
  const scale: { text: string; y: number }[] = [];
  for (const p of plantNumbers(g, b)) plate(c, f, String(p.index + 1), 12, b.base(p) + 4);
  for (const p of g.plants) {
    if (!Number.isFinite(p.low) || b.plantBand(p) < 30) continue;
    for (const value of new Set([p.low, p.high]))
      scale.push({ text: noteName(value), y: b.y(p, value) + 4 });
  }
  let scaleBottom = -Infinity;
  for (const label of scale.sort((a, b) => a.y - b.y)) {
    if (label.y - scaleBottom < 18) continue;
    plate(c, f, label.text, 32, label.y);
    scaleBottom = label.y;
  }
  const moment = gardenMoment(g, clusters, f.now);
  let edge = -Infinity,
    omitted = 0;
  for (const s of g.sections) {
    const x = b.x(s.from) + 4,
      width = b.x(s.to) - x - 4;
    const text = fit(c, `${s.name} / ${seasons[s.season]}`, width);
    if (!text || x < edge) {
      omitted++;
      continue;
    }
    plate(c, f, text, x, 80);
    edge = x + c.measureText(text).width + 12;
  }
  c.fillStyle = t.panel;
  c.fillRect(0, h - 38 - b.legendRows * 19, w, 38 + b.legendRows * 19);
  const cell = (w - 32) / b.columns;
  g.plants.forEach((p, i) => {
    const x = 16 + (i % b.columns) * cell,
      y = h - 49 - (b.legendRows - 1 - Math.floor(i / b.columns)) * 19;
    c.fillStyle = ink(f, p.id);
    c.fillRect(x, y - 8, 5, 9);
    c.fillStyle = t.text;
    const name = f.instruments.find((v) => v.id === p.id)?.name ?? p.id;
    c.fillText(
      fit(c, `${String(i + 1)} · ${String(p.leaves.length)} ${name}`, cell - 16),
      x + 10,
      y,
    );
  });
  c.fillStyle = t.panel;
  c.fillRect(0, h - 35, w, 35);
  c.fillStyle = t.text;
  c.fillText(
    fit(c, `Pitch ↑ · gain: size · settings: petals · room: pale edge`, w - 32),
    16,
    h - 21,
  );
  const partial = g.knownFrom > g.from || g.knownTo < g.to;
  c.fillText(
    fit(
      c,
      `${partial ? 'PARTLY QUERIED · ' : ''}${String(moment.clusters)} clusters (${String(moment.clusteredLeaves)} leaves)${tags.hidden ? ` · ${String(tags.hidden)} tags combined here` : ''}${omitted ? ` · ${String(omitted)} season tags hidden` : ''}${g.fragments ? ` · ${String(g.fragments)} carried leaves` : ''}${g.continuations ? ` · ${String(g.continuations)} repeat records` : ''}`,
      w - 32,
    ),
    16,
    h - 6,
  );
}
const definition: ViewDefinition = {
  id: 'garden',
  name: 'Garden',
  group: 'song',
  tag: 'growing score',
  span: 'song',
  mount(element) {
    const canvas = document.createElement('canvas');
    const sky = document.createElement('canvas'),
      grown = document.createElement('canvas'),
      future = document.createElement('canvas'),
      tags = document.createElement('canvas'),
      atlas = document.createElement('canvas');
    const c = canvas.getContext('2d'),
      sc = sky.getContext('2d'),
      gc = grown.getContext('2d'),
      fc = future.getContext('2d'),
      tc = tags.getContext('2d'),
      ac = atlas.getContext('2d');
    if (!c || !sc || !gc || !fc || !tc || !ac) throw Error('Canvas 2D is unavailable');
    element.append(canvas);
    let notes: ViewFrame['notes'] | undefined,
      scoreKey = '',
      paintKey = '';
    let g: Garden | undefined,
      b: Layout | undefined,
      clusters: Cluster[] = [];
    let tagPlan: ClusterTags = { placed: [], hidden: 0 };
    let roots: { first: number; x: number; width: number; canvas: HTMLCanvasElement }[] = [];
    const sprites = new Map<
      Cluster,
      { at: number; x: number; y: number; sx: number; sy: number; width: number; height: number }[]
    >();
    return {
      frame(f) {
        if (f.width <= 0 || f.height <= 0) return;
        const nextScore = JSON.stringify([
          gardenRange(f),
          f.from,
          f.to,
          f.sections,
          f.instruments.map((p) => [p.id, p.index]),
        ]);
        const changed = notes !== f.notes || nextScore !== scoreKey;
        if (changed) {
          g = indexGarden(f);
          notes = f.notes;
          scoreKey = nextScore;
        }
        if (!g) return;
        const nextPaint = JSON.stringify([
          f.width,
          f.height,
          f.dpr,
          f.theme,
          f.instruments.map((p) => [p.id, p.name, p.colour, p.muted, p.room]),
          document.fonts.check(`11px "${f.theme.fontMono}"`),
          document.fonts.check(`23px "${f.theme.fontDisplay}"`),
        ]);
        if (changed || nextPaint !== paintKey) {
          b = gardenLayout(g, f.width, f.height);
          clusters = leafClusters(g, b);
          for (const layer of [canvas, sky, grown, future, tags]) {
            layer.width = Math.max(1, Math.round(f.width * f.dpr));
            layer.height = Math.max(1, Math.round(f.height * f.dpr));
          }
          canvas.style.width = `${String(f.width)}px`;
          canvas.style.height = `${String(f.height)}px`;
          landscape(sc, f, g, b);
          foliage(gc, f, g, b, [], true);
          foliage(fc, f, g, b, clusters, false);
          // Rasterize all mature buds once into a compact atlas. Exact onset
          // selection avoids revealing a future petal merely because it overhangs now.
          const layout = b;
          const maxBand = Math.max(1, ...g.plants.map((p) => layout.plantBand(p)));
          const radius = leafRadius(2, b);
          const tileWidth = Math.ceil(radius * 6 + 8),
            tileHeight = Math.ceil(maxBand * 0.9 + radius * 4 + 12);
          const stages = clusters.flatMap((cluster) =>
            clusterGrowth(cluster).map((stage) => ({ cluster, ...stage })),
          );
          const columns = Math.max(
            1,
            Math.ceil(Math.sqrt((stages.length * tileHeight) / tileWidth)),
          );
          atlas.width = Math.ceil(columns * tileWidth * f.dpr);
          atlas.height = Math.max(
            1,
            Math.ceil(Math.ceil(stages.length / columns) * tileHeight * f.dpr),
          );
          ac.reset();
          ac.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
          sprites.clear();
          stages.forEach(({ cluster, bloom, at }, i) => {
            const x = layout.x(cluster.start) - tileWidth / 2;
            const y = layout.y(cluster.plant, cluster.pitch, cluster.start) - radius * 2 - 4;
            const sx = (i % columns) * tileWidth,
              sy = Math.floor(i / columns) * tileHeight;
            ac.save();
            ac.beginPath();
            ac.rect(sx, sy, tileWidth, tileHeight);
            ac.clip();
            ac.translate(sx - x, sy - y);
            drawCluster(ac, f, layout, bloom, true);
            ac.restore();
            const group = sprites.get(cluster) ?? [];
            group.push({ at, x, y, sx, sy, width: tileWidth, height: tileHeight });
            sprites.set(cluster, group);
          });
          for (const root of roots) {
            root.canvas.width = 0;
            root.canvas.height = 0;
          }
          const rangeFrom = g.from;
          roots = g.plants
            .filter((p) => p.leaves.length)
            .map((plant) => {
              const first = Math.max(rangeFrom, plant.leaves[0].note.start),
                x = Math.min(layout.x(first) - 60, layout.rootX(plant, first) - 40),
                width = Math.max(layout.x(first) + 4, layout.rootX(plant, first) + 4) - x;
              const root = document.createElement('canvas');
              root.width = Math.ceil(width * f.dpr);
              root.height = Math.round(f.height * f.dpr);
              const rc = root.getContext('2d');
              if (!rc) throw Error('Canvas 2D is unavailable');
              rc.setTransform(f.dpr, 0, 0, f.dpr, -x * f.dpr, 0);
              drawRoot(rc, f, layout, plant, first, true);
              return { first, x, width, canvas: root };
            });
          tc.reset();
          tc.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
          tc.font = `11px "${f.theme.fontMono}"`;
          tagPlan = clusterTags(clusters, b, (text) => tc.measureText(text).width);
          labels(tc, f, g, b, clusters, tagPlan);
          paintKey = nextPaint;
        }
        if (!b) return;
        c.reset();
        c.drawImage(sky, 0, 0);
        c.drawImage(future, 0, 0);
        c.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
        const x = clamp(b.x(f.now), b.left - 60, b.right + 25);
        c.save();
        c.beginPath();
        c.rect(0, 62, x, f.height - 62);
        c.clip();
        c.drawImage(grown, 0, 0, f.width, f.height);
        c.restore();
        for (const root of roots)
          if (root.first <= f.now) c.drawImage(root.canvas, root.x, 0, root.width, f.height);
        for (const [cluster, stages] of sprites) {
          const sprite = stages.findLast((s) => s.at <= f.now);
          if (!sprite) continue;
          const grown = cluster.leaves.filter((l) => l.note.start <= f.now).length;
          c.globalAlpha = 0.4 + (0.6 * grown) / cluster.leaves.length;
          c.drawImage(
            atlas,
            sprite.sx * f.dpr,
            sprite.sy * f.dpr,
            sprite.width * f.dpr,
            sprite.height * f.dpr,
            sprite.x,
            sprite.y,
            sprite.width,
            sprite.height,
          );
        }
        c.globalAlpha = 1;
        c.strokeStyle = f.theme.text;
        c.globalAlpha = 0.3;
        c.lineWidth = 1;
        c.setLineDash([2, 6]);
        line(c, x, b.top - 10, x, b.bottom + 12);
        c.setLineDash([]);
        c.globalAlpha = 1;
        for (const p of g.plants) {
          if (
            !p.leaves.length ||
            f.now < p.leaves[0].note.start ||
            f.now > (p.leaves.at(-1) ?? p.leaves[0]).note.start + 0.65
          )
            continue;
          const y = b.vineY(p, clamp(f.now, g.from, g.to));
          c.strokeStyle = ink(f, p.id);
          c.lineWidth = 1.8;
          c.beginPath();
          c.moveTo(x - 9, y);
          c.bezierCurveTo(x + 14, y - 17, x + 8, y + 9, x + 3, y - 1);
          c.stroke();
          leaf(c, x + 2, y - 3, Math.min(5, b.plantBand(p) * 0.17), 2, 0.3);
          c.fillStyle = ink(f, p.id);
          c.fill();
        }
        c.drawImage(tags, 0, 0, f.width, f.height);
        labels(c, f, g, b, clusters, tagPlan, true);
      },
      dispose() {
        canvas.remove();
        for (const layer of [canvas, sky, grown, future, tags, atlas]) {
          layer.width = 0;
          layer.height = 0;
        }
        notes = undefined;
        g = undefined;
        b = undefined;
        clusters = [];
        sprites.clear();
        for (const root of roots) {
          root.canvas.width = 0;
          root.canvas.height = 0;
        }
        roots = [];
        tagPlan = { placed: [], hidden: 0 };
      },
    };
  },
};
export default definition;
