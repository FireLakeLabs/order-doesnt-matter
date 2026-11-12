import { expect, test } from 'vitest';
import {
  QueryBudget,
  LATE_QUERY_MS,
  HARD_QUERY_MS,
  LATE_WINDOWS,
  PlaybackOverrun,
  PlaybackNotice,
  SLOW_MESSAGE,
} from './playback-limits';

test('one slow query warns once, recovers, and never stops playback', () => {
  const budget = new QueryBudget();
  expect(budget.observe(LATE_QUERY_MS + 1)).toMatchObject({ message: SLOW_MESSAGE });
  expect(budget.observe(1)).toBeUndefined();
  expect(budget.observe(LATE_QUERY_MS + 1)).toBeUndefined();
  expect(budget.observe(1)).toBeUndefined();
});
test('sustained late windows stop with the plain playback message', () => {
  const budget = new QueryBudget();
  expect(budget.observe(LATE_QUERY_MS + 1)).toBeInstanceOf(PlaybackNotice);
  for (let i = 1; i < LATE_WINDOWS - 1; i++)
    expect(budget.observe(LATE_QUERY_MS + 1)).toBeUndefined();
  expect(budget.observe(LATE_QUERY_MS + 1)).toMatchObject({
    message: 'This program is taking too long to answer, so playback was stopped.',
  });
});
test('a single query over the hard limit stops; its exact boundary is allowed', () => {
  expect(new QueryBudget().observe(HARD_QUERY_MS + 1)).toBeInstanceOf(PlaybackOverrun);
  expect(new QueryBudget().observe(HARD_QUERY_MS)).toBeInstanceOf(PlaybackNotice);
});
