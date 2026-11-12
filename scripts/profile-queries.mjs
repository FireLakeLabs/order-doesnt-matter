import { createNodeQueryPool, queryEventsNode } from '../src/strudel/evaluate-node.ts';
const count = 20;
const source = 'note("c3 e3 g3").s("sine")';
const pool = createNodeQueryPool(1);
async function measure(query) {
  const times = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    const result = await query(source, 0, 4);
    if (result.error) throw Error(JSON.stringify(result.error));
    times.push(performance.now() - start);
  }
  return {
    firstMs: times[0],
    warmMedianMs: times.slice(1).sort((a, b) => a - b)[9],
    totalMs: times.reduce((a, b) => a + b, 0),
  };
}
try {
  console.log(
    JSON.stringify(
      { count, fresh: await measure(queryEventsNode), pooled: await measure(pool.query) },
      null,
      2,
    ),
  );
} finally {
  await pool.close();
}
