import { createServer as probe } from 'node:net';
import { createServer } from 'vite';
export async function freePort() {
  const socket = probe(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address(); if (!address || typeof address === 'string') throw Error('No port');
  const port = address.port; await new Promise(resolve => socket.close(resolve)); return port;
}
if (process.argv[1]?.endsWith('serve.mjs')) {
  const server = await createServer({ server: { host: '0.0.0.0', port: await freePort(), strictPort: true } });
  await server.listen(); server.printUrls();
}
