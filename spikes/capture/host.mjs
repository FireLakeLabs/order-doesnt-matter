import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
export { core };
export function createHost(recorder) {
  mini.miniAllStrings();
  const labels = new Map(), effects = [], stubs = [], restorers = [];
  const allTransforms = []; let cps = 0.5, anonymousIndex = 0;
  const host = { ...core, ...mini, ...tonal, console: { log() {}, warn() {}, error() {} }, __capture: recorder };
  const stub = (name, result) => (...args) => { stubs.push({ name, args: args.map(x => typeof x === 'string' || typeof x === 'number' ? x : typeof x) }); return result; };
  Object.assign(host, {
    samples: stub('samples', Promise.resolve()), setcps: x => { cps = core.isPattern(x) ? x.__pure : x; stubs.push({ name: 'setcps', value: cps }); return core.silence; },
    setcpm: x => { cps = (core.isPattern(x) ? x.__pure : x) / 60; stubs.push({ name: 'setcpm', value: x }); return core.silence; }, setbpm: stub('setbpm'), hush: () => { stubs.push({ name: 'hush' }); return core.silence; },
    all: f => { allTransforms.push(f); return core.silence; }, sliderWithID: (_id, x) => x, slider: x => x,
    register: (...args) => { const result = core.register(...args); Object.assign(host, core.strudelScope); return result; },
  });
  // Node models REPL label routing and all(), not audio scheduling.
  function method(name, fn) {
    const descriptor = Object.getOwnPropertyDescriptor(core.Pattern.prototype, name);
    Object.defineProperty(core.Pattern.prototype, name, { configurable: true, writable: true, value: fn });
    restorers.push(() => descriptor ? Object.defineProperty(core.Pattern.prototype, name, descriptor) : delete core.Pattern.prototype[name]);
  }
  method('p', function (name) {
    if (typeof name === 'string' && (name.startsWith('_') || name.endsWith('_'))) return core.silence;
    if (name.includes('$')) name = `${name}${anonymousIndex++}`;
    labels.set(name, this); return this;
  });
  for (const name of ['scope', 'pianoroll', 'punchcard', 'spiral', 'spectrum', 'osc', 'midi', 'midin', 'out', 'output', 'draw', 'analyze']) {
    method(name, function (...args) { stubs.push({ name, args: args.length }); return this; });
    host[name] = stub(name);
  }
  // onTrigger/log attach callbacks in core. Querying does not invoke a scheduler.
  return { host, labels, stubs, get cps() { return cps; }, final(result) { let pattern = labels.size ? core.stack(...labels.values()) : result; if (core.isPattern(pattern)) for (const transform of allTransforms) pattern = transform(pattern); return pattern; }, restore() { restorers.reverse().forEach(f => f()); } };
}
export function wrapPrototype(recorder) {
  const originals = new Map();
  function refresh() {
    for (const name of Object.getOwnPropertyNames(core.Pattern.prototype)) {
      if (name === 'constructor') continue;
      const d = Object.getOwnPropertyDescriptor(core.Pattern.prototype, name);
      if (typeof d.value !== 'function' || d.value._captureWrapped) continue;
      if (!originals.has(name)) originals.set(name, d);
      const value = function (...args) { recorder.runtimeCount++; return recorder.wrap('runtime:' + name, this, d.value)(...args); };
      value._captureWrapped = true;
      Object.defineProperty(core.Pattern.prototype, name, { ...d, value });
    }
  }
  refresh();
  return { refresh, restore() { for (const [name, d] of originals) Object.defineProperty(core.Pattern.prototype, name, d); } };
}
