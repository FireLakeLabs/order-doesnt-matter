import { createServer as probe } from "node:net";
import { createServer, preview } from "vite";
export async function freePort() {
  const s = probe();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
if (process.argv[1]?.endsWith("serve.mjs")) {
  const port = await freePort();
  const server = process.argv.includes("--built")
    ? await preview({ preview: { host: "0.0.0.0", port, strictPort: true } })
    : await createServer({
        server: { host: "0.0.0.0", port, strictPort: true },
      });
  if (!process.argv.includes("--built")) await server.listen();
  server.printUrls();
}
