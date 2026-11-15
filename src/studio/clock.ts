/** One RAF for the page. Stages share both the clock sample and frame callback. */
export function createFrameClock(
  read: () => number,
  request: (callback: FrameRequestCallback) => number,
  cancel: (id: number) => void,
) {
  const listeners = new Set<(now: number) => void>();
  let handle: number | undefined;
  const tick = () => {
    handle = undefined;
    const now = read();
    for (const listener of listeners) listener(now);
    if (listeners.size) handle = request(tick);
  };
  return {
    subscribe(listener: (now: number) => void) {
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
