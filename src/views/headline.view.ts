import type { ViewDefinition, ViewFrame } from './types';
import { mount2d } from './shared/retro-2d';
import { fitWord, indexWords, poster } from './headline/model';

function ellipsize(c: CanvasRenderingContext2D, text: string, width: number) {
  if (c.measureText(text).width <= width) return text;
  const characters = Array.from(text);
  let low = 0,
    high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (c.measureText(`${characters.slice(0, middle).join('')}…`).width <= width) low = middle;
    else high = middle - 1;
  }
  return `${characters.slice(0, low).join('')}…`;
}

function drawHeadline(
  c: CanvasRenderingContext2D,
  frame: ViewFrame,
  data: ReturnType<typeof indexWords>,
) {
  const { width, height, theme } = frame;
  // mount2d's CSS-sized fill leaves fractional physical edge pixels uncleared.
  c.save();
  c.resetTransform();
  c.fillStyle = theme.ground;
  c.fillRect(0, 0, c.canvas.width, c.canvas.height);
  c.restore();
  const scene = poster(frame, data);
  const scale = width / 960;
  const margin = Math.max(16, 24 * scale);
  const pocket = theme.name === 'pocket';
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  c.font = `700 ${String(Math.max(24, 30 * scale))}px "${theme.fontDisplay}"`;
  c.fillStyle = theme.text;
  c.fillText(scene.section.name.toUpperCase(), margin, Math.max(36, 36 * scale), width * 0.6);
  c.font = `${String(Math.max(10, 10 * scale))}px "${theme.fontMono}"`;
  c.textAlign = 'right';
  c.fillStyle = theme.muted;
  c.fillText(`BAR ${String(Math.floor(frame.now) + 1)}`, width - margin, Math.max(34, 34 * scale));
  c.textAlign = 'left';
  c.fillText(
    pocket ? 'SOLID / HOLLOW · WEIGHT / GAIN' : 'SOLID / HELD   HOLLOW / REST   WEIGHT / GAIN',
    margin,
    Math.max(54, 53 * scale),
    width - margin * 2,
  );
  for (const word of scene.words) {
    c.save();
    c.beginPath();
    c.rect(word.x - 3, word.y, word.width + 6, word.height);
    c.clip();
    c.font = `${String(word.weight)} ${String(word.fontSize)}px "${theme.fontDisplay}"`;
    const metrics = c.measureText(word.text);
    const ascent = metrics.actualBoundingBoxAscent;
    const descent = metrics.actualBoundingBoxDescent;
    const inkHeight = Math.max(1, ascent + descent);
    const fit = fitWord(word, metrics.width, inkHeight);
    const inkTop = word.y + (word.height - inkHeight * fit.scaleY) / 2;
    const base = inkTop + ascent * fit.scaleY;
    c.translate(
      word.x + Math.max(0, word.slant) * ascent + Math.max(0, -word.slant) * descent,
      base,
    );
    c.transform(fit.scaleX, 0, word.slant, fit.scaleY, 0, 0);
    c.fillStyle = word.instrument.colour;
    c.strokeStyle = word.instrument.colour;
    c.globalAlpha = word.instrument.muted ? 0.35 : 1;
    c.lineJoin = 'round';
    // Gain remains visible with fonts that only ship a single native weight.
    const thickness = ((word.weight - 300) / 500) * Math.max(1, word.fontSize * 0.025);
    if (word.solid) {
      c.shadowColor = word.instrument.colour;
      c.shadowBlur = theme.glow && !pocket ? word.punch * 45 * scale : 0;
      c.fillText(word.text, 0, 0);
      c.shadowBlur = 0;
      c.lineWidth = thickness;
      if (thickness > 0) c.strokeText(word.text, 0, 0);
    } else {
      c.lineWidth = Math.max(1.2, word.fontSize * 0.014 + thickness * 0.5);
      c.strokeText(word.text, 0, 0);
    }
    c.restore();
    if (!pocket && word.solid && word.progress > 0) {
      c.globalAlpha = 0.45;
      c.fillStyle = word.instrument.colour;
      c.fillRect(word.x, word.y + word.height - 3, word.width * word.progress, 2);
    }
    if (!pocket && (word.hits > 1 || word.active > 1)) {
      c.globalAlpha = 1;
      c.fillStyle = theme.muted;
      c.font = `${String(Math.max(10, 10 * scale))}px "${theme.fontMono}"`;
      c.textAlign = 'right';
      c.fillText(
        word.hits > 1 ? `${String(word.hits)} HITS` : `${String(word.active)} HELD`,
        word.x + word.width,
        word.y + word.height - 5,
      );
      c.textAlign = 'left';
    }
  }
  c.globalAlpha = 1;
  if (scene.sitOut.length) {
    c.fillStyle = theme.muted;
    c.font = `${String(Math.max(12, 11 * scale))}px "${theme.fontMono}"`;
    const text = `+${String(scene.sitOut.length)} sit out this section: ${scene.sitOut.map((i) => i.name).join(', ')}`;
    c.fillText(ellipsize(c, text, width - margin * 2), margin, height - Math.max(12, 12 * scale));
  }
  if (!scene.words.length) {
    c.fillStyle = theme.muted;
    c.font = `${String(Math.max(24, 56 * scale))}px "${theme.fontDisplay}"`;
    c.fillText(
      frame.instruments.length ? 'No instruments in this section' : 'Your score becomes the poster',
      margin,
      height * 0.5,
      width - margin * 2,
    );
  }
}
const view: ViewDefinition = {
  id: 'headline',
  name: 'Headline',
  group: 'show',
  tag: 'kinetic type',
  mount: (element) => mount2d(element, indexWords, drawHeadline),
};
export default view;
