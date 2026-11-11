import { readFile } from "node:fs/promises";
export const switchAngelPath =
  "/home/aaron/projects/monkeyboys-modular-synth/src/library/patches/switch-angel-trance-demo.strudel";
// Runtime-only local source: never bundled, copied to public/, or written to dist.
export function localSourcePlugin() {
  const mount = (server) => {
    server.middlewares.use("/__local/switch-angel", async (req, res) => {
      try {
        res.setHeader("Content-Type", "text/plain");
        res.setHeader("Cache-Control", "no-store");
        res.end(await readFile(switchAngelPath, "utf8"));
      } catch {
        res.statusCode = 404;
        res.end("Local source unavailable");
      }
    });
  };
  return {
    name: "private-local-study-input",
    configureServer: mount,
    configurePreviewServer: mount,
  };
}
