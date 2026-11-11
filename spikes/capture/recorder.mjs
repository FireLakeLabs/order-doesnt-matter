export const isPattern = x => !!x && x._Pattern === true && typeof x.query === 'function';
export const kindOf = x => isPattern(x) ? 'pattern' : typeof x === 'function' ? 'function' : 'value';
export const errorText = e => `${e?.name || 'Error'}: ${e?.message || e}`;
export class Recorder {
  constructor(meta = [], functions = [], limit = 8) {
    this.sites = new Map(meta.map(s => [s.id, { ...s, kind: 'value', executed: false, receiver: [], args: [], instances: [], totalInstances: 0, flags: {} }]));
    this.functions = new Map(functions.map(f => [f.id, { ...f, construction: 0, query: 0, other: 0, instances: [], totalInstances: 0 }]));
    this.limit = limit; this.known = new WeakMap(); this.objects = new Map(); this.phase = 'construction'; this.frames = []; this.activeSite = []; this.roots = []; this.sequence = 0; this.runtimeCount = 0;
  }
  ref(value) {
    if (value !== null && ['object', 'function'].includes(typeof value)) { const producers = (this.known.get(value) || []).slice(-12); return { kind: kindOf(value), producers, ambiguous: producers.filter(p => p.site).length > 1 }; }
    return { kind: 'value', value: typeof value === 'bigint' ? String(value) : value };
  }
  argsOf(args) { return args.map(arg => Array.isArray(arg) ? { kind: 'array', items: this.argsOf(arg) } : this.ref(arg)); }
  remember(value, ref) {
    if (value !== null && ['object', 'function'].includes(typeof value)) {
      const refs = this.known.get(value) || []; refs.push(ref); this.known.set(value, refs.slice(-12));
    }
  }
  record(id, value, receiver, args = [], error) {
    let site = this.sites.get(id);
    if (!site) { site = { id, span: null, callee: id.slice(8), siteType: 'runtime', kind: 'value', executed: false, receiver: [], args: [], instances: [], totalInstances: 0, flags: {} }; this.sites.set(id, site); }
    site.executed = true; site.totalInstances++;
    const index = site.totalInstances - 1;
    const instance = { index, sequence: this.sequence++, phase: this.phase, queryContext: this.queryContext, kind: error ? 'error' : kindOf(value), receiver: this.ref(receiver), args: this.argsOf(args), callback: this.frames.at(-1)?.id, parentCall: this.activeSite.at(-1) === id ? this.activeSite.at(-2) : this.activeSite.at(-1), flags: {}, ...(error ? { error: errorText(error) } : {}) };
    site.kind = instance.kind;
    if (site.instances.length < this.limit) {
      site.instances.push(instance); site.receiver.push(instance.receiver); site.args.push(instance.args);
      if (isPattern(value)) this.objects.set(`${id}#${index}`, { value, instance, site });
    } else { site.flags.instancesTruncated = true; site.flags.budgetExceeded = true; }
    this.remember(value, { site: id, instance: index });
    return value;
  }
  optionalBase(id, receiver, optionalCall) {
    if (receiver == null) return receiver;
    const rec = this;
    return new Proxy(Object.create(null), { get(_target, key) {
      let fn; try { fn = receiver[key]; } catch(e) { rec.record(id,undefined,receiver,[],e); throw e; }
      return optionalCall && fn == null ? fn : rec.wrap(id,receiver,fn);
    } });
  }
  optionalMember(id, receiver, key) {
    let fn; try { fn = receiver[key]; } catch(e) { this.record(id,undefined,receiver,[],e); throw e; }
    return fn == null ? fn : this.wrap(id,receiver,fn);
  }
  optionalBare(id, fn) { return fn == null ? fn : this.wrap(id,undefined,fn); }
  bare(id, fn) { return this.wrap(id, undefined, fn); }
  member(id, receiver, key) {
    let fn; try { fn = receiver[key]; } catch (e) { this.record(id, undefined, receiver, [], e); throw e; }
    return this.wrap(id, receiver, fn);
  }
  wrap(id, receiver, fn) {
    const rec = this;
    return function (...args) {
      // Snapshot references BEFORE invoking: reused/mutated results can alias.
      const savedReceiver = rec.ref(receiver), savedArgs = rec.argsOf(args);
      rec.activeSite.push(id);
      try {
        const value = Reflect.apply(fn, receiver, args);
        rec.record(id, value, receiver, args);
        const instance = rec.sites.get(id)?.instances.at(-1);
        if (instance && instance.index === rec.sites.get(id).totalInstances - 1) { instance.receiver = savedReceiver; instance.args = savedArgs; }
        return value;
      } catch (e) { rec.record(id, undefined, receiver, args, e); throw e; }
      finally { rec.activeSite.pop(); }
    };
  }
  result(id, value) { return this.record(id, value); }
  root(id, value) { this.record(id, value); this.roots.push({ site: id, ...this.ref(value) }); return value; }
  enter(id, args) {
    const f = this.functions.get(id); if (!f) return;
    f.queryOwners ||= {}; if (this.queryContext) f.queryOwners[this.queryContext.owner] = (f.queryOwners[this.queryContext.owner] || 0) + 1;
    f[this.phase] = (f[this.phase] || 0) + 1; f.totalInstances++;
    const frame = { id, index: f.totalInstances - 1, phase: this.phase, args: this.argsOf(args), parentCall: this.activeSite.at(-1), queryContext: this.queryContext };
    if (f.instances.length < 32) f.instances.push(frame);
    this.frames.push(frame);
    args.forEach((arg, i) => { if (isPattern(arg)) this.remember(arg, { callback: id, invocation: frame.index, parameter: i }); });
  }
  returned(id, value) {
    const frame = this.frames.at(-1); if (frame?.id === id) frame.result = this.ref(value);
    return value;
  }
  exit(id) { if (this.frames.at(-1)?.id === id) this.frames.pop(); }
}
