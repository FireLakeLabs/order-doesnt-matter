/** One pending controller request. Dismissal always keeps the current session. */
let resolve: ((replace: boolean) => void) | undefined;
const listeners = new Set<() => void>();
export const replacement = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => !!resolve,
  request() {
    if (resolve) return Promise.resolve(false);
    return new Promise<boolean>((done) => {
      resolve = done;
      for (const listener of listeners) listener();
    });
  },
  answer(replace: boolean) {
    const done = resolve;
    resolve = undefined;
    done?.(replace);
    for (const listener of listeners) listener();
  },
};
