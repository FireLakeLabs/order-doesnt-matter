import './style.css';
import { initial, edit, unit, speed, type Piece, type Edit } from './document';
import { generate } from './generate';
import { scene, centers, type Shape, type Event } from './scene';
import { Engine, query } from './engine';
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing app');
app.innerHTML = `<header><a class="brand" href="#">odm<span> / gesture study 01</span></a><div class="transport"><button id="play" disabled>Loading engine…</button><span>120 BPM <b>·</b> 2s / cycle</span><i id="lamp"></i></div></header>
<main><div class="intro"><div class="eyebrow">THE SCORE IS SOMETHING YOU CAN TOUCH</div><h1>Move the music.</h1><p>Turn a voice. Lift a note. Paint its colour.</p></div>
<div class="toolbar" aria-label="Gesture tools"><div class="tools"><button data-tool="turn" class="selected">↻ Turn</button><button data-tool="pitch">↟ Pitch / rest</button><button data-tool="edge">⋮ Split / merge</button><button data-tool="paint">◒ Paint</button><button data-tool="echo">◎ Pull echo</button></div><label><input id="free" type="checkbox"> Free time</label><label><input id="smooth" type="checkbox"> Smooth paint</label><button id="undo" disabled>Undo</button><button id="redo" disabled>Redo</button></div>
<div class="instrument"><svg id="score" viewBox="0 0 1040 580" role="img" aria-label="Two editable musical rings"></svg><div class="voice-labels"><div><span class="voice-title">01 <b>GLASS</b> / melody</span><button data-reverse="melody">Reverse</button><span id="speed-melody">×1</span></div><div><span class="voice-title">02 <b>PULSE</b> / drum</span><button data-reverse="drum">Reverse</button><span id="speed-drum">×1</span></div></div></div>
<div class="hint"><span id="hint">Inner track: turn · note: lift or tap · dot: pull out to split, in to merge · outer bands: paint</span><output id="latency">Ready</output></div>
<div class="legend"><span><i class="mint"></i> notes</span><span><i class="amber"></i> brightness</span><span><i class="blue"></i> gain</span><span>Shift: free time · Alt + pull: echo · wheel / pinch: ×2 or ÷2</span></div>
<details id="drawer"><summary>GENERATED STRUDEL <span>live · read only</span></summary><pre id="source"></pre></details><p id="error" role="alert"></p><footer>App-owned document → fresh Strudel → sound. <span>No samples or network needed after loading.</span></footer></main>`;
function el<T extends HTMLElement>(selector: string): T { const node = document.querySelector<T>(selector); if (!node) throw new Error(`Missing ${selector}`); return node; }
const svg = document.querySelector<SVGSVGElement>('#score'); if (!svg) throw new Error('Missing score');
const score = svg;
const engine = new Engine();
let piece = initial(), events: Event[] = [], code = generate(piece), tool = 'turn', pending = 0, lastError = '';
const undo: Piece[] = [], redo: Piece[] = [];
let shapes: Shape[] = [], ghost: Shape[] = [];
const colors = { melody: '#99f3cf', drum: '#b5b0ff' };
const color = (voice: string) => voice === 'melody' ? colors.melody : colors.drum;
function point(cx: number, cy: number, radius: number, phase: number) { const a = phase * Math.PI * 2 - Math.PI / 2; return { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius }; }
function path(cx: number, cy: number, r: number, begin: number, end: number) {
  const length = Math.min(0.99999, end - begin), gap = Math.min(length * 0.14, 0.006), a = point(cx, cy, r, begin + gap), b = point(cx, cy, r, begin + length - gap);
  return `M${a.x},${a.y} A${r},${r} 0 ${length > .5 ? 1 : 0},1 ${b.x},${b.y}`;
}
function drawArc(s: Shape, old = false) {
  const index = piece.voices.findIndex(v => v.id === s.voice), c = centers[index]; if (!c) return '';
  let stroke = color(s.voice), opacity = 1;
  if (s.role === 'track') { stroke = '#283d3b'; opacity = .95; }
  if (s.role === 'setting') { stroke = s.setting === 'lpf' ? '#f0bd7b' : '#81b4d9'; opacity = .15 + .8 * (s.setting === 'lpf' ? (s.value - 100) / 5900 : s.value); }
  if (s.role === 'ghost') opacity = .38;
  if (s.role === 'rest') opacity = .24;
  if (old) { stroke = '#ffffff'; opacity = .18; }
  const edge = point(c.x, c.y, s.radius, s.end - .006);
  return `<path d="${path(c.x, c.y, s.radius, s.begin, s.end)}" fill="none" stroke="${stroke}" stroke-width="${s.width}" opacity="${opacity}" stroke-linecap="${s.role === 'setting' ? 'butt' : 'round'}" ${s.role === 'rest' || s.role === 'ghost' || old ? 'stroke-dasharray="3 5"' : ''}/>${!old && (s.role === 'note' || s.role === 'rest') ? `<circle cx="${edge.x}" cy="${edge.y}" r="3.5" fill="#effbf2" opacity=".7"/>` : ''}`;
}
function render() {
  shapes = scene(piece, events);
  score.innerHTML = centers.map((c, i) => {
    const v = piece.voices[i]; if (!v) return '';
    const ticks = Array.from({ length: 16 }, (_, n) => { const a = point(c.x, c.y, 206, n / 16), b = point(c.x, c.y, n % 4 ? 210 : 216, n / 16); return `<path d="M${a.x},${a.y}L${b.x},${b.y}" stroke="#39504c"/>`; }).join('');
    return `<circle cx="${c.x}" cy="${c.y}" r="203" fill="none" stroke="#213633"/>${ticks}<text x="${c.x}" y="${c.y - 22}" text-anchor="middle" class="core-label">${i ? 'PULSE' : 'GLASS'}</text><text x="${c.x}" y="${c.y + 4}" text-anchor="middle" class="core-speed">×${speed(v)}</text><text x="${c.x}" y="${c.y + 25}" text-anchor="middle" class="core-label">TURN HERE</text><text x="${c.x + 5}" y="${c.y - 150}" class="lane-label">BRIGHTNESS</text><text x="${c.x + 5}" y="${c.y - 178}" class="lane-label">GAIN</text>`;
  }).join('') + shapes.map(s => drawArc(s)).join('') + ghost.map(s => drawArc(s, true)).join('') + centers.map((c, i) => `<g id="head-${i}" class="playhead"><path d="M${c.x},${c.y - 45}L${c.x},${c.y - 205}" stroke="#fff8d8" stroke-width="1.5"/><circle cx="${c.x}" cy="${c.y - 205}" r="4" fill="#fff8d8"/></g>`).join('');
  for (const v of piece.voices) el(`#speed-${v.id}`).textContent = `×${speed(v)}`;
  el('#source').textContent = code;
  el<HTMLButtonElement>('#undo').disabled = !undo.length; el<HTMLButtonElement>('#redo').disabled = !redo.length;
}
function fail(error: unknown) { lastError = error instanceof Error ? error.message : String(error); el('#error').textContent = lastError; }
async function update(next: Piece, gesture: string, eventAt: number) {
  piece = next; code = generate(piece); const request = ++pending;
  // Render provisional geometry immediately; replace it with real queries after evaluation.
  el('#source').textContent = code;
  try {
    const result = await engine.update(code, gesture, eventAt);
    if (request === pending) { events = result; render(); }
    const sample = engine.samples.at(-1); if (sample) el('#latency').textContent = `${sample.latency.toFixed(1)} ms to swap · audio horizon ~300 ms`;
  } catch (error) { fail(error); }
}
function remember() { undo.push(structuredClone(piece)); redo.length = 0; }
function perform(action: Edit, voice: string, gesture: string, at: number) { return update(edit(piece, voice, action), gesture, at); }
el('#undo').onclick = () => { const previous = undo.pop(); if (previous) { redo.push(piece); update(previous, 'undo', performance.now()).catch(fail); } };
el('#redo').onclick = () => { const next = redo.pop(); if (next) { undo.push(piece); update(next, 'redo', performance.now()).catch(fail); } };
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) button.onclick = () => {
  tool = button.dataset.tool ?? 'turn'; for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('selected', b === button);
  el('#hint').textContent = ({ turn: 'Drag the inner track around its centre. Hold Shift (or Free time) for unsnapped movement.', pitch: 'Drag a note outward to raise pitch, inward to lower. Tap to toggle a rest.', edge: 'Pull an arc’s end dot outward to split. Pull a nested arc’s dot inward to merge.', paint: 'Draw around brightness or gain; distance from the centre sets the value. Smooth paint interpolates.', echo: 'Pull out from the inner track. Angle sets delay; outward distance sets semitones.' } as Record<string, string>)[tool] ?? '';
};
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-reverse]')) button.onclick = () => { remember(); perform({ kind: 'reverse' }, button.dataset.reverse ?? '', 'reverse', performance.now()).catch(fail); };
type Position = { x: number; y: number; radius: number; phase: number; voice: string };
function position(x: number, y: number, voice?: string): Position {
  const rect = score.getBoundingClientRect(); const px = (x - rect.left) / rect.width * 1040, py = (y - rect.top) / rect.height * 580;
  const index = voice ? piece.voices.findIndex(v => v.id === voice) : (px < 520 ? 0 : 1), c = centers[index] ?? centers[0];
  if (!c) throw new Error('Missing centre');
  return { x: px, y: py, radius: Math.hypot(px - c.x, py - c.y), phase: unit(Math.atan2(py - c.y, px - c.x) / (2 * Math.PI) + .25), voice: piece.voices[index]?.id ?? 'melody' };
}
function angular(a: number, b: number) { return ((a - b + 1.5) % 1) - .5; }
function hit(p: Position): Shape | undefined {
  return shapes.filter(s => s.voice === p.voice && ['note', 'rest'].includes(s.role) && Math.abs(p.radius - s.radius) < 13 && unit(p.phase - s.begin) < s.end - s.begin).at(-1);
}
type Drag = { id: number; start: Position; last: Position; totalAngle: number; base: Piece; shape?: Shape; kind: 'turn' | 'pitch' | 'edge' | 'paint' | 'echo'; moved: boolean; setting?: 'lpf' | 'gain'; samples: { phase: number; value: number }[] };
let drag: Drag | undefined;
const pointers = new Map<number, { x: number; y: number }>();
let pinch: { distance: number; voice: string; base: Piece; committed: boolean } | undefined;
function distance() { const [a, b] = [...pointers.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; }
score.addEventListener('pointerdown', e => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); score.setPointerCapture(e.pointerId);
  const p = position(e.clientX, e.clientY);
  if (pointers.size === 2) { pinch = { distance: distance(), voice: drag?.start.voice ?? p.voice, base: drag?.base ?? piece, committed: false }; drag = undefined; ghost = []; return; }
  const s = hit(p), edge = s && Math.abs(angular(p.phase, unit(s.end - .006))) * p.radius * Math.PI * 2 < 12;
  const setting = p.radius > 174 && p.radius < 205 ? 'gain' : p.radius > 143 && p.radius <= 174 ? 'lpf' : undefined;
  const kind = e.altKey || tool === 'echo' ? 'echo' : setting ? 'paint' : s ? (tool === 'edge' || edge ? 'edge' : 'pitch') : 'turn';
  remember(); drag = { id: e.pointerId, start: p, last: p, totalAngle: 0, base: structuredClone(piece), shape: s, kind, moved: false, setting, samples: [] };
  ghost = shapes.filter(s => s.voice === p.voice && s.role !== 'setting' && s.role !== 'track'); render();
});
score.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return; pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size === 2) {
    const ratio = distance() / pinch.distance;
    if (!pinch.committed && (ratio > 1.45 || ratio < .69)) { pinch.committed = true; update(edit(pinch.base, pinch.voice, { kind: 'speed', factor: ratio > 1 ? 2 : .5 }), 'pinch', e.timeStamp).catch(fail); }
    return;
  }
  const d = drag; if (!d || d.id !== e.pointerId) return;
  const p = position(e.clientX, e.clientY, d.start.voice); d.totalAngle += angular(p.phase, d.last.phase); d.last = p;
  d.moved ||= Math.hypot(p.x - d.start.x, p.y - d.start.y) > 4;
  if (!d.moved) return;
  let action: Edit;
  switch (d.kind) {
    case 'turn': { const delta = e.shiftKey || el<HTMLInputElement>('#free').checked ? d.totalAngle : Math.round(d.totalAngle * 16) / 16; action = { kind: 'shift', cycles: delta }; break; }
    case 'pitch': if (!d.shape) return; action = { kind: 'pitch', path: d.shape.path, semitones: (p.radius - d.start.radius) / 5 }; break;
    case 'edge': if (!d.shape) return; action = { kind: p.radius < d.start.radius - 8 ? 'merge' : 'split', path: d.shape.path }; break;
    case 'echo': action = { kind: 'echo', delay: unit(p.phase - d.start.phase), semitones: (p.radius - d.start.radius) / 6 }; break;
    case 'paint': {
      if (!d.setting) return;
      // Fill between pointer samples so a fast sweep leaves no holes.
      const previous = d.samples.at(-1)?.phase ?? d.start.phase;
      const delta = angular(p.phase, previous), n = Math.max(1, Math.ceil(Math.abs(delta) * 64));
      const base = d.setting === 'lpf' ? 160 : 188;
      for (let i = 1; i <= n; i++) d.samples.push({ phase: unit(previous + delta * i / n), value: d.setting === 'lpf' ? 100 + 5900 * clamp01((p.radius - base + 13) / 26) : clamp01((p.radius - base + 13) / 26) });
      action = { kind: 'paint', setting: d.setting, mode: el<HTMLInputElement>('#smooth').checked ? 'curve' : 'steps', samples: d.samples }; break;
    }
  }
  update(edit(d.base, d.start.voice, action), d.kind, e.timeStamp).catch(fail);
});
function clamp01(n: number) { return Math.min(1, Math.max(0, n)); }
function finish(e: PointerEvent) {
  pointers.delete(e.pointerId);
  if (pinch) { if (!pointers.size) pinch = undefined; return; }
  const d = drag; if (!d || d.id !== e.pointerId) return;
  if (!d.moved && d.shape && d.kind !== 'echo') update(edit(d.base, d.start.voice, { kind: 'toggle', path: d.shape.path }), 'tap', e.timeStamp).catch(fail);
  drag = undefined; ghost = []; render();
}
score.addEventListener('pointerup', finish);
score.addEventListener('pointercancel', e => { const d = drag; if (d) update(d.base, 'cancel', e.timeStamp).catch(fail); pointers.clear(); drag = undefined; pinch = undefined; ghost = []; });
let wheelAt = -Infinity;
score.addEventListener('wheel', e => { e.preventDefault(); if (performance.now() - wheelAt < 220) return; wheelAt = performance.now(); const p = position(e.clientX, e.clientY); const v = piece.voices.find(v => v.id === p.voice); if (!v) return; const next = speed(v) * (e.deltaY < 0 ? 2 : .5); if (next < .25 || next > 4) return; remember(); perform({ kind: 'speed', factor: e.deltaY < 0 ? 2 : .5 }, p.voice, 'wheel', e.timeStamp).catch(fail); }, { passive: false });
el('#play').onclick = async () => {
  try { if (engine.playing) { engine.stop(); el('#play').textContent = '▶ Play'; } else { await engine.play(code); el('#play').textContent = '■ Stop'; } el('#lamp').classList.toggle('on', engine.playing); } catch (error) { fail(error); }
};
function animate() {
  const phase = unit(engine.phase());
  centers.forEach((c, i) => score.querySelector(`#head-${i}`)?.setAttribute('transform', `rotate(${phase * 360} ${c.x} ${c.y})`));
  requestAnimationFrame(animate);
}
const debug = {
  get document() { return structuredClone(piece); }, get code() { return code; }, get events() { return events; }, get shapes() { return shapes; }, get error() { return lastError; },
  engine, get pending() { return pending; },
  async reset() { engine.stop(); undo.length = 0; redo.length = 0; ghost = []; await update(initial(), 'reset', performance.now()); el('#play').textContent = '▶ Play'; },
  async replace(p: Piece) { await update(p, 'replace', performance.now()); },
  queryRange(a: number, b: number) { const pattern = (engine.repl as unknown as { state: { pattern: Parameters<typeof query>[0] } })?.state.pattern; return pattern?.queryArc(a, b).filter(h => h.hasOnset()).map(h => ({ begin: Number(h.whole.begin), voice: h.value.voice, ghost: h.value.ghost })); },
};
Object.assign(window, { gesture: debug });
render(); requestAnimationFrame(animate);
engine.init().then(async () => { await update(piece, 'initial', performance.now()); el<HTMLButtonElement>('#play').disabled = false; el('#play').textContent = '▶ Play'; }).catch(fail);
