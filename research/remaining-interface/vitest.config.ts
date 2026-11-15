import { defineConfig } from 'vitest/config';
import baseline from '../../vitest.config';
export default defineConfig({
  test: { ...baseline.test, include: ['research/remaining-interface/source-evidence.test.ts'] },
});
