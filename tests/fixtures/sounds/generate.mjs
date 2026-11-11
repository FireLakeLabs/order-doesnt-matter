// Original 100 ms, 440 Hz sine burst with a linear fade; dedicated to CC0.
// Regenerate with: node tests/fixtures/sounds/generate.mjs
import { writeFileSync } from 'node:fs';
const rate = 48000,
  length = rate / 10,
  wav = Buffer.alloc(44 + length * 2);
wav.write('RIFF');
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(length * 2, 40);
for (let i = 0; i < length; i++)
  wav.writeInt16LE(
    Math.round(18000 * Math.sin((2 * Math.PI * 440 * i) / rate) * (1 - i / length)),
    44 + i * 2,
  );
writeFileSync(new URL('./burst.wav', import.meta.url), wav);
