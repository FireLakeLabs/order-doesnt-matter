import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { Pattern, pure } from '@strudel/core';
import { boundedSource, ExecutionBudget, ExecutionLimit } from './execution-budget';
import { transpile } from './index';
import { guarded } from './audio-pattern';
import { HARD_QUERY_MS, PlaybackOverrun } from '../engine/playback-limits';
import { queryEvents } from './evaluate';

const binding = '__odmTestExecution';
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
async function evaluate(source: string, budget: ExecutionBudget, raw = false) {
  Object.assign(globalThis, { [binding]: budget });
  budget.begin();
  try {
    const instrumented = boundedSource(
      raw ? `const result=(async()=>{${source}})();` : source,
      binding,
    );
    const result = await new AsyncFunction(
      raw ? `${instrumented}; return result;` : transpile(instrumented),
    )();
    budget.check();
    return result;
  } finally {
    budget.end();
    Reflect.deleteProperty(globalThis, binding);
  }
}

test.each([
  'while(true){}',
  'for(;;);',
  'do {} while(true);',
  'for(const x of { [Symbol.iterator]: function*(){ while(true) yield 1; } }) {}',
  'function recurse(){try {recurse()} catch {recurse()}} recurse();',
  'try {while(true){}} catch {}',
  'try {while(true){}} finally {while(true){}}',
  'while(true) try {throw 1} catch {}',
])('injected checks interrupt authored control flow: %s', async (source) => {
  let clock = 0;
  await expect(
    evaluate(`${source}; 42`, new ExecutionBudget(() => clock++)),
  ).rejects.toBeInstanceOf(ExecutionLimit);
});

test('blocks, labels, continue, concise arrows, getters, generators and directives keep semantics', async () => {
  const source = `
    let n=0;
    outer: for(let i=0;i<4;i++) { for(let j=0;j<2;j++) { n++; continue outer; } }
    const object={ get x(){return n}, method(){'use strict'; return this.x} };
    function* count(){ yield object.method(); }
    const f=x=>({n:x});
    return f([...count()][0]).n;
  `;
  expect(await evaluate(source, new ExecutionBudget(), true)).toBe(4);
});

test('await resumes a fresh synchronous segment without changing the awaited value', async () => {
  let clock = 0;
  Object.assign(globalThis, {
    __odmLater: (callback: (value: number) => void) =>
      setTimeout(() => {
        clock += HARD_QUERY_MS * 3;
        callback(42);
      }, 0),
  });
  try {
    expect(
      await evaluate(
        'const n=await new Promise(resolve=>__odmLater(value=>resolve(value))); n',
        new ExecutionBudget(() => clock),
      ),
    ).toBe(42);
  } finally {
    Reflect.deleteProperty(globalThis, '__odmLater');
  }
});

test('immediately resolved awaits cannot continually renew the execution deadline', async () => {
  let clock = 0;
  await expect(
    evaluate('for(let i=0;i<10000;i++){await 0;} 42', new ExecutionBudget(() => clock++)),
  ).rejects.toBeInstanceOf(ExecutionLimit);
});

test.each([
  'eval("42")',
  'new Function("return 42")()',
  'await import("x")',
  "evaluate('while(true){}')",
  '(()=>{}).constructor("while(true){}")()',
  "globalThis['eval']('while(true){}')",
])('known dynamic code is refused without losing its source: %s', (source) =>
  expect(() => boundedSource(source, binding)).toThrow('Dynamic code is unsupported'),
);

test('the query boundary latches a swallowed limit, stops once and never acknowledges fake silence', async () => {
  let clock = 0;
  const budget = new ExecutionBudget(() => clock++);
  const callback = await evaluate(
    '(state) => { if(state.late) { try {while(true){}} catch {} } return []; }',
    budget,
  );
  const failed = vi.fn(),
    silent = vi.fn(),
    tag = vi.fn();
  const p = guarded(new Pattern(() => callback({ late: true })), failed, tag, silent, budget);
  expect(p.queryArc(17, 18)).toEqual([]);
  expect(p.queryArc(18, 19)).toEqual([]);
  expect(failed).toHaveBeenCalledExactlyOnceWith(expect.any(PlaybackOverrun));
  expect(silent).not.toHaveBeenCalled();
  expect(tag).not.toHaveBeenCalled();
  expect(guarded(pure('healthy'), failed, tag).queryArc(0, 1)).toHaveLength(1);
});

test('all 85 original corpus programs retain event/tempo/error semantics with instrumentation', async () => {
  const index: { file: string; cycles: number }[] = JSON.parse(
    readFileSync('corpus/index.json', 'utf8'),
  );
  expect(index).toHaveLength(85);
  for (const entry of index) {
    const source = readFileSync(`corpus/${entry.file}`, 'utf8');
    const end = Math.max(entry.cycles + 1, 17);
    const reference = await queryEvents(source, 0, end);
    const budget = new ExecutionBudget();
    Object.assign(globalThis, { [binding]: budget });
    budget.begin();
    try {
      const actual = await queryEvents(boundedSource(source, binding), 0, end);
      budget.check();
      expect(actual, entry.file).toEqual(reference);
    } finally {
      budget.end();
      Reflect.deleteProperty(globalThis, binding);
    }
  }
});
