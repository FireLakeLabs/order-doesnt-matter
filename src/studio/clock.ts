export interface TransportFrame {
  now: number;
  cps: number;
  playing: boolean;
}
export type StudioClock = ReturnType<typeof createFrameClock>;

/** One page RAF sends the same transport sample to every subscriber. */
export function createFrameClock(
  read: () => TransportFrame,
  request: (callback: FrameRequestCallback) => number,
  cancel: (id: number) => void,
) {
  const listeners = new Set<(sample: TransportFrame) => void>();
  let handle: number | undefined;
  const tick = () => {
    handle = undefined;
    const sample = read();
    for (const listener of listeners) listener(sample);
    if (listeners.size) handle = request(tick);
  };
  return {
    subscribe(listener: (sample: TransportFrame) => void) {
      listeners.add(listener);
      handle ??= request(tick);
      return () => {
        listeners.delete(listener);
        if (!listeners.size && handle !== undefined) {
          cancel(handle);
          handle = undefined;
        }
      };
    },
  };
}
