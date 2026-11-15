import type { ViewDefinition } from './types';

const view: ViewDefinition = {
  id: 'test-card',
  name: 'Test card',
  tag: 'diagnostic',
  span: 'window',
  mount(element) {
    const canvas = document.createElement('canvas');
    element.append(canvas);
    const context = canvas.getContext('2d');
    if (!context) {
      canvas.remove();
      throw Error('Canvas 2D is unavailable');
    }
    return {
      frame(frame) {
        const { width, height, dpr, theme, now, lookAhead, instruments, notes } = frame;
        if (
          canvas.width !== Math.round(width * dpr) ||
          canvas.height !== Math.round(height * dpr)
        ) {
          canvas.width = Math.round(width * dpr);
          canvas.height = Math.round(height * dpr);
          canvas.style.width = `${String(width)}px`;
          canvas.style.height = `${String(height)}px`;
        }
        // Flex regions can have fractional CSS sizes. Cover every physical pixel
        // so antialiased edge pixels cannot accumulate colour across stopped frames.
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalAlpha = 1;
        context.fillStyle = theme.ground;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        const band = height / Math.max(1, instruments.length);
        const start = now - lookAhead * 0.1;
        const x = (cycle: number) => ((cycle - start) / (lookAhead * 1.1)) * width;
        // Every event contributes pixels, including dense occupancy and fragments.
        for (const instrument of instruments) {
          const y = instrument.index * band;
          context.fillStyle = instrument.colour;
          context.globalAlpha = 0.12;
          context.fillRect(0, y, width, band - 1);
          context.globalAlpha = instrument.muted ? 0.25 : 0.85;
          for (const note of notes) {
            if (
              note.instrument !== instrument.id ||
              note.end < start ||
              note.start > now + lookAhead
            )
              continue;
            const from = Math.max(0, x(note.start));
            const to = Math.min(width, x(note.end));
            context.fillRect(from, y + band * 0.25, Math.max(1, to - from), band * 0.5);
          }
          context.globalAlpha = 1;
          context.font = `12px "${theme.fontMono}"`;
          context.fillText(instrument.name, 12, y + 16);
        }
        context.strokeStyle = theme.text;
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(x(now), 0);
        context.lineTo(x(now), height);
        context.stroke();
      },
      dispose() {
        canvas.remove();
        canvas.width = 0;
        canvas.height = 0;
      },
    };
  },
};
export default view;
