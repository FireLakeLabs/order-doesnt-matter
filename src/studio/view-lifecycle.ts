import type { ViewDefinition, ViewFrame, ViewHandle } from '../views/types';

/** Own async mounts, including a mount that resolves after its host was removed. */
export function mountView(
  load: () => Promise<ViewDefinition>,
  element: HTMLElement,
  failed: (error: unknown) => void,
) {
  let disposed = false;
  const isDisposed = () => disposed;
  let handle: ViewHandle | undefined;
  let definition: ViewDefinition | undefined;
  void load()
    .then(async (view) => {
      if (isDisposed()) return;
      definition = view;
      const mounted = await view.mount(element);
      if (isDisposed()) mounted.dispose();
      else handle = mounted;
    })
    .catch((error: unknown) => {
      if (!disposed) failed(error);
    });
  return {
    get definition() {
      return definition;
    },
    frame(frame: ViewFrame) {
      try {
        handle?.frame(frame);
      } catch (error) {
        this.dispose();
        failed(error);
      }
    },
    dispose() {
      disposed = true;
      const mounted = handle;
      handle = undefined;
      mounted?.dispose();
    },
  };
}
