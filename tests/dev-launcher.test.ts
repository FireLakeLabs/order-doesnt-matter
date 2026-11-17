import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { expect, test } from 'vitest';

// Exercise the real launcher, sockets and signal cleanup, rather than mocking
// Vite's port handling. Each child has its own optimizer cache.
test('two development copies serve their printed OS ports and release them on signals', async () => {
  const children = [0, 1].map(() => {
    const child = spawn(process.execPath, ['scripts/dev.mjs'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    let log = '';
    child.stderr.on('data', (data) => (log += data));
    const ready = new Promise<string>((resolve, reject) => {
      child.stdout.on('data', (data) => {
        log += data;
        const url = log.match(/Local: (http:\/\/[^\s]+)/)?.[1];
        if (url) resolve(url);
      });
      child.once('error', reject);
      void exited.then(() => reject(Error(`Launcher exited before ready: ${log}`)));
    });
    return { child, exited, ready };
  });
  const sockets: WebSocket[] = [];
  try {
    const urls = await Promise.all(children.map((c) => c.ready));
    expect(new Set(urls).size).toBe(2);
    for (const url of urls) {
      expect(Number(new URL(url).port)).toBeGreaterThan(0);
      const page = await fetch(url);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('/src/studio/main.tsx');
      // HMR must use this listener too, rather than its fixed default port.
      const client = await fetch(new URL('/@vite/client', url));
      expect(client.status).toBe(200);
      const body = await client.text();
      const token = body.match(/const wsToken = "([^"\n]+)"/)?.[1];
      expect(token).toBeDefined();
      const socket = new WebSocket(`${url.replace('http:', 'ws:')}?token=${token}`, 'vite-hmr');
      sockets.push(socket);
      const [message] = await once(socket, 'message');
      expect(JSON.parse(message.data)).toEqual({ type: 'connected' });
    }
    const closed = sockets.map((socket) => once(socket, 'close'));
    children[0].child.kill('SIGINT');
    expect((await children[0].exited)[0]).toBe(0);
    expect((await fetch(urls[1])).status).toBe(200);
    children[1].child.kill('SIGTERM');
    expect((await children[1].exited)[0]).toBe(0);
    await Promise.all(closed);
    for (const url of urls) {
      const socket = createServer();
      try {
        socket.listen(Number(new URL(url).port), '127.0.0.1');
        await once(socket, 'listening');
      } finally {
        await new Promise<void>((resolve) => socket.close(() => resolve()));
      }
    }
  } finally {
    for (const socket of sockets) socket.close();
    for (const { child } of children) if (child.exitCode === null) child.kill('SIGKILL');
    await Promise.all(children.map((c) => c.exited));
  }
});
