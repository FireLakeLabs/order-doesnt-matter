import type { SoundState } from '../contract';

export const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
export function soundName(value: unknown): string {
  const v =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : { s: typeof value === 'string' ? value : 'triangle' };
  return `${v.bank ? `${String(v.bank)}_` : ''}${String(v.s ?? 'triangle')}`.toLowerCase();
}
export class Revision {
  private current = 0;
  private reported = 0;
  private committed = 0;
  next() {
    return ++this.current;
  }
  commit(revision: number) {
    if (revision !== this.current || revision === this.reported || revision === this.committed)
      return false;
    this.committed = revision;
    return true;
  }
  trigger(revision: number) {
    if (revision !== this.current || revision === this.reported) return false;
    this.reported = revision;
    return true;
  }
}
export class SoundBook {
  private files = new Map<string, { state: SoundState; work: Promise<boolean> }>();
  constructor(
    private check: (value: unknown) => Promise<void>,
    private changed: () => void,
    private key: (value: unknown) => string = JSON.stringify,
  ) {}
  list(): SoundState[] {
    const names = new Map<string, SoundState>();
    const priority = { ready: 0, loading: 1, missing: 2 };
    for (const { state } of this.files.values()) {
      const old = names.get(state.name);
      if (!old || priority[state.state] > priority[old.state]) names.set(state.name, { ...state });
    }
    return [...names.values()];
  }
  observe(value: unknown): Promise<boolean> {
    const name = soundName(value),
      key = this.key(value);
    const old = this.files.get(key);
    if (old) return old.work;
    const entry = { state: { name, state: 'loading' } as SoundState, work: Promise.resolve(false) };
    this.files.set(key, entry);
    this.changed();
    entry.work = this.check(value)
      .then(
        () => {
          entry.state = { name, state: 'ready' };
        },
        (error) => {
          entry.state = { name, state: 'missing', detail: message(error) };
        },
      )
      .then(() => {
        this.changed();
        return entry.state.state === 'ready';
      });
    return entry.work;
  }
}
export interface PCM {
  frame: number;
  channels: Float32Array[];
}
/** No invented zeroes: a window must be covered by captured PCM in its entirety. */
export function rms(chunks: PCM[], rate: number, from: number, to: number): number {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from)
    throw Error('Invalid RMS window');
  const begin = Math.ceil(from * rate),
    end = Math.ceil(to * rate);
  let energy = 0,
    frames = 0;
  for (const { frame, channels } of chunks) {
    const a = Math.max(begin, frame),
      b = Math.min(end, frame + channels[0].length);
    for (let i = a; i < b; i++) {
      const left = channels[0][i - frame],
        right = (channels[1] ?? channels[0])[i - frame];
      energy += left * left + right * right;
      frames++;
    }
  }
  if (!frames || frames !== end - begin) throw Error('RMS window was not fully captured');
  return Math.sqrt(energy / (frames * 2));
}

/** Audio-clock progress can precede worklet message delivery. Await the actual
 * contiguous capture, not just its latest timestamp. Never substitute silence. */
export async function capturedRms(
  chunks: PCM[],
  rate: number,
  from: number,
  to: number,
  timeout = 11000,
): Promise<number> {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from)
    throw Error('Invalid RMS window');
  const begin = Math.ceil(from * rate),
    end = Math.ceil(to * rate);
  const deadline = performance.now() + timeout;
  while (true) {
    let covered = begin;
    for (const chunk of chunks) {
      if (chunk.frame > covered) break;
      covered = Math.max(covered, chunk.frame + chunk.channels[0].length);
      if (covered >= end) return rms(chunks, rate, from, to);
    }
    if (performance.now() >= deadline)
      throw Error(
        `Timed out waiting for output tap frames ${begin}–${end}; captured through ${covered}, next ${chunks.find((c) => c.frame > covered)?.frame}, latest ${chunks.at(-1)?.frame}. Audio may be suspended or capture expired.`,
      );
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
