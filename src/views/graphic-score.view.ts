import type { ViewDefinition, ViewFrame } from './types';
import { graphicScore, posterLayout, scoreRange } from './graphic-score/model';
import type { GraphicScore, PosterLayout } from './graphic-score/model';
import { drawPoster, drawPlayhead } from './graphic-score/drawing';

const view: ViewDefinition = {
  id: 'graphic-score',
  name: 'Graphic score',
  group: 'pitch',
  tag: 'poster',
  span: 'song',
  mount(element) {
    const wrapper = document.createElement('div'),
      canvas = document.createElement('canvas'),
      backing = document.createElement('canvas'),
      download = document.createElement('button');
    wrapper.style.cssText = 'position:relative;width:100%;height:100%';
    canvas.style.display = 'block';
    download.textContent = 'Download';
    download.title = 'Download poster PNG';
    download.type = 'button';
    download.style.cssText =
      'position:absolute;right:18px;top:18px;padding:7px 12px;border:1px solid currentColor;border-radius:3px;cursor:pointer;font-size:11px';
    wrapper.append(canvas, download);
    element.append(wrapper);
    const ctx = canvas.getContext('2d'),
      base = backing.getContext('2d');
    if (!ctx || !base) throw Error('Canvas 2D is unavailable');
    let score: GraphicScore | undefined,
      box: PosterLayout | undefined,
      last: ViewFrame | undefined,
      notes: ViewFrame['notes'] | undefined;
    let scoreKey = '',
      paintKey = '',
      disposed = false;
    const urls = new Set<string>();
    const exportPoster = () => {
      if (!last || !score) return;
      const snapshot = last,
        poster = document.createElement('canvas');
      const scale = Math.min(4, 7000 / snapshot.width);
      poster.width = Math.round(snapshot.width * scale);
      poster.height = Math.round(snapshot.height * scale);
      const print = poster.getContext('2d');
      if (!print) return;
      print.scale(scale, scale);
      drawPoster(print, score, posterLayout(score, snapshot.width, snapshot.height), snapshot);
      poster.toBlob((blob) => {
        poster.width = poster.height = 0;
        if (!blob || disposed) return;
        urls.forEach((url) => {
          URL.revokeObjectURL(url);
        });
        urls.clear();
        const url = URL.createObjectURL(blob);
        urls.add(url);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'graphic-score.png';
        link.click();
      }, 'image/png');
    };
    download.addEventListener('click', exportPoster);
    return {
      frame(frame) {
        if (frame.width <= 0 || frame.height <= 0) return;
        last = frame;
        const nextScore = JSON.stringify([
          scoreRange(frame),
          frame.from,
          frame.to,
          frame.sections,
          frame.instruments.map((i) => [i.id, i.name, i.index]),
        ]);
        const changed = !score || notes !== frame.notes || scoreKey !== nextScore;
        if (changed) {
          score = graphicScore(frame);
          notes = frame.notes;
          scoreKey = nextScore;
        }
        if (!score) return;
        const nextPaint = JSON.stringify([
          frame.width,
          frame.height,
          frame.dpr,
          frame.theme,
          frame.instruments.map((i) => [i.id, i.colour]),
          document.fonts.check(`bold 38px "${frame.theme.fontDisplay}"`),
          document.fonts.check(`11px "${frame.theme.fontMono}"`),
        ]);
        if (changed || paintKey !== nextPaint) {
          box = posterLayout(score, frame.width, frame.height);
          canvas.width = backing.width = Math.max(1, Math.round(frame.width * frame.dpr));
          canvas.height = backing.height = Math.max(1, Math.round(frame.height * frame.dpr));
          canvas.style.width = `${String(frame.width)}px`;
          canvas.style.height = `${String(frame.height)}px`;
          base.reset();
          base.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
          drawPoster(base, score, box, frame);
          download.style.color = frame.theme.text;
          download.style.background = frame.theme.ground;
          download.style.fontFamily = frame.theme.fontMono;
          paintKey = nextPaint;
        }
        if (!box) return;
        ctx.reset();
        ctx.drawImage(backing, 0, 0);
        ctx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
        drawPlayhead(ctx, box, frame);
      },
      dispose() {
        disposed = true;
        download.removeEventListener('click', exportPoster);
        urls.forEach((url) => {
          URL.revokeObjectURL(url);
        });
        urls.clear();
        wrapper.remove();
        canvas.width = canvas.height = backing.width = backing.height = 0;
        last = undefined;
        score = undefined;
        box = undefined;
        notes = undefined;
      },
    };
  },
};
export default view;
