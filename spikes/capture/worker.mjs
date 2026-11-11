import './node-setup.mjs';
import { parentPort, workerData } from 'node:worker_threads';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { compile } from './instrument.mjs';
import { Recorder, isPattern, errorText } from './recorder.mjs';
import { createHost, wrapPrototype, core } from './host.mjs';
const { source, queryTimeout = 80, stationBudget = 1200, eventBudget = 50000 } = workerData;
let opaqueFunction = false;
const normalize = (value, seen = new Set()) => {
  if (typeof value === 'function') { opaqueFunction = true; return '[function]'; }
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'number' && !Number.isFinite(value)) return `[${value}]`;
  if (value === undefined) return '[undefined]';
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]'; seen.add(value);
  const result = Array.isArray(value) ? value.map(x => normalize(x, seen)) : Object.fromEntries(Object.keys(value).sort().map(k => [k, normalize(value[k], seen)]));
  seen.delete(value); return result;
};
function hap(h) {
  return { whole: h.whole ? [h.whole.begin.toString(), h.whole.end.toString()] : null, part: [h.part.begin.toString(), h.part.end.toString()], value: normalize(h.value), context: normalize(h.context), stateful: h.stateful };
}
function query(pattern, ctx, rec, owner, remaining) {
  const result = { cycles: [], flags: {}, ms: 0 };
  if (!isPattern(pattern)) return { ...result, notPattern: true };
  const start = performance.now(); rec.phase = 'query';
  for (let cycle = 0; cycle <= 8; cycle++) {
    if (remaining.value <= 0) { result.flags.budgetExceeded = true; break; }
    ctx.__target = pattern; ctx.__state = new core.State(new core.TimeSpan(cycle, cycle + 1), { _cps: ctx.__cps ?? 0.5 });
    rec.queryContext = { owner, cycle };
    const t = performance.now();
    try {
      const events = vm.runInContext('__target.query(__state)', ctx, { timeout: queryTimeout });
      remaining.value -= events.length;
      if (events.some(e => !e.whole)) result.flags.hasContinuous = true;
      if (events.some(e => e.whole && (e.part.begin.compare(e.whole.begin) !== 0 || e.part.end.compare(e.whole.end) !== 0))) result.flags.hasFragments = true;
      const truncated = events.length > 4096 || remaining.value < 0;
      if (truncated) result.flags.budgetExceeded = true;
      opaqueFunction = false;
      const normalized = events.slice(0, truncated ? 128 : 4096).map(hap);
      if (opaqueFunction) result.flags.opaqueFunctions = true;
      const eventDigest = createHash('sha256').update(JSON.stringify(normalized.map(e=>JSON.stringify(e)).sort())).digest('hex');
      result.cycles.push({ cycle, count: events.length, ms: performance.now() - t, eventDigest, events: normalized.slice(0,64), eventsSampled: normalized.length > 64, truncated });
      if (truncated) break;
    } catch (e) {
      const error = errorText(e); result.flags.queryError = error;
      if (e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') result.flags.budgetExceeded = true;
      result.cycles.push({ cycle, error, ms: performance.now() - t });
      // Query failures are distinct from an empty successful result.
      break;
    } finally { rec.frames = []; rec.activeSite = []; }
  }
  result.ms = performance.now() - start; rec.phase = 'other'; rec.queryContext = undefined;
  return result;
}
async function evaluate(compiled, mode, benchmark = false) {
  const rec = new Recorder(mode === 'ast' ? compiled.sites : [], mode === 'ast' ? compiled.functions : [], mode === 'runtime' ? 2 : 8);
  const env = createHost(rec); env.host[compiled.captureName] = rec;
  const ctx = vm.createContext(env.host);
  const proto = mode === 'runtime' ? wrapPrototype(rec) : null;
  if (proto) { const register = ctx.register; ctx.register = (...args) => { const r = register(...args); proto.refresh(); return r; }; }
  const start = performance.now(); let value, evalError;
  try { value = await vm.runInContext(`(async()=>{${compiled.code}\n})()`, ctx, { timeout: 400 }); }
  catch (e) { evalError = errorText(e); }
  const evalMs = performance.now() - start;
  // all() is part of root assembly and can itself execute user callbacks.
  let final;
  try { ctx.__result = value; ctx.__finish = x => env.final(x); final = vm.runInContext('__finish(__result)', ctx, { timeout: 400 }); }
  catch (e) { evalError = errorText(e); }
  ctx.__cps = env.cps;
  if (benchmark) { proto?.restore(); env.restore(); return evalMs; }
  const finalEvents = query(final, ctx, rec, 'final-before-stations', { value: eventBudget });
  const baselineInstances = [...rec.sites.values()].reduce((s,x) => s+x.totalInstances, 0);
  const remaining = { value: eventBudget }, queried = new Set();
  const queryStart = performance.now();
  if (mode !== 'baseline') {
    while (true) {
      const item = [...rec.objects.entries()].find(([key]) => !queried.has(key));
      if (!item) break;
      const [key, { value: pattern, instance, site }] = item; queried.add(key);
      if (performance.now() - queryStart > stationBudget || remaining.value <= 0 || queried.size > 1000) {
        instance.flags.budgetExceeded = true; site.flags.budgetExceeded = true; continue;
      }
      const answer = query(pattern, ctx, rec, key, remaining);
      instance.eventsPerCycle = answer.cycles; instance.queryMs = answer.ms;
      Object.assign(instance.flags, answer.flags); Object.assign(site.flags, answer.flags);
    }
  }
  const stationsMs = performance.now() - queryStart;
  const finalAfter = mode === 'baseline' ? null : query(final, ctx, rec, 'final-after-stations', { value: eventBudget });
  if (mode !== 'baseline') for (const [key,entry] of rec.objects) if (!queried.has(key)) { entry.instance.flags.budgetExceeded = true; entry.instance.flags.notQueried = 'created during final verification'; entry.site.flags.budgetExceeded = true; }
  // Distinct identity and distinct score are different; retain both observations.
  for (const site of rec.sites.values()) {
    const objects = [...rec.objects.entries()].filter(([key]) => key.startsWith(site.id + '#')).map(([, v]) => v.value);
    site.distinctPatternIdentities = new Set(objects).size;
    site.distinctObservedScores = new Set(site.instances.filter(i => i.eventsPerCycle).map(i => JSON.stringify(i.eventsPerCycle.map(c => ({ cycle:c.cycle, error:c.error, events:c.events }))))).size;
    site.eventsPerCycle = site.instances[0]?.eventsPerCycle || [];
  }
  rec.roots.push({ kind: isPattern(final) ? 'pattern' : typeof final, role: 'assembled-final', ...rec.ref(final) });
  const result = { mode, compileMs: compiled.compileMs, evalMs, evalError, finalEvents, finalAfter, sites: [...rec.sites.values()], callbacks: [...rec.functions.values()], roots: rec.roots, stubs: env.stubs, warnings: compiled.warnings, miniLocations: compiled.miniLocations, widgets: compiled.widgets, stationsMs, stationInstancesQueried: queried.size, stationEvents: eventBudget - remaining.value, baselineInstances, totalInstances: [...rec.sites.values()].reduce((s,x) => s+x.totalInstances,0), runtimeCount: rec.runtimeCount };
  proto?.restore(); env.restore(); return result;
}
function signature(result) {
  if (!result) return null;
  return JSON.stringify({ notPattern: result.notPattern, flags: result.flags, cycles: result.cycles.map(c => ({ cycle: c.cycle, error: c.error?.replace(/after \d+ms/, 'after TIMEOUT'), count: c.count, eventDigest: c.eventDigest, truncated:c.truncated })) });
}
try {
  const baseCode = compile(source, 'baseline'), astCode = compile(source, 'ast');
  // A few paired warmed repetitions; includes recorder allocation/work, excludes parsing.
  const timings = { baseline: [], ast: [], runtime: [] };
  for (const mode of ['baseline','ast','runtime']) await evaluate(mode === 'ast' ? astCode : baseCode, mode, true);
  for (let round = 0; round < 5; round++) for (const mode of (round % 2 ? ['runtime','ast','baseline'] : ['baseline','ast','runtime'])) timings[mode].push(await evaluate(mode === 'ast' ? astCode : baseCode, mode, true));
  parentPort.postMessage({ checkpoint: 'evaluated' });
  const baseline = await evaluate(baseCode, 'baseline');
  const ast = await evaluate(astCode, 'ast');
  const runtime = await evaluate(baseCode, 'runtime');
  const comparable = r => !r.evalError && !r.finalEvents.notPattern && !r.finalEvents.flags.queryError && !r.finalEvents.flags.budgetExceeded && r.finalEvents.cycles.length === 9;
  parentPort.postMessage({ baseline, ast, runtime, timings, comparison: {
    astEqualsBaseline: signature(ast.finalEvents) === signature(baseline.finalEvents) && ast.evalError === baseline.evalError,
    runtimeEqualsBaseline: signature(runtime.finalEvents) === signature(baseline.finalEvents) && runtime.evalError === baseline.evalError,
    astUnaffectedByStationQueries: signature(ast.finalEvents) === signature(ast.finalAfter),
    runtimeUnaffectedByStationQueries: signature(runtime.finalEvents) === signature(runtime.finalAfter),
    fullyChecked: comparable(baseline) && comparable(ast) && comparable(runtime),
    functionBehaviorUnchecked: !!(baseline.finalEvents.flags.opaqueFunctions || ast.finalEvents.flags.opaqueFunctions || runtime.finalEvents.flags.opaqueFunctions),
  } });
} catch (e) { parentPort.postMessage({ fatal: errorText(e), stack: e.stack }); }
