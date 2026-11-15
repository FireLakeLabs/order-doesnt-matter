import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Each browser command owns a frozen build and a fresh server. Cache only
 * existing emitted assets; HTML, fixtures and missing paths retain Vite's policy.
 */
export function cacheBuiltAssets(directory) {
  const root = join(directory, 'assets');
  const files = new Set(
    readdirSync(root, { recursive: true })
      .filter((name) => statSync(join(root, name)).isFile())
      .map((name) => `/assets/${name.replaceAll('\\', '/')}`),
  );
  return {
    name: 'browser-build-asset-cache',
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://browser.invalid').pathname;
        if (files.has(pathname))
          response.setHeader('Cache-Control', 'public,max-age=31536000,immutable');
        next();
      });
    },
  };
}
