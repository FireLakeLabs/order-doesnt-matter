import type { ViewDefinition, ViewFrame } from './types';
import { staffScore, scoreRange } from './staff/model';

const view: ViewDefinition = {
  id: 'staff',
  name: 'Staff',
  group: 'pitch',
  tag: 'sheet music',
  needs: 'score',
  async mount(element) {
    // The engraving engine and its bundled Bravura outlines load only for Staff.
    const [library, { createEngraver }] = await Promise.all([
      import('vexflow'),
      import('./staff/engrave'),
    ]);
    const { engrave, playhead, license } = createEngraver(library);
    const canvas = document.createElement('canvas'),
      backing = document.createElement('canvas');
    const ctx = canvas.getContext('2d'),
      base = backing.getContext('2d');
    if (!ctx || !base) throw Error('Canvas 2D is unavailable');
    canvas.dataset.engravingLicense = license;
    element.append(canvas);
    let notes: ViewFrame['notes'] | undefined, score: ReturnType<typeof staffScore> | undefined;
    let key = '',
      geometry: ReturnType<typeof engrave> | undefined;
    return {
      frame(frame) {
        if (frame.width <= 0 || frame.height <= 0) return;
        const next = JSON.stringify([
          scoreRange(frame),
          frame.width,
          frame.height,
          frame.dpr,
          frame.theme,
          frame.instruments.map(({ id, name }) => [id, name]),
          document.fonts.check(`11px "${frame.theme.fontMono}"`),
          document.fonts.check(`22px "${frame.theme.fontDisplay}"`),
        ]);
        if (notes !== frame.notes || key !== next || !score) {
          score = staffScore(frame);
          notes = frame.notes;
          key = next;
          backing.width = canvas.width = Math.max(1, Math.round(frame.width * frame.dpr));
          backing.height = canvas.height = Math.max(1, Math.round(frame.height * frame.dpr));
          canvas.style.width = `${String(frame.width)}px`;
          canvas.style.height = `${String(frame.height)}px`;
          base.reset();
          base.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
          geometry = engrave(base, frame, score);
        }
        ctx.reset();
        ctx.drawImage(backing, 0, 0);
        ctx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
        if (geometry) playhead(ctx, frame, geometry);
      },
      dispose() {
        canvas.remove();
        canvas.width = backing.width = canvas.height = backing.height = 0;
        notes = undefined;
        score = undefined;
        geometry = undefined;
      },
    };
  },
};
export default view;
