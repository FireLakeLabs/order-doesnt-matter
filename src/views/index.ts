import type { ViewDefinition } from './types';

export interface ViewEntry {
  id: string;
  load(): Promise<ViewDefinition>;
}
/** The filename is the stable id; the module and any renderer load on demand. */
export function discoverViews(
  modules: Record<string, () => Promise<{ default: ViewDefinition }>>,
): ViewEntry[] {
  return Object.entries(modules)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, load]) => {
      const id = path.replace('./', '').replace('.view.ts', '');
      let definition: Promise<ViewDefinition> | undefined;
      return {
        id,
        load: () =>
          (definition ??= load().then((module) => {
            if (module.default.id !== id) throw Error(`View id must match filename: ${id}`);
            return module.default;
          })),
      };
    });
}
export const views = discoverViews(import.meta.glob<{ default: ViewDefinition }>('./*.view.ts'));
