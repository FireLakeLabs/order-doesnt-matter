import { createServer } from 'node:http';
import { expect } from '@playwright/test';
import { test } from './helpers';
import { blockHttps } from './offline';

test('offline pages and workers retain HTTP cache policy and abort every HTTPS request', async ({
  page,
}) => {
  let assets = 0,
    dynamic = 0;
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    if (request.url === '/asset') {
      assets++;
      response.setHeader('Cache-Control', 'public,max-age=31536000');
      response.end('asset');
    } else {
      response.setHeader('Cache-Control', 'no-store');
      response.end(String(++dynamic));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('Expected an allocated HTTP port');
    const failures: string[] = [];
    page.on('requestfailed', (request) => failures.push(request.failure()!.errorText));
    await blockHttps(page);
    await blockHttps(page);
    await page.goto('/?inspect');
    const script = (await page.locator('script[type="module"][src]').getAttribute('src'))!;
    const asset = await page.request.get(script);
    expect(asset.headers()['cache-control']).toBe('public,max-age=31536000,immutable');
    for (const path of ['/', '/assets/not-built.js']) {
      const document = await page.request.get(path);
      expect(document.headers()['cache-control']).not.toContain('immutable');
    }
    const result = await page.evaluate(async (origin) => {
      const asset = async () => (await fetch(`${origin}/asset`)).text();
      const values = [await asset(), await asset()];
      const live = [
        await (await fetch(`${origin}/dynamic`)).text(),
        await (await fetch(`${origin}/dynamic`)).text(),
      ];
      const blocked = await fetch('https://offline-main.invalid/canary').then(
        () => false,
        () => true,
      );
      const url = URL.createObjectURL(
        new Blob(
          [
            `onmessage=async({data:origin})=>{
          const values=[];
          for(let n=0;n<2;n++)values.push(await(await fetch(origin+'/asset')).text());
          const blocked=await fetch('https://offline-worker.invalid/canary').then(()=>false,()=>true);
          postMessage({values,blocked});
        }`,
          ],
          { type: 'text/javascript' },
        ),
      );
      const worker = new Worker(url);
      try {
        const result = await new Promise<{ values: string[]; blocked: boolean }>((resolve) => {
          worker.onmessage = (event) => resolve(event.data);
          worker.postMessage(origin);
        });
        return { values, live, blocked, worker: result };
      } finally {
        worker.terminate();
        URL.revokeObjectURL(url);
      }
    }, `http://127.0.0.1:${address.port}`);
    expect(result).toEqual({
      values: ['asset', 'asset'],
      live: ['1', '2'],
      blocked: true,
      worker: { values: ['asset', 'asset'], blocked: true },
    });
    await expect
      .poll(() => failures)
      .toEqual(['net::ERR_INTERNET_DISCONNECTED', 'net::ERR_INTERNET_DISCONNECTED']);
    expect(assets).toBe(1);
    expect(dynamic).toBe(2);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
