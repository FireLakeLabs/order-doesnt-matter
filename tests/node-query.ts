import { afterAll } from 'vitest';
import { createNodeQueryPool } from '../src/strudel/evaluate-node';

// One pool per isolated test file; no memoization of assertion inputs/results.
const pool = createNodeQueryPool(2);
afterAll(() => pool.close());
export const queryEventsNode = pool.query;
