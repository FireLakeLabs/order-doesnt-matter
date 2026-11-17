import type { ViewDefinition } from './types';
import { bandLevel, logBands, risingTrigger } from './scope/model';

const view: ViewDefinition = {
  id: 'scope',
  name: 'Scope',
  tag: 'the sound',
  needs: 'audio',
  mount(element) {
    const canvas = document.createElement('canvas');
    canvas.dataset.scope = '';
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    element.append(canvas);
    const c = canvas.getContext('2d');
    if (!c) {
      canvas.remove();
      throw Error('Scope needs Canvas 2D');
    }
    let bands: Uint32Array = new Uint32Array(0);
    let waveLength = 0;
    let bins = 0;
    return {
      frame({ width: w, height: h, dpr, theme, audio }) {
        const pixelWidth = Math.round(w * dpr),
          pixelHeight = Math.round(h * dpr);
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
          canvas.width = pixelWidth;
          canvas.height = pixelHeight;
        }
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.fillStyle = theme.panel;
        c.fillRect(0, 0, w, h);
        // A physical instrument: inset glass, a deep bezel and a fixed control
        // column only where it leaves enough room for the measured signal.
        const pad = Math.max(14, Math.min(28, w * 0.025, h * 0.05));
        const controls = w >= 900 ? 130 : 0;
        const x = pad,
          y = pad,
          sw = w - pad * 2 - controls,
          sh = h - pad * 2;
        const radius = Math.min(28, sw * 0.05, sh * 0.08);
        c.fillStyle = theme.ground;
        c.beginPath();
        c.roundRect(x - 6, y - 6, sw + 12, sh + 12, radius + 6);
        c.fill();
        c.save();
        c.beginPath();
        c.roundRect(x, y, sw, sh, radius);
        c.clip();
        // The glass is darkened using the same palette tokens in every theme.
        c.fillStyle = theme.panel;
        c.fillRect(x, y, sw, sh);
        c.fillStyle = theme.ground;
        c.globalAlpha = 0.8;
        c.fillRect(x, y, sw, sh);
        c.globalAlpha = 1;
        c.strokeStyle = theme.line;
        c.lineWidth = 1;
        c.beginPath();
        for (let i = 0; i <= 10; i++) {
          c.moveTo(x + (sw * i) / 10, y);
          c.lineTo(x + (sw * i) / 10, y + sh);
        }
        for (let i = 0; i <= 8; i++) {
          c.moveTo(x, y + (sh * i) / 8);
          c.lineTo(x + sw, y + (sh * i) / 8);
        }
        c.stroke();
        const font = Math.max(11, Math.min(23, sw / 30));
        c.font = `${String(font)}px "${theme.fontMono}", monospace`;
        c.textAlign = 'left';
        c.fillStyle = theme.text;
        c.fillText('SCOPE', x + 16, y + font + 10);
        c.fillStyle = theme.muted;
        c.fillText('CH1 OUT · 5ms/DIV', x + 24 + c.measureText('SCOPE').width, y + font + 10);
        const trigger = audio ? risingTrigger(audio.wave) : -1;
        c.textAlign = 'right';
        c.fillStyle = theme.accent;
        c.fillText(audio ? (trigger >= 0 ? "TRIG'D" : 'AUTO') : '—', x + sw - 16, y + font + 10);
        c.textAlign = 'left';
        const spectrumTop = y + sh * 0.75;
        c.fillStyle = theme.muted;
        c.font = `${String(Math.max(10, font * 0.8))}px "${theme.fontMono}", monospace`;
        c.fillText('SPECTRUM 20Hz – 20kHz', x + 16, spectrumTop - 12);
        if (audio) {
          if (bins !== audio.spectrum.length || waveLength !== audio.wave.length) {
            bins = audio.spectrum.length;
            waveLength = audio.wave.length;
            bands = logBands(bins, waveLength / 0.1);
          }
          const count = Math.floor(audio.wave.length / 2);
          const start = trigger >= 0 ? trigger : 0;
          const mid = y + sh * 0.4;
          c.strokeStyle = c.fillStyle = theme.accent;
          c.lineWidth = 3;
          c.lineJoin = 'round';
          if (theme.glow) {
            c.shadowColor = theme.accent;
            c.shadowBlur = 10;
          }
          c.beginPath();
          // Interpolate at the crossing itself, anchoring a periodic trace at
          // zero instead of allowing its phase to wander by a whole sample.
          for (let i = 0; i <= count; i++) {
            const position = start + i,
              index = Math.floor(position);
            const a = audio.wave[Math.min(index, audio.wave.length - 1)];
            const b = audio.wave[Math.min(index + 1, audio.wave.length - 1)];
            const value = a + (b - a) * (position - index);
            const px = x + (i / count) * sw;
            const py = mid - Math.max(-1, Math.min(1, value)) * sh * 0.26;
            if (i === 0) c.moveTo(px, py);
            else c.lineTo(px, py);
          }
          c.stroke();
          const step = (sw - 32) / 24;
          for (let band = 0; band < 24; band++) {
            const height = bandLevel(audio.spectrum, bands, band) * (sh * 0.25 - 16);
            c.fillRect(x + 16 + band * step, y + sh - 16 - height, Math.max(1, step - 5), height);
          }
          c.shadowBlur = 0;
        } else {
          c.textAlign = 'center';
          c.fillStyle = theme.muted;
          c.font = `${String(Math.max(20, font * 1.5))}px "${theme.fontMono}", monospace`;
          c.fillText('NO SIGNAL', x + sw / 2, y + sh * 0.4);
        }
        c.globalAlpha = 0.18;
        c.fillStyle = theme.ground;
        for (let sy = y; sy < y + sh; sy += 4) c.fillRect(x, sy, sw, 1);
        c.restore();
        if (controls) {
          const cx = x + sw + controls / 2 + 7;
          c.textAlign = 'center';
          c.fillStyle = theme.text;
          c.font = `22px "${theme.fontDisplay}", sans-serif`;
          c.fillText('ODM', cx, y + 26);
          c.fillText('SC-140', cx, y + 49);
          const step = Math.min(92, (sh - 100) / 4);
          for (let i = 0; i < 4; i++) {
            const cy = y + 80 + i * step,
              r = Math.min(25, step * 0.3);
            c.fillStyle = theme.ground;
            c.strokeStyle = theme.line;
            c.lineWidth = 3;
            c.beginPath();
            c.arc(cx, cy, r, 0, Math.PI * 2);
            c.fill();
            c.stroke();
            const angle = -2.2 + i * 0.8;
            c.strokeStyle = theme.text;
            c.beginPath();
            c.moveTo(cx + Math.cos(angle) * r * 0.45, cy + Math.sin(angle) * r * 0.45);
            c.lineTo(cx + Math.cos(angle) * r * 0.85, cy + Math.sin(angle) * r * 0.85);
            c.stroke();
            c.fillStyle = theme.muted;
            c.font = `14px "${theme.fontMono}", monospace`;
            c.fillText(
              i === 0 ? 'TIME' : i === 1 ? 'GAIN' : i === 2 ? 'GLOW' : 'TRIG',
              cx,
              cy + r + 18,
            );
          }
          c.fillStyle = audio ? theme.accent : theme.muted;
          c.font = `14px "${theme.fontMono}", monospace`;
          c.fillText(audio ? '● PWR' : '○ PWR', cx, y + sh - 12);
        }
      },
      dispose() {
        canvas.remove();
        canvas.width = canvas.height = 0;
        bands = new Uint32Array(0);
      },
    };
  },
};
export default view;
