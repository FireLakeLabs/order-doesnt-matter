import { readFileSync } from "node:fs";
import { importStrudel, generate } from "./src/index.ts";
const entries: { file: string }[] = JSON.parse(
  readFileSync(new URL("../../corpus/index.json", import.meta.url), "utf8"),
);
const sources = entries.map((e) =>
  readFileSync(new URL(`../../corpus/${e.file}`, import.meta.url), "utf8"),
);
let bytes = 0;
for (let round = 0; round < 60; round++)
  for (const source of sources)
    bytes += generate(importStrudel(source).doc).length;
console.log({ bytes });
