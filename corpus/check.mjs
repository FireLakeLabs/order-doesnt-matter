import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFile, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { performance } from 'node:perf_hooks';
const root = new URL('./', import.meta.url);
if (isMainThread) {
  const entries = JSON.parse(await readFile(new URL('index.json', root)));
  const reports = [];
  for (const entry of entries) {
    const start = performance.now();
    const report = await new Promise(resolve => {
      const worker = new Worker(new URL(import.meta.url), { workerData: entry });
      let settled = false;
      const finish = result => { if (settled) return; settled = true; clearTimeout(timer); worker.terminate(); resolve(result); };
      const timer = setTimeout(() => finish({ evaluated: false, error: 'Per-program 5000ms budget exceeded', phase: 'timeout' }), 5000);
      worker.once('message', finish);
      worker.once('error', e => finish({ evaluated: false, error: e.message, phase: 'worker' }));
      worker.once('exit', code => { if (!settled) finish({ evaluated: false, error: `Worker exited ${code}`, phase: 'worker' }); });
    });
    reports.push({ id: entry.id, ...report, elapsedMs: Math.round(performance.now() - start) });
  }
  await writeFile(new URL('check-report.json', root), JSON.stringify(reports, null, 2) + '\n');
  const failures = reports.filter(r => !r.evaluated);
  const expectedErrors = { 'micro-query-throws': 'corpus intentional query failure', 'micro-query-late-throws': 'corpus intentional late failure' };
  const unexpected = failures.filter(r => r.phase !== 'query' || r.error !== expectedErrors[r.id]);
  const missingFailures = reports.filter(r => r.evaluated && expectedErrors[r.id]);
  console.log(JSON.stringify({ total: reports.length, ok: reports.length-failures.length, intendedFailures: failures.length-unexpected.length, unexpectedFailures: unexpected, missingIntendedFailures: missingFailures }, null, 2));
  if (unexpected.length || missingFailures.length) process.exitCode = 1;
} else {
  let phase = 'evaluation';
  let patterns = [], eventsPerCycle = [], lacksWhole = false, fragments = false, maxSimultaneousEvents = 0;
  try {
    registerHooks({ resolve(specifier, context, next) {
      if (specifier === '@kabelsalat/web') return { url: 'data:text/javascript,export class SalatRepl {}', shortCircuit: true };
      return next(specifier, context);
    }});
    const core = await import('@strudel/core');
    const mini = await import('@strudel/mini');
    const tonal = await import('@strudel/tonal');
    const { transpiler } = await import('@strudel/transpiler');
    await core.evalScope(core, mini, tonal);
    mini.miniAllStrings();
    let transform = p => p;
    globalThis.all = fn => { transform = fn; };
    for (const name of ['samples', 'setcpm', 'setcps', 'hush']) globalThis[name] = () => undefined;
    core.Pattern.prototype.p = function(id) { if (!id.startsWith('_') && !id.endsWith('_')) patterns.push(this); return this; };
    for (const name of ['pianoroll', 'scope', 'spectrum', 'osc', 'midi', 'log']) core.Pattern.prototype[name] = function() { return this; };
    const source = await readFile(new URL(workerData.file, root), 'utf8');
    const { pattern } = await core.evaluate(source, transpiler);
    if (!patterns.length && core.isPattern(pattern)) patterns.push(pattern);
    const numberOfPatterns = patterns.length;
    patterns = [transform(core.stack(...patterns))];
    phase = 'query';
    for (let cycle = 0; cycle <= 8; cycle++) {
      // queryArc swallows errors; direct query preserves them for acceptance reporting.
      const events = patterns.flatMap(p => p.query(new core.State(new core.TimeSpan(cycle, cycle+1), { _cps: 0.5 })));
      eventsPerCycle.push(events.length);
      const boundaries = [];
      for (const e of events) {
        lacksWhole ||= !e.whole;
        fragments ||= !!e.whole && (!e.part.begin.equals(e.whole.begin) || !e.part.end.equals(e.whole.end));
        boundaries.push([Number(e.part.begin), 1], [Number(e.part.end), -1]);
      }
      boundaries.sort((a,b) => a[0]-b[0] || a[1]-b[1]);
      let active = 0;
      for (const [, delta] of boundaries) { active += delta; maxSimultaneousEvents = Math.max(maxSimultaneousEvents, active); }
    }
    parentPort.postMessage({ evaluated: true, error: null, numberOfPatterns, eventsPerCycle, lacksWhole, fragments, maxSimultaneousEvents });
  } catch(e) {
    parentPort.postMessage({ evaluated: false, error: e.message, phase, numberOfPatterns: patterns.length, eventsPerCycle, lacksWhole, fragments, maxSimultaneousEvents });
  }
}
