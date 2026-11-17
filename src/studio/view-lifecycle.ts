import type { ViewDefinition, ViewFrame, ViewHandle } from '../views/types';

/** Own async mounts, including partial failures and mounts resolving after removal. */
export function mountView(
  load: () => Promise<ViewDefinition>,
  element: HTMLElement,
  failed: (error: unknown) => void,
) {
  let disposed = false;
  const isDisposed = () => disposed;
  let handle: ViewHandle | undefined;
  let definition: ViewDefinition | undefined;
  const release = () => {
    const mounted = handle;
    handle = undefined;
    mounted?.dispose();
  };
  const fail = (error: unknown) => {
    if (disposed) return;
    disposed = true;
    try {
      release();
    } catch {
      /* Keep the original drawing failure visible. */
    }
    element.replaceChildren();
    failed(error);
  };
  void Promise.resolve()
    .then(load)
    .then(async (view) => {
      if (disposed) return;
      const mounted = await view.mount(element);
      if (isDisposed()) mounted.dispose();
      else {
        handle = mounted;
        definition = view;
      }
    })
    .catch(fail);
  return {
    get definition() {
      return definition;
    },
    frame(frame: ViewFrame) {
      if (disposed) return;
      try {
        handle?.frame(frame);
      } catch (error) {
        fail(error);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        release();
      } catch (error) {
        failed(error);
      }
    },
  };
}
