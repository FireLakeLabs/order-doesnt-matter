import type { ViewDefinition, ViewFrame } from './types';
import { activeRange, buildCloth, flash, stitchLight, wakeLength } from './loom/geometry';
import type { Cloth, Stitch } from './loom/geometry';

function shape(ctx: CanvasRenderingContext2D, stitch: Stitch, radius: number) {
  ctx.beginPath();
  if (radius)
    ctx.roundRect(
      stitch.x,
      stitch.y,
      stitch.width,
      stitch.height,
      Math.min(radius, stitch.height / 5, stitch.width / 3),
    );
  else ctx.rect(stitch.x, stitch.y, stitch.width, stitch.height);
}

function drawCloth(ctx: CanvasRenderingContext2D, cloth: Cloth, frame: ViewFrame) {
  const { theme, width, height } = frame;
  const { box, scale } = cloth;
  const pocket = theme.name === 'pocket';
  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, 0, width, height);
  ctx.font = `22px "${theme.fontDisplay}"`;
  ctx.fillStyle = theme.text;
  ctx.fillText('Loom', box.marginX, box.marginY + 20);
  ctx.font = `11px "${theme.fontMono}"`;
  ctx.fillStyle = theme.muted;
  ctx.textAlign = 'right';
  ctx.fillText(
    `${String(cloth.to - cloth.from)} cycles · ${String(cloth.threads.length)} threads`,
    width - box.marginX,
    box.marginY + 18,
  );
  ctx.textAlign = 'left';

  // A woven ground: hairline warp, with cross-grain between the instrument threads.
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1;
  ctx.globalAlpha = pocket ? 1 : theme.name === 'riso' ? 0.13 : 0.45;
  if (pocket) ctx.setLineDash([1, 4]);
  ctx.beginPath();
  for (let cycle = Math.ceil(cloth.from); cycle <= cloth.to; cycle++) {
    const x = box.left + (cycle - cloth.from) * scale;
    ctx.moveTo(x, box.top - 8);
    ctx.lineTo(x, box.top + box.height + 8);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  if (!pocket) {
    ctx.globalAlpha = theme.name === 'riso' ? 0.055 : 0.18;
    ctx.beginPath();
    for (let y = box.top; y <= box.top + box.height; y += 4) {
      ctx.moveTo(box.left, y);
      ctx.lineTo(box.left + box.width, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const duration = cloth.to - cloth.from;
  for (const section of frame.sections) {
    // Sections supplied by the host describe the first pass; align subsequent passes.
    const offset = Math.floor(cloth.from / Math.max(duration, 0.001)) * duration;
    const x = box.left + (section.from + offset - cloth.from) * scale;
    if (x < box.left || x >= box.left + box.width) continue;
    ctx.fillStyle = theme.muted;
    ctx.fillText(
      section.name,
      x + 7,
      box.top - 22,
      Math.max(1, (section.to - section.from) * scale - 12),
    );
    ctx.strokeStyle = theme.muted;
    ctx.beginPath();
    ctx.moveTo(x, box.top - 32);
    ctx.lineTo(x, box.top - 12);
    ctx.stroke();
  }

  cloth.threads.forEach((thread, row) => {
    const instrument = frame.instruments[row];
    const strength = instrument.muted ? 0.24 : 1;
    const ink = pocket && instrument.muted ? theme.muted : instrument.colour;
    ctx.strokeStyle = ink;
    ctx.globalAlpha = pocket ? 1 : 0.35 * strength;
    ctx.lineWidth = 1.5;
    if (pocket) ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(box.left, thread.y);
    ctx.lineTo(box.left + box.width, thread.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = pocket ? 1 : strength;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(box.marginX + 4, thread.y, 3, 0, Math.PI * 2);
    ctx.fill();
    if (box.labels) {
      ctx.fillStyle = theme.muted;
      ctx.fillText(instrument.name, box.marginX + 17, thread.y + 4, box.left - box.marginX - 27);
    }
    if (thread.occupancy) {
      const bandHeight = box.pitch * 0.6;
      for (let pixel = 0; pixel < thread.occupancy.length; pixel++) {
        const coverage = thread.occupancy[pixel];
        if (!coverage) continue;
        ctx.fillStyle = ink;
        ctx.globalAlpha = pocket
          ? 1
          : coverage * (0.18 + 0.72 * (thread.levels?.[pixel] ?? 1)) * strength;
        // Pocket expresses coverage as stipple, without creating intermediate ink shades.
        if (
          pocket &&
          (pixel + row) % 4 >= Math.ceil(coverage * (thread.levels?.[pixel] ?? 1) * strength * 4)
        )
          continue;
        ctx.fillRect(
          box.left + pixel,
          thread.tops?.[pixel] ?? thread.y - bandHeight / 2,
          Math.min(1, box.width - pixel),
          bandHeight,
        );
      }
    } else {
      for (const stitch of thread.stitches) {
        ctx.fillStyle = ink;
        ctx.globalAlpha = pocket ? 1 : (0.14 + stitch.level * 0.76) * strength;
        shape(ctx, stitch, theme.radius);
        ctx.fill();
        if (pocket) {
          // Four ink shades: gain is the density of the stitch, rather than a colour blend.
          ctx.fillStyle = theme.ground;
          const duty = Math.ceil(stitch.level * strength * 4);
          for (let pixel = Math.floor(stitch.x); pixel < stitch.x + stitch.width; pixel++) {
            if ((pixel + row) % 4 >= duty)
              ctx.fillRect(
                Math.max(pixel, stitch.x),
                stitch.y,
                Math.min(pixel + 1, stitch.x + stitch.width) - Math.max(pixel, stitch.x),
                stitch.height,
              );
          }
        }
        if (!pocket) {
          // The top catches light; the underside sits beneath the next crossing.
          ctx.save();
          ctx.clip();
          const shading = ctx.createLinearGradient(0, stitch.y, 0, stitch.y + stitch.height);
          shading.addColorStop(0, theme.text);
          shading.addColorStop(0.18, instrument.colour);
          shading.addColorStop(0.65, instrument.colour);
          shading.addColorStop(1, theme.ground);
          ctx.fillStyle = shading;
          ctx.globalAlpha = 0.38 * strength * (0.2 + stitch.level * 0.8);
          ctx.fillRect(stitch.x, stitch.y, stitch.width, stitch.height);
          ctx.restore();
        }
      }
    }
    // Small alternating crossings keep long floats reading as yarn, rather than bars.
    ctx.save();
    ctx.beginPath();
    if (thread.occupancy) {
      for (let pixel = 0; pixel < thread.occupancy.length; pixel++) {
        if (thread.occupancy[pixel])
          ctx.rect(
            box.left + pixel,
            thread.tops?.[pixel] ?? thread.y - box.pitch * 0.3,
            1,
            box.pitch * 0.6,
          );
      }
    } else {
      for (const stitch of thread.stitches)
        ctx.rect(stitch.x, stitch.y, stitch.width, stitch.height);
    }
    ctx.clip();
    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.ground;
    ctx.globalAlpha = pocket ? 1 : 0.42;
    ctx.beginPath();
    const spacing = pocket ? 4 + (row % 4) * 2 : 6;
    for (let x = box.left + (row % 2) * 3; x < box.left + box.width; x += spacing) {
      const upper = Math.floor((x - box.left) / spacing) % 2 === 0;
      ctx.moveTo(x, thread.y + (upper ? -box.pitch * 0.46 : 0));
      ctx.lineTo(x + (pocket ? row % 3 : 2), thread.y + (upper ? 0 : box.pitch * 0.46));
    }
    ctx.stroke();
    ctx.restore();
  });
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.muted;
  ctx.font = `10px "${theme.fontMono}"`;
  ctx.fillText('TIME →', box.left, height - box.marginY);
  ctx.textAlign = 'right';
  ctx.fillText(
    frame.sections.length ? 'THE WHOLE SONG · REPEATS' : '16 cycles shown',
    width - box.marginX,
    height - box.marginY,
  );
  ctx.textAlign = 'left';
}

function drawLive(ctx: CanvasRenderingContext2D, cloth: Cloth, frame: ViewFrame) {
  const { now, theme, trails, cps } = frame;
  const { box, scale } = cloth;
  const pocket = theme.name === 'pocket';
  const wakeCycles = wakeLength(trails);
  if (now < cloth.from || now > cloth.to) return;
  const x = box.left + (now - cloth.from) * scale;
  ctx.fillStyle = theme.text;
  ctx.globalAlpha = pocket ? 1 : 0.035;
  const cycleX = box.left + (Math.floor(now) - cloth.from) * scale;
  if (pocket) {
    ctx.fillRect(cycleX, box.top - 8, Math.min(scale, box.left + box.width - cycleX), 1);
    ctx.fillRect(
      cycleX,
      box.top + box.height + 8,
      Math.min(scale, box.left + box.width - cycleX),
      1,
    );
  } else
    ctx.fillRect(
      cycleX,
      box.top - 8,
      Math.min(scale, box.left + box.width - cycleX),
      box.height + 16,
    );
  if (trails) {
    const wake = wakeCycles * scale;
    const start = Math.max(box.left, x - wake);
    if (pocket) {
      ctx.fillStyle = theme.text;
      ctx.globalAlpha = 1;
      for (let px = Math.ceil(start); px < x; px += 3) {
        const distance = (x - px) / wake;
        const step = 5 + Math.floor(distance * 15);
        for (let py = box.top; py < box.top + box.height; py += step) ctx.fillRect(px, py, 1, 1);
      }
    } else {
      const gradient = ctx.createLinearGradient(x - wake, 0, x, 0);
      gradient.addColorStop(0, theme.ground);
      gradient.addColorStop(1, theme.text);
      ctx.fillStyle = gradient;
      ctx.globalAlpha = 0.1;
      ctx.fillRect(start, box.top - 8, x - start, box.height + 16);
    }
  }
  cloth.threads.forEach((thread, row) => {
    // A resting row may still carry the afterglow of the section that just ended.
    if (frame.instruments[row].muted) return;
    if (thread.occupancy) {
      if (wakeCycles) {
        const start = Math.max(0, Math.floor(x - box.left - wakeCycles * scale));
        const end = Math.min(thread.occupancy.length, Math.floor(x - box.left));
        ctx.fillStyle = theme.text;
        for (let pixel = start; pixel < end; pixel++) {
          const age = now - (cloth.from + (pixel + 1) / scale);
          const light =
            0.12 *
            thread.occupancy[pixel] *
            (thread.levels?.[pixel] ?? 1) *
            Math.max(0, 1 - age / wakeCycles);
          if (!light || (pocket && (pixel + row) % 4 >= Math.ceil(light * 4))) continue;
          ctx.globalAlpha = pocket ? 1 : light;
          ctx.fillRect(
            box.left + pixel,
            thread.tops?.[pixel] ?? thread.y - box.pitch * 0.3,
            1,
            box.pitch * 0.6,
          );
        }
      }
      // Light the coverage around the gate, never thousands of individual subpixel events.
      const pixel = Math.min(thread.occupancy.length - 1, Math.floor(x - box.left));
      const coverage = thread.occupancy[pixel];
      if (coverage && frame.instruments[row].inSection) {
        ctx.fillStyle = theme.text;
        ctx.globalAlpha = pocket ? 1 : 0.55 * coverage;
        ctx.fillRect(x - 1, thread.tops?.[pixel] ?? thread.y - box.pitch * 0.3, 2, box.pitch * 0.6);
      }
      return;
    }
    const { first, end } = activeRange(thread, now, wakeCycles);
    for (let i = first; i < end; i++) {
      const stitch = thread.stitches[i];
      if (stitch.end > now && !frame.instruments[row].inSection) continue;
      const light = stitchLight(stitch, now, cps, wakeCycles);
      if (!light) continue;
      const hit = flash(stitch, now, cps);
      ctx.fillStyle = theme.text;
      ctx.globalAlpha = pocket ? 1 : light;
      if (pocket && stitch.end <= now) {
        for (let pixel = Math.floor(stitch.x); pixel < stitch.x + stitch.width; pixel++) {
          if ((pixel + row) % 4 < Math.ceil(light * 4)) ctx.fillRect(pixel, stitch.y, 1, 1);
        }
      } else if (pocket) ctx.fillRect(stitch.x, stitch.y, stitch.width, hit > 0.5 ? 3 : 1);
      else {
        shape(ctx, stitch, theme.radius);
        ctx.fill();
      }
    }
  });
  ctx.globalAlpha = 1;
  ctx.strokeStyle = theme.text;
  ctx.lineWidth = 2;
  if (theme.glow) {
    ctx.shadowColor = theme.text;
    ctx.shadowBlur = 12;
  }
  ctx.beginPath();
  ctx.moveTo(x, box.top - 10);
  ctx.lineTo(x, box.top + box.height + 10);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = theme.text;
  ctx.beginPath();
  ctx.moveTo(x - 4, box.top - 13);
  ctx.lineTo(x + 4, box.top - 13);
  ctx.lineTo(x, box.top - 9);
  ctx.fill();
}

/** Ignore transient sounding/inSection flags: they do not change the whole-song cloth. */
function appearance(frame: ViewFrame) {
  return JSON.stringify([
    frame.width,
    frame.height,
    frame.dpr,
    frame.from,
    frame.to,
    frame.theme,
    document.fonts.check(`11px "${frame.theme.fontMono}"`),
    document.fonts.check(`22px "${frame.theme.fontDisplay}"`),
    frame.sections,
    frame.instruments.map(({ id, name, colour, muted }) => [id, name, colour, muted]),
  ]);
}

const view: ViewDefinition = {
  id: 'loom',
  name: 'Loom',
  tag: 'whole song',
  span: 'song',
  mount(element) {
    const canvas = document.createElement('canvas');
    const backing = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const staticCtx = backing.getContext('2d');
    if (!ctx || !staticCtx) throw Error('Canvas 2D is unavailable');
    element.append(canvas);
    let cloth: Cloth | undefined;
    let notes: ViewFrame['notes'] | undefined;
    let key = '';
    return {
      frame(frame) {
        if (frame.width <= 0 || frame.height <= 0) return;
        const next = appearance(frame);
        if (!cloth || notes !== frame.notes || key !== next) {
          const width = Math.max(1, Math.round(frame.width * frame.dpr));
          const height = Math.max(1, Math.round(frame.height * frame.dpr));
          canvas.width = backing.width = width;
          canvas.height = backing.height = height;
          canvas.style.width = `${String(frame.width)}px`;
          canvas.style.height = `${String(frame.height)}px`;
          staticCtx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
          // Cover the fractional physical edge as well as the CSS-sized cloth.
          staticCtx.fillStyle = frame.theme.ground;
          staticCtx.fillRect(0, 0, width / frame.dpr, height / frame.dpr);
          cloth = buildCloth(frame);
          drawCloth(staticCtx, cloth, frame);
          notes = frame.notes;
          key = next;
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.drawImage(backing, 0, 0);
        ctx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
        drawLive(ctx, cloth, frame);
      },
      dispose() {
        canvas.remove();
        canvas.width = backing.width = 0;
        canvas.height = backing.height = 0;
        cloth = undefined;
        notes = undefined;
      },
    };
  },
};
export default view;
