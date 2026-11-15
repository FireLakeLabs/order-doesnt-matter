import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'vite';

// Vite's listen(0) chooses its default port. Middleware mode lets the actual
// HTTP socket ask the OS directly, with HMR on that same socket (no second port).
if (process.argv.length > 2) throw Error('Development launcher takes no arguments');
const http = createHttpServer();
const cacheDir = await mkdtemp('.browser-build-dev-');
let vite, closing;
const close = () =>
  (closing ??= (async () => {
    await vite?.close();
    if (http.listening) {
      http.closeAllConnections();
      await new Promise((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await rm(cacheDir, { recursive: true, force: true });
  })());
try {
  vite = await createServer({
    cacheDir,
    server: { middlewareMode: true, hmr: { server: http }, open: false },
  });
  http.on('request', vite.middlewares);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void close());
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  console.log(`Local: http://127.0.0.1:${http.address().port}/`);
} catch (error) {
  await close();
  throw error;
}
