import { readFileSync, writeFileSync } from "node:fs";
import { importStrudel, generate, queryEvents } from "./vendor/import.js";
const start = performance.now();
const index = JSON.parse(readFileSync("../../corpus/index.json", "utf8"));
const rows = [];
for (const piece of index) {
  const source = readFileSync("../../corpus/" + piece.file, "utf8");
  const { doc } = importStrudel(source);
  doc.voices.forEach((v) => (v.muted = false));
  const end = Math.min(512, Math.max(16, piece.cycles || 1));
  let r = await queryEvents(generate(doc), 0, end);
  const error = r.error;
  if (error) r = await queryEvents(generate(doc), 0, 1);
  const uses = new Map();
  for (const e of r.events) {
    const v = e.value;
    if (!v || typeof v !== "object") continue;
    const name = String(
      (v.bank ? v.bank + "_" : "") + (v.s ?? "triangle"),
    ).toLowerCase();
    uses.set(JSON.stringify([name, v.n, v.note]), { name, value: v });
  }
  rows.push({
    id: piece.id,
    title: piece.title,
    window: [0, end],
    error,
    uses: [...uses.values()],
  });
}
writeFileSync(
  "sound-audit-input.json",
  JSON.stringify({ durationMs: performance.now() - start, rows }, null, 2) +
    "\n",
);
console.log(
  JSON.stringify({
    pieces: rows.length,
    durationMs: performance.now() - start,
  }),
);
