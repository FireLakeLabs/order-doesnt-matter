import "./style.css";
import corpusIndex from "../../../corpus/index.json";
import * as core from "@strudel/core";
import { fixtures, shell } from "./fixtures";
import {
  History,
  targets,
  update,
  addVoice,
  addSetting,
  addShell,
  changeStep,
  moveShell,
  makeDriver,
  toggleMute,
  ownerId,
  paintSequence,
  type Doc,
  type Pattern,
  type Step,
  type Target,
} from "./document";
import {
  generate,
  queryEvents,
  importStrudel,
  type PlainEvent,
} from "./adapter";
import { patternSource, sourceUntil } from "./fallback";
import {
  constellation,
  sheet,
  rooms,
  settings,
  searchTargets,
  colors,
  span,
  valueAt,
  settingName,
  type EventMap,
} from "./scene";
import { controlInfo } from "./controls";
import { eventLanes, shortValue, staticValue } from "./miniature";
import { song, currentSection, instrumentEvents } from "./song";
import { Engine } from "./engine";
import { tagVoices, atBoundary, driverDocument } from "./query-document";
const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw Error("No app root");
const corpusSources = import.meta.glob("../../../corpus/programs/*.strudel", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const corpusDocs = Object.entries(corpusSources).map(([file, source]) => ({
  id: file.split("/").at(-1)!.replace(".strudel", ""),
  source,
  title:
    corpusIndex.find((e) => e.file.endsWith(file.split("/").at(-1) ?? ""))
      ?.title ?? file.split("/").at(-1),
  ...importStrudel(source),
}));
const history = new History(
  structuredClone(
    corpusDocs.find((f) => f.id === "real-house")?.doc ?? fixtures[0]!.doc,
  ),
);
const engine = new Engine();
let map: "constellation" | "sheet" = "sheet",
  selected = "",
  open = false,
  events: EventMap = {},
  errors: Record<string, string> = {},
  cycle = 0,
  phase = 0,
  piece = "real-house",
  query = "",
  collapsed = new Set<string>(),
  solo = "",
  zoom = Math.min(
    1,
    (window.innerWidth - (window.innerWidth > 650 ? 240 : 0)) /
      (window.innerWidth <= 650 ? 420 : 1260),
  ),
  pan = { x: 0, y: 0 },
  editPath: number[] = [0],
  before: PlainEvent[] = [],
  after: PlainEvent[] = [],
  previewEvents: PlainEvent[] = [],
  busy = false,
  serial = 0,
  mode = "now",
  warning = "",
  paste = false,
  adding: "" | "setting" | "shell" = "",
  addQuery = "",
  revision = 0,
  queued: Doc | undefined;
let rowOrder: string[] = [];
let moreColumns = false;
let sampledDrivers: EventMap = {};
let driverErrors: Record<string, string> = {};
let gestureActive = false;
let pending:
  | { id: string; revision: number; first: number; queued: boolean }
  | undefined;
const changeLog: { revision: number; state: string; cycle: number }[] = [];
const esc = (x: unknown) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
const doc = () => history.doc;
const selectedTarget = () => targets(doc()).find((t) => t.id === selected);
const target = (id: string) => targets(doc()).find((t) => t.id === id);
const button = (text: string, action: string, extra = "") =>
  `<button data-action="${action}" ${extra}>${text}</button>`;
function lane(es: PlainEvent[], name = "", height = 32) {
  const { keys, parts } = eventLanes(es, name),
    signal = name === "value";
  const numeric = parts.map((p) => Number(p.value)).filter(Number.isFinite),
    lo = Math.min(...numeric),
    hi = Math.max(...numeric);
  const pitched = !name || name === "s" || name === "note" || name === "n";
  const curve = signal
    ? parts
        .map((p) => {
          const x = (p.event.part[0] - cycle) * 300,
            y =
              height -
              4 -
              ((Number(p.value) - lo) / (hi - lo || 1)) * (height - 8);
          return `${x},${y}`;
        })
        .join(" ")
    : "";
  return `<svg class="lane" style="height:${height}px" viewBox="0 0 300 ${height}" preserveAspectRatio="none" role="img" aria-label="Real queried ${esc(name || "pitch / sound")} spans: ${esc(keys.slice(0, 12).join(", "))}, cycle ${cycle}"><path d="M0 ${height - 2}H300" class="axis"/>${
    signal
      ? `<polyline points="${curve}" fill="none" stroke="#c3b0f1" stroke-width="2"/>`
      : parts
          .slice(0, 400)
          .map(({ event: e, value, track }) => {
            const [a, b] = span(e, cycle),
              count = Math.min(keys.length || 1, 8),
              band = (height - 6) / count;
            const y = pitched
              ? 3 + (track % 8) * band
              : height -
                4 -
                (Number.isFinite(Number(value))
                  ? 5 + ((Number(value) - lo) / (hi - lo || 1)) * (height - 10)
                  : height - 8);
            const h = pitched ? Math.max(2, band - 1) : height - y - 3;
            return `<rect x="${a * 300}" y="${y}" width="${Math.max(0.7, (b - a) * 300 - 1)}" height="${h}" rx="1" fill="${colors[track % 4]}" opacity=".85"><title>${esc(value)} · ${e.part[0]}–${e.part[1]}</title></rect>`;
          })
          .join("")
  }<path class="playline" d="M${(phase % 1) * 300} 0V${height}"/></svg>`;
}
function ring(es: PlainEvent[], size = 92) {
  const p = (a: number, r: number) =>
    `${(50 + Math.cos(a * Math.PI * 2 - Math.PI / 2) * r).toFixed(3)} ${(50 + Math.sin(a * Math.PI * 2 - Math.PI / 2) * r).toFixed(3)}`;
  return `<svg class="ring" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="Read-only voice cycle"><circle cx="50" cy="50" r="39" fill="none" stroke="#304450"/>${es
    .slice(0, 300)
    .map((e, i) => {
      let [a, b] = span(e, cycle);
      b = Math.min(b, a + 0.9999);
      return `<path d="M${p(a, 34 - (i % 3) * 4)} A${34 - (i % 3) * 4} ${34 - (i % 3) * 4} 0 ${b - a > 0.5 ? 1 : 0} 1 ${p(b, 34 - (i % 3) * 4)}" fill="none" stroke="${colors[i % 4]}" stroke-width="3"/>`;
    })
    .join(
      "",
    )}<path class="ringhead" d="M50 50L${p(phase % 1, 41)}" stroke="#e7fff5" stroke-width="1"/><text x="50" y="51" text-anchor="middle" fill="#94abae" font-size="10">${cycle}</text></svg>`;
}
function chosen(id: string) {
  const t = selectedTarget();
  return selected === id ||
    (t &&
      !t.setting &&
      (id === t.voice.id || id === t.voice.pattern.id || id === t.parent?.id))
    ? " selected"
    : "";
}
function sourceNodes() {
  return `<div class="source-nodes">${doc()
    .setup.map((x, i) =>
      button(
        `◇ ${esc(x.code.match(/register\(\s*[\'"]([^\'"]+)/)?.[1] ?? `Setup ${i + 1}`)} · source`,
        "select",
        `data-id="${x.id}"`,
      ),
    )
    .join("")}${Object.entries(doc().shared)
    .map(([name, p]) =>
      button(`↳ ${esc(name)} · shared`, "select", `data-id="${p.id}"`),
    )
    .join("")}${
    doc()
      .transforms?.map((x) =>
        button(`all · global rewrite`, "select", `data-id="${x.id}"`),
      )
      .join("") ?? ""
  }</div>`;
}
function arrangementHtml() {
  const structure = song(doc()),
    section = currentSection(structure.sections, cycle, structure.total);
  if (!structure.sections.length)
    return `<div class="arrangement loop-strip"><span>↻ Repeating score</span><small>Viewing cycle ${cycle} · select a rhythm or setting to edit</small>${button("Previous cycle", "cycle-prev")}${button("Next cycle", "cycle-next")}</div>`;
  return `<nav class="arrangement" aria-label="Song arrangement"><div class="arrangement-caption"><strong>SONG · ${structure.total} cycles</strong><span>Click a section to explore · ${section ? esc(section.name) : ""} now</span></div><div class="sections">${structure.sections.map((x) => button(`<span>${esc(x.name)}</span><small>${x.cycles} cycles · ${x.start}–${x.start + x.cycles}</small>`, "jump-section", `data-id="${x.index}" style="flex:${x.cycles}" aria-current="${x.index === section?.index ? "step" : "false"}" title="${esc(x.comment ?? x.name)} · jump to cycle ${x.start}"`)).join("")}</div></nav>`;
}
function sectionUses(i: ReturnType<typeof song>["instruments"][number]) {
  const s = song(doc());
  const sections = i.sections.filter((n) => n >= 0);
  return sections.length
    ? `<span class="shared-mark" title="${esc(sections.map((n) => (s.sections[n]?.name ?? "") + " @ " + s.sections[n]?.start).join(" · "))} · editing the shared instrument changes every occurrence">${sections.length > 1 ? "↳ Shared · " + sections.length + " sections" : "In " + esc(s.sections[sections[0] ?? 0]?.name)}</span>`
    : "";
}
function mapHtml() {
  if (map === "sheet") return sourceNodes() + sheetHtml();
  const scene = constellation(
    doc(),
    events,
    collapsed,
    window.innerWidth <= 650 ? 1 : 3,
    cycle,
  );
  return (
    sourceNodes() +
    `<div class="space" id="space"><svg id="universe" viewBox="0 0 ${scene.width} ${scene.height}" style="width:${scene.width * zoom}px;height:${scene.height * zoom}px;transform:translate(${pan.x}px,${pan.y}px)" aria-label="Constellation: rhythms at the centre, settings on orbits, rewrites on rings">${scene.planets
      .map((p) => {
        const broken = errors[p.voice];
        return `<g class="planet ${p.active ? "" : "inactive"} ${pending && target(pending.id)?.voice.id === p.voice ? "pending" : ""}"><rect x="${p.x - 200}" y="${p.y - 238}" width="400" height="464" rx="14" class="planet-card"/><text x="${p.x - 177}" y="${p.y - 208}" class="planet-title">${esc(p.name.length > 29 ? p.name.slice(0, 28) + "…" : p.name)}<title>${esc(p.name)} · ${esc(p.pattern.comment ?? "Click its rhythm, settings or rings to edit")}</title></text><text x="${p.x - 177}" y="${p.y - 188}" class="planet-state">${broken ? "⚠ BROKEN" : !p.active ? "○ Not in this section" : p.events.length ? "● Playing this section" : "◌ Rest this cycle"}${p.instrument.sections.length > 1 ? " · ↳ shared in " + p.instrument.sections.length + " sections" : ""}${scene.rooms
          .filter((r) => r.voices.includes(p.id))
          .map((r) => " · room " + r.id + (r.conflict ? " ⚠" : ""))
          .join("")}</text>
  <circle cx="${p.x}" cy="${p.y}" r="${p.orbit}" class="orbit"/>
  ${p.shells.map((sh, j) => `<g data-select="${sh.id}" tabindex="0" role="button" aria-label="${esc(p.name)} rewrite ${esc(sh.name)}"><title>${esc(sh.name)} rewrites the score · click to edit. Settings inside this ring are rewritten with the rhythm.</title><circle cx="${p.x}" cy="${p.y}" r="${sh.r}" class="shell${chosen(sh.id)}"/><rect x="${sh.labelX - 32}" y="${sh.labelY - 8}" width="64" height="17" rx="6" class="shell-label-bg"/><text x="${sh.labelX}" y="${sh.labelY + 4}" text-anchor="middle" class="shell-label">${esc(sh.name)}</text></g>`).join("")}
  <g data-select="${p.id}" tabindex="0" role="button" aria-label="${esc(p.name)} rhythm" class="planet-face${chosen(p.id)} ${p.tier === 3 ? "opaque" : ""}"><title>${esc(p.name)} · rhythm. Click to edit the source pattern${p.instrument.sections.length > 1 ? " shared by every marked section" : ""}.</title><circle cx="${p.x}" cy="${p.y}" r="${p.radius}"/><svg x="${p.x - 27}" y="${p.y - 27}" width="54" height="54" viewBox="0 0 100 100">${ring(
    p.events,
  )
    .replace(/^.*?<svg[^>]*>/, "")
    .replace(
      /<\/svg>$/,
      "",
    )}</svg><text x="${p.x}" y="${p.y + 4}" text-anchor="middle" class="small">${broken ? "BROKEN" : !p.active ? "resting" : "rhythm ↗"}</text></g>
  ${p.nodes
    .filter((n) => n.kind === "setting")
    .map(
      (n) =>
        `<g data-select="${n.id}" tabindex="0" role="button" aria-label="${esc(p.name)} ${esc(n.label)}" class="moon setting${chosen(n.id)}"><title>${esc(settingName(n.label))} (${esc(n.label)}) · click to edit${n.value?.core.kind === "signal" ? " the wave driving this setting" : ""}</title><circle cx="${n.x}" cy="${n.y}" r="${n.r}"/><text x="${n.x}" y="${n.y - 2}" text-anchor="middle">${esc(settingName(n.label).slice(0, 10))}</text><text x="${n.x}" y="${n.y + 11}" text-anchor="middle" class="moon-value">${esc(n.value ? (staticValue(n.value) !== undefined ? shortValue(staticValue(n.value)) : n.value.core.kind === "signal" ? "∿ " + n.value.core.shape : n.value.core.kind === "sequence" ? n.value.core.notation.slice(0, 9) : "↳ driver") : "")}</text></g>`,
    )
    .join("")}
  ${p.nodes
    .filter((n) => n.kind === "driver")
    .slice(0, 5)
    .map(
      (n) =>
        `<g data-select="${n.id}" tabindex="0" role="button" class="driver-chip" aria-label="${esc(p.name)} ${esc(n.label)} driver"><title>Open ${esc(n.label)} driver · nested setting pattern</title><text x="${n.x}" y="${n.y + 30}">↳ ${esc(n.label)}</text></g>`,
    )
    .join("")}
  <g role="button" tabindex="0" data-collapse="${p.id}" aria-label="${p.collapsed ? "Expand" : "Collapse"} ${esc(p.name)}"><text class="small" x="${p.x + 120}" y="${p.y + 215}">${p.collapsed ? "+ expand" : "− fold"}</text></g></g>`;
      })
      .join("")}</svg></div>`
  );
}
function valueMini(es: PlainEvent[], name: string, p: Pattern, id: string) {
  const values = [
    ...new Set(
      es
        .map((e) => valueAt(e, name))
        .filter((v) => v !== undefined)
        .map((v) =>
          typeof v === "number" ? String(Number(v.toPrecision(4))) : String(v),
        ),
    ),
  ];
  const unit = ["cutoff", "lpf", "hcutoff", "hpf"].includes(name)
    ? " Hz"
    : ["attack", "release", "decay", "delaytime"].includes(name)
      ? " s"
      : name === "pan"
        ? " L–R"
        : name === "gain"
          ? " ×"
          : "";
  if (driverErrors[id])
    return `<span class="error-box">⚠ Driver query failed</span>`;
  if (sampledDrivers[id]?.length) {
    const samples = sampledDrivers[id] ?? [];
    const values = samples.map((e) => Number(valueAt(e, "value")));
    return `<span class="mini-caption">∿ ${p.core.kind === "signal" ? esc(p.core.shape) : "wave"} · ${esc(shortValue(Math.min(...values)))}–${esc(shortValue(Math.max(...values)))}${unit}</span>${lane(samples, "value", 28)}`;
  }
  if (!es.length) {
    const value = staticValue(p);
    return value !== undefined
      ? `<span class="constant-mini inactive-value"><i></i><b>${esc(shortValue(value))}<small>${unit}</small></b></span>`
      : `<span class="quiet-cell">○ Pattern ready</span>`;
  }
  if (values.length === 1)
    return `<span class="constant-mini"><i style="width:${Number.isFinite(Number(values[0])) ? Math.max(3, Math.min(100, ((Number(values[0]) - controlInfo(name).min) / (controlInfo(name).max - controlInfo(name).min)) * 100)) : 100}%"></i><b>${esc(values[0])}<small>${unit}</small></b></span>`;
  return `<span class="mini-caption">${p.core.kind === "signal" ? "∿ " + esc(p.core.shape) + " · " : ""}${esc(values.slice(0, 3).join(" → "))}${values.length > 3 ? " …" : ""}${unit}</span>${lane(es, name, 28)}`;
}
function sheetHtml() {
  const data = sheet(doc(), events, cycle);
  if (rowOrder.length)
    data.rows.sort(
      (a, b) => rowOrder.indexOf(a.voice.id) - rowOrder.indexOf(b.voice.id),
    );
  const columns = moreColumns ? data.columns : data.columns.slice(0, 5),
    extra = data.columns.length - columns.length;
  return `<div class="sheet-summary"><span>${data.rows.filter((r) => r.active).length} in this section · ${data.rows.length} instruments in the piece</span>${data.columns.length > 5 ? button(moreColumns ? "Fewer settings" : `+ ${extra} more settings`, "more-columns") : ""}</div><div class="sheet-scroll"><table><thead><tr><th class="voice-col">INSTRUMENT · click to edit</th><th>RHYTHM · cycle ${cycle}</th>${columns.map((c) => `<th title="${esc(c)} · ordered by use in this piece">${esc(settingName(c))}<small>${esc(c)}</small></th>`).join("")}<th>REWRITES</th><th>ROOM</th></tr></thead><tbody>${data.rows
    .map(({ voice: v, events: es, settings: ss, active, instrument: i }) => {
      const broken = errors[i.voice.id];
      return `<tr class="${v.muted ? "muted" : ""} ${active ? "" : "inactive"} ${pending && target(pending.id)?.voice.id === i.voice.id ? "pending" : ""}" data-instrument="${v.id}"><th class="voice-col"><div class="voice-name">${button(esc(v.name), "select", `data-id="${v.id}" class="name${chosen(v.id)}" title="${esc(v.pattern.comment ?? v.name)} · edit this instrument everywhere it is used"`)}</div><div class="membership">${sectionUses(i)}</div><div class="row-actions">${button(v.muted ? "Unmute" : "M", "mute", `data-id="${v.id}" title="Mute ${esc(v.name)}"`)}${button(solo === v.id ? "Unsolo" : "S", "solo", `data-id="${v.id}" title="Solo ${esc(v.name)}"`)}${button("↑", "row-up", `data-id="${v.id}" aria-label="Move ${esc(v.name)} up"`)}${button("↓", "row-down", `data-id="${v.id}" aria-label="Move ${esc(v.name)} down"`)}${button(collapsed.has(v.id) ? "+" : "−", "collapse", `data-id="${v.id}" aria-label="Collapse ${esc(v.name)}"`)}</div></th><td>${broken ? `<span class="error-box">⚠ BROKEN</span>` : !active ? `<span class="rest-state">○ Not in this section</span>` : !es.length ? `<span class="rest-state">◌ Rest this cycle</span>` : button(`${collapsed.has(v.id) ? "Show rhythm" : lane(es, "", 34)}`, "select", `data-id="${v.pattern.id}" class="cell" title="${es.length} real queried event parts · click to edit rhythm"`)}</td>${columns
        .map((c) => {
          const matches = ss.filter((s) => s.name === c),
            s = matches.at(-1);
          return `<td>${s ? button(`${collapsed.has(v.id) ? `<span>${esc(shortValue(staticValue(s.value) ?? settingName(c)))}</span>` : valueMini(es, c, s.value, s.id)}${staticValue(s.value) === undefined ? '<span class="nested">↳ Open driver</span>' : ""}${matches.length > 1 ? `<span class="variant">${v.pattern.core.kind === "group" ? matches.length + " parts · open group" : "section variation ↗"}</span>` : ""}`, "select", `data-id="${matches.length > 1 && v.pattern.core.kind === "group" ? i.id : s.id}" class="cell${chosen(s.id)}" title="${esc(settingName(c))} (${esc(c)}) · click to edit; ↳ follows its driver"`) : '<span class="empty">—</span>'}</td>`;
        })
        .join(
          "",
        )}<td><div class="chips">${v.pattern.layers.flatMap((l) => (l.kind === "settings" ? [] : [button(esc(l.kind === "rewrite" ? l.name : "◇ source"), "select", `data-id="${l.id}" class="chip"`)])).join("")}</div></td><td>${
        data.rooms
          .filter((r) => r.voices.includes(i.id))
          .map(
            (r) =>
              `<span class="room-pill">${r.id}${r.conflict ? " ⚠ conflict" : ""}</span>`,
          )
          .join("") || "—"
      }</td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}
function render() {
  // A cycle/query refresh must not replace a captured drag target.
  if (gestureActive) return;
  const t = selectedTarget();
  app!.innerHTML = `<header><a class="brand" href="#">◎ <span>Order Doesn’t Matter</span></a><span class="study">TWO MAPS / ONE SCORE</span><div class="transport">${button(engine.playing ? "■ Stop" : "▶ Play", "play", 'id="play" class="primary"')}<span id="clock">${String(cycle).padStart(2, "0")} / ${(phase % 1).toFixed(2)}</span>${button("Undo", "undo", history.past.length ? "" : "disabled")}${button("Redo", "redo", history.future.length ? "" : "disabled")}</div></header><div class="workspace"><aside class="navigator" ${open ? "inert" : ""}><p class="eyebrow">AN INSTRUMENT FOR FINDING</p><h1>The score,<br>at a glance.</h1><label class="label" for="piece">PIECE</label><select id="piece">${piece === "paste" || piece === "local-switch" ? `<option selected value="${piece}">${piece === "local-switch" ? "Switch Angel · local only" : "Imported score"}</option>` : ""}<optgroup label="Design fixtures (secondary)">${fixtures.map((f) => `<option value="${f.id}" ${f.id === piece ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</optgroup><optgroup label="Real input + corpus programs">${corpusDocs.map((f) => `<option value="${f.id}" ${f.id === piece ? "selected" : ""}>${esc(f.title ?? f.id)}</option>`).join("")}</optgroup></select>${button("Switch Angel · local file", "local-switch", 'class="text-button" title="Reads the earlier project at runtime; source is not redistributed"')}${button("Paste Strudel…", "paste", 'class="text-button"')}<div class="nav-divider"></div><label class="label" for="find">FIND A VOICE OR SETTING</label><input id="find" type="search" placeholder="Try “shore lpf”" value="${esc(query)}" autocomplete="off"><div class="results">${
    query
      ? searchTargets(doc(), query)
          .slice(0, 50)
          .map((x) =>
            button(
              esc(x.path.join(" › ")),
              "select",
              `data-id="${x.id}" class="result"`,
            ),
          )
          .join("") || "<p>No matches</p>"
      : song(doc())
          .instruments.map(
            (i, n) =>
              `<div class="voice-nav"><button data-action="select" data-id="${i.id}" title="Edit ${esc(i.name)}${i.sections.length > 1 ? " everywhere it is used" : ""}"><i style="background:${colors[n % 4]}"></i>${esc(i.name)}</button><button data-action="focus" data-id="${i.id}" aria-label="Find ${esc(i.name)} in map">⌖</button></div>`,
          )
          .join("")
  }</div>${button("+ Add voice", "add-voice", 'class="add-voice"')}<div class="legend"><p><i class="mint"></i> Planet = rhythm / real events</p><p><i class="violet"></i> Moon = setting; satellite = driver</p><p><i class="amber"></i> Shell = ordered rewrite</p><p>Orbits mean “belongs to”.<br>There is no sound-flow path.</p><p>◇ Dashed = not modelled</p><small>Corpus importer · real Strudel queries</small></div></aside><main><div class="toolbar"><div class="tabs">${button("◎ Constellation", "map-a", `aria-pressed="${map === "constellation"}"`)}${button("▤ Score sheet", "map-b", `aria-pressed="${map === "sheet"}"`)}</div><div class="map-tools" ${open ? "inert" : ""}>${map === "constellation" ? `${button("−", "zoom-out", 'aria-label="Zoom out"')}${button("Fit", "fit")}${button("+", "zoom-in", 'aria-label="Zoom in"')}` : ""}<span>${song(doc()).instruments.length} instruments · cycle ${cycle}</span></div></div><div class="map-intro"><div><p class="eyebrow">${map === "constellation" ? "BELONGING, WITHOUT WIRES" : "COMPARE ACROSS VOICES"}</p><h2>${map === "constellation" ? "A small universe of settings." : "One piece. All its settings."}</h2><p>${map === "constellation" ? "Click a planet, moon or labelled shell to edit. Drag empty space to pan. Scroll to explore; + / − to zoom." : "Click a cell to edit. ↳ opens nested drivers. Horizontal scroll reveals every setting; names stay pinned."}</p></div><div class="map-key">${map === "constellation" ? "Inner → outer: rewrite order<br>Moons inside rings are rewritten<br>Outer orbit: freely placed constants" : "Bars are actual event spans<br>No equal-step grid is assumed"}</div></div>${arrangementHtml()}<div class="map-container" ${open ? "inert" : ""}>${mapHtml()}</div><footer><span id="status" class="${Object.keys(errors).length ? "error" : ""}">${warning ? esc(warning) : Object.keys(errors).length ? `⚠ BROKEN · ${esc(Object.values(errors).join(" · "))}` : busy ? "Querying real events…" : `${Object.values(events).flat().length} queried event parts · scored length, not audible tails`}</span><span id="pending">${pending ? "◌ PENDING · waiting for first changed onset" : "● document and preview agree"}</span></footer></main></div>${open && t ? `<div class="scrim"></div>${editorHtml(t)}` : ""}${paste ? `<div class="modal-scrim"><section class="paste-panel"><h2>Bring in a score</h2><p>Executable Strudel, for this local study. Structured import; unsupported source stays selectable.</p><textarea id="paste-source" aria-label="Strudel to import">note("60 [64 67] 72").s("triangle")</textarea>${button("Import expression", "import", 'class="primary"')}${button("Cancel", "cancel-paste")}</section></div>` : ""}`;
  bind();
}
function argLabels(name: string) {
  return (
    (
      {
        euclid: ["Pulses", "Steps", "Rotation"],
        degradeBy: ["Drop probability"],
        fast: ["Speed ×"],
        slow: ["Cycles per turn"],
        late: ["Shift · cycles"],
        range: ["Lowest", "Highest"],
        off: ["Offset · cycles", "Rewrite callback"],
        every: ["Every N cycles", "Rewrite callback"],
        sometimes: ["Rewrite callback"],
      } as Record<string, string[]>
    )[name] ?? []
  );
}
function argForm(
  name: string,
  args: import("../../import/src/document").Arg[],
  prefix: string,
) {
  return `<div class="fields">${args.map((a, i) => `<label>${esc(argLabels(name)[i] ?? `Argument ${i + 1}`)}${a.kind === "literal" ? `<input data-arg="${i}" data-prefix="${prefix}" value="${esc(a.value)}" type="${typeof a.value === "number" ? "number" : "text"}" step="any">` : a.kind === "pattern" ? button(`↳ ${esc(a.pattern.core.kind)} · open driver`, "select", `data-id="${a.pattern.id}"`) : a.kind === "callback" ? button("↳ callback pattern · open driver", "select", `data-id="${a.body.id}"`) : `<textarea data-arg-source="${i}" data-prefix="${prefix}" aria-label="Argument ${i + 1} source">${esc(a.code)}</textarea>`}</label>`).join("")}</div>`;
}
function strip(steps: Step[], path: number[] = []): string {
  const total = steps.reduce(
    (n, s) => n + ("weight" in s ? (s.weight ?? 1) : 1),
    0,
  );
  return `<div class="step-group">${steps
    .map((s, i) => {
      const p = [...path, i],
        active = p.join(".") === editPath.join(".");
      return `<div class="step ${s.kind} ${active ? "active" : ""}" style="flex:${"weight" in s ? (s.weight ?? 1) : 1}">${"steps" in s ? `<button data-step="${p.join(".")}" class="group-caption">${s.kind === "alternate" ? "successive cycles ↓" : s.kind === "together" ? "together" : "sub-group"} · ${(("weight" in s ? (s.weight ?? 1) : 1) / total).toFixed(2)}</button>${strip(s.steps, p)}` : `<button data-step="${p.join(".")}" title="Select step ${p.join(".")}">${esc(s.kind === "value" ? s.value : s.kind === "rest" ? "rest" : s.notation)}</button>`}</div>`;
    })
    .join("")}</div>`;
}
function selectionContext(t: Target) {
  const structure = song(doc());
  const contains = (
    p: Pattern,
    i: ReturnType<typeof song>["instruments"][number],
  ) =>
    targets({
      ...doc(),
      setup: [],
      transforms: [],
      shared: {},
      voices: [{ ...i.voice, id: i.id, name: i.name, pattern: p }],
    }).some((x) => x.id === t.id);
  for (const instrument of structure.instruments) {
    if (contains(instrument.pattern, instrument))
      return { instrument, sections: instrument.sections, local: false };
    const uses = instrument.uses.filter((u) => contains(u.pattern, instrument));
    if (uses.length)
      return {
        instrument,
        sections: [...new Set(uses.map((u) => u.section))],
        local: true,
      };
  }
}
function editingScopeHtml(t: Target) {
  const context = selectionContext(t),
    structure = song(doc());
  if (!context || (!context.local && context.sections.length <= 1)) return "";
  return `<div class="sharing-notice"><strong>${context.local ? "Section variation" : "↳ One shared instrument"} · ${esc(context.instrument.name)}</strong><span>Changes here apply in ${context.sections
    .filter((n) => n >= 0)
    .map(
      (n) =>
        esc(structure.sections[n]?.name) + " @ " + structure.sections[n]?.start,
    )
    .join(", ")}.</span></div>`;
}
function editorHtml(t: Target) {
  const context = selectionContext(t);
  const resultEvents = context
    ? instrumentEvents(context.instrument, events)
    : (events[t.voice.id] ?? []);
  const node = t.node;
  const p = "pattern" in node ? node.pattern : t.pattern;
  const layer = "kind" in node && node.kind === "rewrite" ? node : undefined;
  const opaque =
    "code" in node
      ? node
      : "core" in node && node.core.kind === "opaque"
        ? node.core
        : p.core.kind === "opaque"
          ? p.core
          : undefined;
  const rootSelected =
    "pattern" in node || ("core" in node && node.id === t.voice.pattern.id);
  const rule = rootSelected
    ? p.layers.find(
        (l) =>
          l.kind === "rewrite" &&
          ["euclid", "degradeBy", "sometimes", "every"].includes(l.name),
      )
    : undefined;
  const kind = opaque
    ? "Source · not modelled"
    : layer
      ? layer.tier === 2
        ? "Named arguments · tier 2"
        : "Rewrite shell"
      : rule || p.core.kind === "generator"
        ? "Rule-made rhythm"
        : p.core.kind === "sequence"
          ? "Typed sequence"
          : p.core.kind === "signal"
            ? "Signal driver"
            : p.core.kind === "constant"
              ? "Constant setting"
              : p.core.kind === "group"
                ? "Group"
                : "Named arguments · tier 2";
  let body = "";
  if (opaque) {
    body = `<div class="notice source-notice">◇ NOT MODELLED · source stays visible and playable.</div><label class="label">SOURCE TEXT · edits evaluate automatically<textarea id="opaque-code" spellcheck="false">${esc(opaque.code)}</textarea></label><p class="help">Broken source shows an error, never a silent-looking empty lane.</p>`;
  } else if (layer) {
    body = `<div class="notice amber-text">Order matters here. Shells apply from inside to outside; moving past a settings bag also changes which rewrites apply to it.</div><div class="comparison"><div><span class="label">ENTERING THIS SHELL</span>${lane(before)}</div><div><span class="label">LEAVING THIS SHELL</span>${lane(after)}</div></div><h3>${esc(layer.name)} arguments</h3>${argForm(layer.name, layer.args, "layer")}<div class="actions" ${t.layerIndex === undefined ? "hidden" : ""}>${button("← Move inward", "shell-in")}${button("Move outward →", "shell-out")}${button("Remove shell", "shell-remove", 'class="danger"')}</div><div class="order-list">${p.layers.map((l, i) => button(`${i + 1} · ${esc(l.kind === "rewrite" ? l.name : l.kind === "settings" ? "settings bag" : "source")}`, "select", `data-id="${l.id}" class="${l.id === layer.id ? "current" : ""}"`)).join("")}</div>`;
  } else if ("kind" in node && node.kind === "settings") {
    body = `<h3>Settings at this ring</h3><div class="driver-tree">${node.settings.map((s) => button(esc(s.name), "select", `data-id="${s.id}"`)).join("")}</div>`;
  } else if (rule && rule.kind === "rewrite") {
    body = `<div class="notice">◉ Events come from <b>${esc(rule.name)}</b>. Individual notes cannot be moved: change the rule to change the rhythm.</div><h3>${esc(rule.name)}</h3>${argForm(rule.name, rule.args, "rule")}`;
    if (p.core.kind === "generator")
      body += `<h3>Source · ${esc(p.core.name)}</h3>${argForm(p.core.name, p.core.args, "generator")}`;
  } else if (p.core.kind === "generator") {
    body = `<div class="notice">Events are made by ${esc(p.core.name)}. Notes are read-only; edit named arguments.</div>${argForm(p.core.name, p.core.args, "generator")}`;
  } else if (p.core.kind === "sequence") {
    const s = stepValue(p.core.steps, editPath);
    body = `<div class="axis-labels"><span>${cycle} / start</span><span>¼</span><span>½</span><span>¾</span><span>${cycle + 1}</span></div><div class="strip ${pending ? "pending" : ""}">${strip(p.core.steps)}</div><p class="help">Input timeline, before voice shells. Width = weight. Sub-groups keep their nesting; stacked alternatives play on successive cycles.</p><h3>Step ${editPath.map((x) => x + 1).join(" › ")}</h3><div class="fields"><label>Value<input id="step-value" value="${esc(s?.kind === "value" ? s.value : "60")}"></label><label>Weight · relative duration<input id="step-weight" type="number" min="0.125" max="8" step="0.125" value="${s && "weight" in s ? (s.weight ?? 1) : 1}"></label></div><div class="actions">${button("Split into sub-group", "step-split")}${button("Merge sub-group", "step-merge")}${button("Rest / restore", "step-rest")}${button("Alternate cycles", "step-alternate")}</div>${t.setting ? '<p class="help">Draw across the event lane below to paint values. Horizontal position follows real queried event boundaries.</p><div id="paint-lane" class="paint-lane" aria-label="Draw stepped setting values">' + lane(events[t.voice.id] ?? [], t.setting.name, 70) + "</div>" : ""}`;
  } else if (p.core.kind === "constant") {
    const info = controlInfo(t.setting?.name ?? t.label),
      val = p.core.value;
    body = `<h3>${esc(info.name)}</h3><label class="constant-control">${typeof val === "number" ? `<output id="constant-output">${val} <small>${esc(info.unit)}</small></output><input id="constant-range" type="range" min="${info.min}" max="${info.max}" step="${info.step}" value="${val}">` : ""}<span>Value${info.unit ? " · " + esc(info.unit) : ""}</span><input id="constant-value" type="${typeof val === "number" ? "number" : "text"}" step="${info.step}" value="${esc(val)}"></label>`;
  } else if (p.core.kind === "signal") {
    const range = p.layers.find(
        (l) => l.kind === "rewrite" && l.name === "range",
      ),
      speed = p.layers.find(
        (l) => l.kind === "rewrite" && ["slow", "fast"].includes(l.name),
      );
    const val = (l: typeof range, i: number, f: number) =>
      l?.kind === "rewrite" && l.args[i]?.kind === "literal"
        ? l.args[i].value
        : f;
    body = `<h3>${esc(p.core.shape)} wave</h3><div class="wave-handles"><div class="wave-drawing">${lane(previewEvents, "", 90)}<button data-wave-handle="1" class="wave-high" aria-label="Drag highest value">↕ high</button><button data-wave-handle="0" class="wave-low" aria-label="Drag lowest value">↕ low</button><button data-wave-handle="2" class="wave-speed" aria-label="Drag wave speed">↔ speed</button></div><div class="fields">${["Lowest", "Highest", "Speed · cycles per wave"].map((name, i) => `<label>${name}<input data-signal="${i}" type="number" step="any" value="${esc(i < 2 ? val(range, i, i === 0 ? 0 : 1) : val(speed, 0, 1))}"></label>`).join("")}</div></div><p class="help">The wave is sampled by Strudel at real note onsets. Handles change its range and period.</p>`;
  } else if (p.core.kind === "data") {
    body = `<h3>Structured value</h3><label class="label">JSON VALUE<textarea id="data-value">${esc(JSON.stringify(p.core.value, null, 2))}</textarea></label>`;
  } else if (p.core.kind === "ref") {
    body = `<h3>Shared pattern · ${esc(p.core.name)}</h3>${doc().shared[p.core.name] ? button("Inspect shared pattern", "select", `data-id="${doc().shared[p.core.name]!.id}"`) : '<div class="error-box">Missing shared definition</div>'}`;
  } else if (p.core.kind === "group") {
    body = `<h3>${esc(p.core.how)} contains</h3><div class="driver-tree">${p.core.parts.map((x, i) => button(`Part ${i + 1}${x.cycles ? " · " + x.cycles + " cycles" : ""}`, "select", `data-id="${x.pattern.id}"`)).join("")}</div>`;
  } else body = "<p>Select a child to open its arguments.</p>";
  const children = targets({ ...doc(), voices: [t.voice] }).filter(
    (x) => x.parent?.id === p.id && x.id !== t.id && "core" in x.node,
  );
  return `<section class="editor" role="dialog" aria-modal="true" aria-label="Edit ${esc(t.path.join(" › "))}"><div class="editor-head"><div><p class="eyebrow">ONE THING AT A TIME · ${kind}</p><h2 id="breadcrumb">${esc(t.path.join(" › "))}</h2></div>${button("Done ×", "done", 'class="done"')}</div><div class="editor-scroll"><div class="voice-preview"><div><span class="label">REAL RESULT · CYCLE ${cycle} · ${esc(context?.instrument.name ?? t.pattern.label ?? t.voice.name)}</span>${errors[t.voice.id] ? `<div class="error-box">⚠ BROKEN · ${esc(errors[t.voice.id])}</div>` : lane(events[t.voice.id] ?? [], "", 60)}<div class="axis-labels"><span>start</span><span>½ cycle</span><span>end</span></div></div><figure>${ring(resultEvents)}<figcaption>read-only</figcaption></figure></div><div id="editor-error" role="alert">${warning ? `<p class="error-box">${esc(warning)}</p>` : ""}</div>${editingScopeHtml(t)}${body}${t.setting ? `<div class="driver-tree"><span class="label">WHAT DRIVES ${esc(t.setting.name)}?</span>${button(`${esc(t.setting.value.core.kind)} › open driver`, "select", `data-id="${t.setting.value.id}"`)}${["constant", "sequence", "signal"].map((x) => button(`Use ${x}`, "driver", `data-kind="${x}"`)).join("")}</div>` : ""}${children.length ? `<div class="driver-tree"><span class="label">NESTED DRIVERS · CLICK TO OPEN</span>${children.map((x) => button(esc(x.path.slice(t.path.length).join(" › ") || x.label), "select", `data-id="${x.id}"`)).join("")}</div>` : ""}<div class="context"><span class="label">OTHER SETTINGS · SELECT TO EDIT</span>${settings(
    t.voice,
  )
    .filter((s) => s.id !== t.setting?.id)
    .map(
      (s) =>
        `<div class="context-row">${button(esc(s.name), "select", `data-id="${s.id}"`)}${lane(events[t.voice.id] ?? [], s.name, 22)}</div>`,
    )
    .join(
      "",
    )}</div><div class="add-section"><h3>Add to ${esc(t.voice.name)}</h3>${button("+ Setting", "add-setting")}${button("+ Rewrite shell", "add-shell")}${adding ? addForm() : ""}</div><details><summary>Generated Strudel · read-only</summary><pre>${esc(generate(doc()))}</pre></details></div><div class="editor-foot"><label>WHEN CHANGES LAND<select id="apply-mode"><option value="now" ${mode === "now" ? "selected" : ""}>Apply now · scheduled notes may keep old values</option><option value="next" ${mode === "next" ? "selected" : ""}>Apply at next uncommitted cycle</option></select></label><span id="editor-pending">${pending ? `◌ PENDING · onset at/after ${pending.first.toFixed(2)}` : "● Up to date"}</span></div></section>`;
}
function stepValue(steps: Step[], path: number[]): Step | undefined {
  let s: Step | undefined;
  for (const i of path) {
    s = steps[i];
    if (s && "steps" in s) steps = s.steps;
  }
  return s;
}
const controls = Object.keys(core.controls).filter((n) =>
  core.isControlName(n),
);
const common = [
  "lpf",
  "gain",
  "pan",
  "s",
  "note",
  "room",
  "roomsize",
  "orbit",
  "delay",
  "delaytime",
  "delayfeedback",
  "hpf",
  "crush",
  "distort",
  "release",
];
function addForm() {
  const list =
    adding === "shell"
      ? ["fast", "slow", "late", "rev", "euclid", "degradeBy"]
      : [...new Set([...common, ...controls.sort()])];
  return `<div class="add-form"><label>Search ${adding === "shell" ? "rewrites" : "Strudel control registry"}<input id="add-search" type="search" value="${esc(addQuery)}"></label><div id="add-results">${list
    .filter((x) => x.toLowerCase().includes(addQuery.toLowerCase()))
    .slice(0, 40)
    .map((n) =>
      button(
        `${n}${common.includes(n) && adding === "setting" ? " · common" : ""}`,
        "add-choice",
        `data-name="${n}"`,
      ),
    )
    .join("")}</div></div>`;
}
async function refresh() {
  const token = ++serial;
  busy = true;
  const d = doc(),
    c = cycle;
  const tagged = tagVoices(d, true);
  const r = await queryEvents(generate(tagged), c, c + 1);
  if (token !== serial) return;
  events = Object.fromEntries(d.voices.map((v) => [v.id, []]));
  errors = {};
  for (const e of r.events) {
    const id = String(valueAt(e, "__voice") ?? d.voices[0]?.id ?? "setup");
    (events[id] ??= []).push(e);
  }
  if (r.error) for (const v of d.voices) errors[v.id] = r.error;
  sampledDrivers = {};
  driverErrors = {};
  const drivers = driverDocument(d);
  if (drivers) {
    const sampled = await queryEvents(generate(drivers), c, c + 1);
    if (token !== serial) return;
    for (const e of sampled.events) {
      const id = String(valueAt(e, "__driver"));
      (sampledDrivers[id] ??= []).push(e);
    }
    if (sampled.error)
      for (const v of drivers.voices)
        driverErrors[v.id.replace("driver-", "")] = sampled.error;
  }
  const t = selectedTarget();
  before = [];
  after = [];
  previewEvents = [];
  if (t) {
    const l =
      "kind" in t.node && t.node.kind === "rewrite" ? t.node : undefined;
    try {
      if (l && t.layerIndex !== undefined) {
        const a = await queryEvents(
            generate({
              ...d,
              order: undefined,
              voices: [
                {
                  ...t.voice,
                  pattern: {
                    ...t.pattern,
                    layers: t.pattern.layers.slice(0, t.layerIndex),
                  },
                },
              ],
            }),
            c,
            c + 1,
          ),
          b = await queryEvents(
            generate({
              ...d,
              order: undefined,
              voices: [
                {
                  ...t.voice,
                  pattern: {
                    ...t.pattern,
                    layers: t.pattern.layers.slice(0, t.layerIndex + 1),
                  },
                },
              ],
            }),
            c,
            c + 1,
          );
        before = a.events;
        after = b.events;
      }
      if (t.pattern.core.kind === "signal") {
        const r = await queryEvents(
          generate({
            ...d,
            order: undefined,
            voices: [
              {
                ...t.voice,
                pattern: {
                  ...t.pattern,
                  layers: [...t.pattern.layers, shell("segment", [64])],
                },
              },
            ],
          }),
          c,
          c + 1,
        );
        previewEvents = r.events;
      }
    } catch (e) {
      warning = String(e);
    }
  }
  busy = false;
  const active = document.activeElement;
  const focus =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ? {
          id: active.id,
          value: active.value,
          start: active.selectionStart,
          end: active.selectionEnd,
        }
      : undefined;
  const scroll = document.querySelector(".editor-scroll")?.scrollTop ?? 0;
  render();
  const panel = document.querySelector(".editor-scroll");
  if (panel) panel.scrollTop = scroll;
  if (focus?.id) {
    const el = document.getElementById(focus.id);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.focus();
      if (
        el.type === "text" ||
        el.type === "search" ||
        el instanceof HTMLTextAreaElement
      ) {
        if (focus.start !== null && focus.end !== null)
          el.setSelectionRange(focus.start, focus.end);
      }
    }
  }
}
async function changed(next: Doc, id = selected) {
  const previous = playDoc();
  history.set(next);
  revision++;
  warning = "";
  const changedVoice = target(id)?.voice.id;
  const r = engine.revision + 1;
  pending = engine.playing
    ? {
        id,
        revision: r,
        first: Math.max(
          engine.horizon(),
          engine.phase() + (0.3 * (doc().tempo?.cpm ?? 32)) / 60,
        ),
        queued: mode === "next",
      }
    : undefined;
  if (engine.playing) {
    try {
      if (mode === "next") {
        const boundary = Math.max(
          Math.floor(engine.phase()) + 1,
          Math.ceil(engine.horizon()),
        );
        pending!.first = boundary;
        pending!.queued = false;
        await engine.swap(atBoundary(previous, playDoc(), boundary));
      } else await engine.swap(playDoc());
    } catch (e) {
      warning = String(e);
      pending = undefined;
    }
  }
  changeLog.push({
    revision,
    state: pending ? "pending" : "preview",
    cycle: phase,
  });
  await refresh();
}
function playDoc(): Doc {
  const d = tagVoices(doc());
  return solo
    ? {
        ...d,
        voices: d.voices.map((v) => ({
          ...v,
          pattern: {
            ...v.pattern,
            layers: [
              ...v.pattern.layers,
              {
                id: "solo-" + v.id,
                tier: 3,
                kind: "opaque",
                code: `.filterValues(v=>v.__planet==='${solo}'||v.__voice==='${solo}')`,
              },
            ],
          },
        })),
      }
    : d;
}

async function choose(id: string) {
  const t = target(id);
  const c = t?.voice.pattern.core;
  if (
    t &&
    (id === t.voice.id || id === t.voice.pattern.id) &&
    !t.voice.pattern.layers.some(
      (l) =>
        l.kind === "rewrite" &&
        ["euclid", "degradeBy", "sometimes", "every"].includes(l.name),
    ) &&
    c?.kind === "generator" &&
    ["note", "s", "n"].includes(c.name) &&
    c.args[0]?.kind === "pattern"
  )
    id = c.args[0].pattern.id;
  selected = id;
  open = true;
  editPath = [0];
  adding = "";
  warning = "";
  await refresh();
  const scroll = document.querySelector(".editor-scroll");
  if (scroll) scroll.scrollTop = 0;
  document.querySelector<HTMLButtonElement>(".done")?.focus();
}
async function edit(fn: (t: Target) => void) {
  await changed(update(doc(), selected, fn));
}
function bind() {
  document.querySelectorAll<HTMLElement>("[data-action]").forEach(
    (el) =>
      (el.onclick = () => {
        const action = el.dataset.action,
          id = el.dataset.id;
        handle(action ?? "", id, el).catch((e) => {
          warning = String(e);
          busy = false;
          render();
        });
      }),
  );
  document.querySelectorAll<SVGElement>("[data-select]").forEach((el) => {
    const explain = () => {
      const hint = document.querySelector(".map-key");
      if (hint)
        hint.textContent =
          el.querySelector("title")?.textContent ??
          el.getAttribute("aria-label") ??
          "";
    };
    el.onfocus = explain;
    el.onmouseenter = explain;
    el.onclick = () => choose(el.dataset.select ?? "").catch(fail);
    el.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        choose(el.dataset.select ?? "").catch(fail);
      }
    };
  });
  document.querySelectorAll<SVGElement>("[data-collapse]").forEach((el) => {
    const fn = () => {
      const id = el.dataset.collapse ?? "";
      collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
      render();
    };
    el.onclick = fn;
    el.onkeydown = (e) => {
      if (e.key === "Enter") fn();
    };
  });
  const on = (s: string, event: string, fn: (e: Event) => void) =>
    document.querySelector(s)?.addEventListener(event, fn);
  on("#piece", "change", (e) => {
    const f = [...fixtures, ...corpusDocs].find(
      (f) => f.id === (e.target as HTMLSelectElement).value,
    );
    if (f) {
      engine.stop();
      history.set(structuredClone(f.doc));
      piece = f.id;
      selected = "";
      rowOrder = [];
      open = false;
      cycle = 0;
      phase = 0;
      pending = undefined;
      query = "";
      zoom = Math.min(
        1,
        (window.innerWidth - (window.innerWidth > 650 ? 240 : 0)) /
          (window.innerWidth <= 650 ? 420 : 1260),
      );
      pan = { x: 0, y: 0 };
      refresh().catch(fail);
    }
  });
  on("#find", "input", (e) => {
    query = (e.target as HTMLInputElement).value;
    const el = e.target as HTMLInputElement;
    const pos = el.selectionStart;
    render();
    const n = document.querySelector<HTMLInputElement>("#find");
    n?.focus();
    if (pos !== null) n?.setSelectionRange(pos, pos);
  });
  on("#apply-mode", "change", (e) => {
    mode = (e.target as HTMLSelectElement).value;
  });
  document.querySelectorAll<HTMLButtonElement>("[data-step]").forEach(
    (el) =>
      (el.onclick = () => {
        editPath = el.dataset.step!.split(".").map(Number);
        render();
      }),
  );
  on("#data-value", "change", (e) =>
    edit((t) => {
      if (t.pattern.core.kind === "data")
        t.pattern.core.value = JSON.parse(
          (e.target as HTMLTextAreaElement).value,
        );
    }).catch(fail),
  );
  on("#step-value", "change", (e) =>
    edit((t) =>
      changeStep(
        t.pattern,
        editPath,
        "value",
        (e.target as HTMLInputElement).value,
      ),
    ).catch(fail),
  );
  on("#step-weight", "change", (e) =>
    edit((t) =>
      changeStep(
        t.pattern,
        editPath,
        "weight",
        (e.target as HTMLInputElement).value,
      ),
    ).catch(fail),
  );
  on("#constant-value", "change", (e) => {
    const value = (e.target as HTMLInputElement).value;
    edit((t) => {
      if (t.pattern.core.kind === "constant")
        t.pattern.core.value =
          typeof t.pattern.core.value === "number" ? Number(value) : value;
    }).catch(fail);
  });
  on("#constant-range", "input", (e) => {
    const el = e.target as HTMLInputElement;
    const output = document.querySelector("#constant-output");
    if (output) output.textContent = el.value;
  });
  on("#constant-range", "change", (e) =>
    edit((t) => {
      if (t.pattern.core.kind === "constant")
        t.pattern.core.value = Number((e.target as HTMLInputElement).value);
    }).catch(fail),
  );
  document.querySelectorAll<HTMLInputElement>("[data-arg]").forEach(
    (el) =>
      (el.onchange = () =>
        edit((t) => {
          const l =
            el.dataset.prefix === "layer" &&
            "kind" in t.node &&
            t.node.kind === "rewrite"
              ? t.node
              : el.dataset.prefix === "rule"
                ? t.pattern.layers.find(
                    (l) =>
                      l.kind === "rewrite" &&
                      ["euclid", "degradeBy", "sometimes", "every"].includes(
                        l.name,
                      ),
                  )
                : undefined;
          const args =
            l && "args" in l
              ? l.args
              : t.pattern.core.kind === "generator"
                ? t.pattern.core.args
                : [];
          const a = args[Number(el.dataset.arg)];
          if (a?.kind === "literal")
            a.value =
              typeof a.value === "number"
                ? Number(el.value)
                : typeof a.value === "boolean"
                  ? el.value === "true"
                  : el.value;
        }).catch(fail)),
  );
  document.querySelectorAll<HTMLTextAreaElement>("[data-arg-source]").forEach(
    (el) =>
      (el.onchange = () =>
        edit((t) => {
          const n = t.node;
          const args =
            "kind" in n && n.kind === "rewrite"
              ? n.args
              : t.pattern.core.kind === "generator"
                ? t.pattern.core.args
                : [];
          const a = args[Number(el.dataset.argSource)];
          if (a?.kind === "opaque") a.code = el.value;
        }).catch(fail)),
  );
  document.querySelectorAll<HTMLInputElement>("[data-signal]").forEach(
    (el) =>
      (el.onchange = () =>
        edit((t) => {
          const i = Number(el.dataset.signal),
            name = i === 2 ? "slow" : "range";
          let l = t.pattern.layers.find(
            (l) => l.kind === "rewrite" && l.name === name,
          );
          if (!l) {
            l = shell(name, i === 2 ? [1] : [0, 1]);
            t.pattern.layers.push(l);
          }
          if (l.kind === "rewrite")
            l.args[i === 2 ? 0 : i] = {
              kind: "literal",
              value: Number(el.value),
            };
        }).catch(fail)),
  );
  let timer: ReturnType<typeof setTimeout>;
  on("#opaque-code", "input", (e) => {
    const value = (e.target as HTMLTextAreaElement).value;
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        edit((t) => {
          const n = t.node;
          if ("code" in n) n.code = value;
          else if (t.pattern.core.kind === "opaque")
            t.pattern.core.code = value;
        }).catch(fail),
      450,
    );
  });
  on("#add-search", "input", (e) => {
    addQuery = (e.target as HTMLInputElement).value;
    const old = document.querySelector(".add-form");
    if (old) {
      old.outerHTML = addForm();
      bindAdd();
    }
  });
  bindPaint();
  bindWave();
  bindPan();
}
function bindAdd() {
  document
    .querySelectorAll<HTMLButtonElement>('[data-action="add-choice"]')
    .forEach(
      (el) =>
        (el.onclick = () => handle("add-choice", undefined, el).catch(fail)),
    );
  const input = document.querySelector<HTMLInputElement>("#add-search");
  if (input) {
    input.oninput = () => {
      addQuery = input.value;
      document.querySelector(".add-form")!.outerHTML = addForm();
      bindAdd();
    };
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}
async function handle(action: string, id?: string, el?: HTMLElement) {
  const t = selectedTarget();
  switch (action) {
    case "more-columns":
      moreColumns = !moreColumns;
      render();
      break;
    case "jump-section": {
      const section = song(doc()).sections[Number(id)];
      if (section) {
        busy = true;
        const playing = engine.playing;
        engine.stop();
        cycle = section.start;
        phase = cycle;
        lastCycle = cycle;
        pending = undefined;
        if (playing) await engine.play(playDoc(), cycle);
        await refresh();
      }
      break;
    }
    case "cycle-prev":
      cycle = Math.max(0, cycle - 1);
      phase = cycle;
      await refresh();
      break;
    case "cycle-next":
      cycle++;
      phase = cycle;
      await refresh();
      break;
    case "select":
      if (id) await choose(id);
      break;
    case "done":
      open = false;
      adding = "";
      render();
      break;
    case "map-a":
      map = "constellation";
      render();
      break;
    case "map-b":
      map = "sheet";
      render();
      break;
    case "play":
      if (engine.playing) {
        engine.stop();
        pending = undefined;
        queued = undefined;
      } else {
        await engine.play(playDoc(), cycle);
      }
      render();
      break;
    case "undo":
      history.undo();
      pending = undefined;
      queued = undefined;
      if (engine.playing) await engine.swap(playDoc());
      await refresh();
      break;
    case "redo":
      history.redo();
      if (engine.playing) await engine.swap(playDoc());
      await refresh();
      break;
    case "add-voice":
      await changed(addVoice(doc()));
      break;
    case "local-switch": {
      busy = true;
      const response = await fetch("/__local/switch-angel");
      if (!response.ok) {
        busy = false;
        warning = "Switch Angel source unavailable on this machine";
        render();
        break;
      }
      const imported = importStrudel(await response.text());
      engine.stop();
      history.set(imported.doc);
      piece = "local-switch";
      selected = "";
      open = false;
      cycle = 0;
      phase = 0;
      warning = imported.warnings.join(" · ");
      await refresh();
      break;
    }
    case "paste":
      paste = true;
      render();
      break;
    case "cancel-paste":
      paste = false;
      render();
      break;
    case "import": {
      const s =
        document.querySelector<HTMLTextAreaElement>("#paste-source")?.value ??
        "";
      const r = importStrudel(s);
      engine.stop();
      history.set(r.doc);
      warning = r.warnings.join(" ");
      paste = false;
      piece = "paste";
      cycle = 0;
      phase = 0;
      lastCycle = 0;
      pending = undefined;
      solo = "";
      rowOrder = [];
      collapsed.clear();
      selected = r.doc.voices[0]?.id ?? "";
      open = !!selected;
      await refresh();
      break;
    }
    case "zoom-in":
      zoom = Math.min(2, zoom * 1.2);
      render();
      break;
    case "zoom-out":
      zoom = Math.max(0.35, zoom / 1.2);
      render();
      break;
    case "fit":
      zoom = Math.min(
        1,
        (document.querySelector(".map-container")?.clientWidth ?? 1200) /
          (window.innerWidth <= 650 ? 420 : 1260),
      );
      pan = { x: 0, y: 0 };
      render();
      break;
    case "focus": {
      if (map === "sheet") {
        document
          .querySelector(`[data-id="${id}"].name`)
          ?.scrollIntoView({ block: "center", inline: "start" });
      } else {
        const g = document.querySelector(`[data-select="${id}"]`);
        g?.scrollIntoView({ block: "center", inline: "center" });
      }
      break;
    }
    case "collapse":
      if (id) {
        collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
        render();
      }
      break;
    case "mute":
      if (id) await changed(toggleMute(doc(), id), id);
      break;
    case "solo":
      solo = solo === id ? "" : (id ?? "");
      if (engine.playing) await engine.swap(playDoc());
      render();
      break;
    case "row-up":
    case "row-down": {
      const rows = sheet(doc(), events).rows.map((r) => r.voice.id);
      if (!rowOrder.length) rowOrder = rows;
      const i = rowOrder.indexOf(id ?? ""),
        j = i + (action === "row-up" ? -1 : 1),
        a = rowOrder[i],
        b = rowOrder[j];
      if (a && b) {
        rowOrder[i] = b;
        rowOrder[j] = a;
        render();
      }
      break;
    }
    case "step-split":
    case "step-merge":
    case "step-rest":
    case "step-alternate":
      await edit((t) =>
        changeStep(
          t.pattern,
          editPath,
          action.slice(5) as "split" | "merge" | "rest" | "alternate",
        ),
      );
      break;
    case "shell-in":
    case "shell-out":
      await changed(moveShell(doc(), selected, action === "shell-in" ? -1 : 1));
      break;
    case "shell-remove":
      if (t) {
        await edit((t) => {
          if (t.layerIndex !== undefined)
            t.pattern.layers.splice(t.layerIndex, 1);
        });
        selected = t.voice.id;
        await refresh();
      }
      break;
    case "driver": {
      const kind = el?.dataset.kind;
      if (kind === "signal" || kind === "sequence" || kind === "constant")
        await edit((t) => makeDriver(t, kind));
      break;
    }
    case "add-setting":
    case "add-shell":
      adding = action === "add-setting" ? "setting" : "shell";
      addQuery = "";
      render();
      document.querySelector<HTMLInputElement>("#add-search")?.focus();
      break;
    case "add-choice":
      if (t && el?.dataset.name) {
        const d =
          adding === "setting"
            ? addSetting(doc(), ownerId(doc(), t), el.dataset.name)
            : addShell(doc(), ownerId(doc(), t), el.dataset.name);
        adding = "";
        await changed(d);
      }
      break;
  }
}
function bindPaint() {
  const el = document.querySelector<HTMLElement>("#paint-lane");
  if (!el) return;
  let painting = false,
    draft: Doc | undefined;
  const paint = (e: PointerEvent) => {
    if (!draft) return;
    const t = targets(draft).find((x) => x.id === selected);
    if (!t || t.pattern.core.kind !== "sequence") return;
    const rect = el.getBoundingClientRect(),
      x = Math.max(0, Math.min(0.99999, (e.clientX - rect.left) / rect.width)),
      y = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const info = controlInfo(t.setting?.name ?? "lpf");
    paintSequence(t.pattern, x, info.min + y * (info.max - info.min), cycle);
  };
  el.onpointerdown = (e) => {
    painting = true;
    gestureActive = true;
    draft = structuredClone(doc());
    el.setPointerCapture(e.pointerId);
    paint(e);
  };
  el.onpointermove = (e) => {
    if (painting) paint(e);
  };
  el.onpointerup = () => {
    painting = false;
    gestureActive = false;
    if (draft) changed(draft).catch(fail);
    draft = undefined;
  };
  el.onpointercancel = () => {
    painting = false;
    gestureActive = false;
    draft = undefined;
  };
}
function bindWave() {
  document
    .querySelectorAll<HTMLButtonElement>("[data-wave-handle]")
    .forEach((el) => {
      let start: { x: number; y: number; value: number } | undefined;
      const i = Number(el.dataset.waveHandle),
        input = () =>
          document.querySelector<HTMLInputElement>(`[data-signal="${i}"]`);
      el.onpointerdown = (e) => {
        const field = input();
        if (!field) return;
        start = { x: e.clientX, y: e.clientY, value: Number(field.value) };
        gestureActive = true;
        el.setPointerCapture(e.pointerId);
      };
      el.onpointermove = (e) => {
        if (!start) return;
        const field = input();
        if (field) {
          field.value = String(
            i === 2
              ? Math.max(
                  0.125,
                  Math.round((start.value + (e.clientX - start.x) / 40) * 8) /
                    8,
                )
              : Math.max(
                  0,
                  Math.round(start.value + (start.y - e.clientY) * 30),
                ),
          );
          el.textContent = `${i === 2 ? "speed" : i === 1 ? "high" : "low"} ${field.value}`;
        }
      };
      el.onpointerup = () => {
        if (start) {
          start = undefined;
          gestureActive = false;
          input()?.dispatchEvent(new Event("change"));
        }
      };
      el.onpointercancel = () => {
        start = undefined;
        gestureActive = false;
      };
    });
}
function bindPan() {
  const el = document.querySelector<HTMLElement>("#space"),
    svg = document.querySelector<SVGElement>("#universe");
  if (!el || !svg) return;
  let drag: { x: number; y: number; px: number; py: number } | undefined;
  el.onpointerdown = (e) => {
    if ((e.target as Element).closest("[data-select],[data-collapse]")) return;
    drag = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    el.setPointerCapture(e.pointerId);
  };
  el.onpointermove = (e) => {
    if (drag) {
      pan = {
        x: drag.px + e.clientX - drag.x,
        y: drag.py + e.clientY - drag.y,
      };
      svg.style.transform = `translate(${pan.x}px,${pan.y}px)`;
    }
  };
  el.onpointerup = () => {
    drag = undefined;
  };
}
function fail(e: unknown) {
  warning = e instanceof Error ? e.message : String(e);
  render();
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && open) {
    open = false;
    render();
  }
  if (
    (e.ctrlKey || e.metaKey) &&
    e.key === "z" &&
    !(
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    )
  ) {
    e.preventDefault();
    handle(e.shiftKey ? "redo" : "undo").catch(fail);
  }
});
let lastCycle = 0;
function tick() {
  if (engine.playing) {
    phase = engine.phase();
    const c = Math.floor(phase);
    if (c !== lastCycle) {
      lastCycle = c;
      cycle = c;
      if (queued) {
        const next = queued;
        queued = undefined;
        if (pending) {
          pending.queued = false;
          pending.revision = engine.revision + 1;
        }
        engine
          .swap(
            tagVoices(
              solo
                ? {
                    ...next,
                    voices: next.voices.map((v) => ({
                      ...v,
                      muted: v.id !== solo || v.muted,
                    })),
                  }
                : next,
            ),
          )
          .catch(fail);
      }
      refresh().catch(fail);
    }
    const clock = document.querySelector("#clock");
    if (clock)
      clock.textContent = `${String(cycle).padStart(2, "0")} / ${(phase % 1).toFixed(2)}`;
    document
      .querySelectorAll<SVGPathElement>(".playline")
      .forEach((p) => p.setAttribute("d", `M${(phase % 1) * 300} 0V100`));
    document
      .querySelectorAll<SVGPathElement>(".ringhead")
      .forEach((p) =>
        p.setAttribute(
          "d",
          `M50 50L${50 + Math.cos((phase % 1) * Math.PI * 2 - Math.PI / 2) * 41} ${50 + Math.sin((phase % 1) * Math.PI * 2 - Math.PI / 2) * 41}`,
        ),
      );
    if (pending && !pending.queued) {
      const p = pending;
      const onset = engine.dispatches.find(
        (d) =>
          d.revision >= p.revision &&
          d.begin >= p.first &&
          d.target <= engine.audioTime() &&
          (!target(p.id) ||
            String(
              d.value && typeof d.value === "object"
                ? Reflect.get(d.value, "__voice")
                : "",
            ) === target(p.id)?.voice.id),
      );
      if (onset) {
        pending = undefined;
        changeLog.push({ revision, state: "landed", cycle: phase });
        document
          .querySelectorAll(".pending")
          .forEach((el) => el.classList.remove("pending"));
        for (const id of ["#pending", "#editor-pending"]) {
          const el = document.querySelector(id);
          if (el) el.textContent = "● Change landed · first dispatched onset";
        }
      }
    }
  }
  requestAnimationFrame(tick);
}
Object.assign(window, {
  editorStudy: {
    get document() {
      return doc();
    },
    get events() {
      return events;
    },
    get errors() {
      return errors;
    },
    get busy() {
      return busy;
    },
    get selected() {
      return selected;
    },
    get pending() {
      return pending;
    },
    get source() {
      return generate(doc());
    },
    get changeLog() {
      return changeLog;
    },
    engine,
    choose,
    refresh,
    get targets() {
      return targets(doc());
    },
    setStudy: async (n: number) => {
      const f = fixtures.find(
        (f) => f.id === (n === 20 ? "twenty" : n === 8 ? "eight" : "three"),
      )!;
      const d = structuredClone(f.doc);
      d.voices[1]!.pattern = structuredClone(
        fixtures[3]!.doc.voices[1]!.pattern,
      );
      d.voices[2]!.pattern = structuredClone(
        fixtures[3]!.doc.voices[2]!.pattern,
      );
      d.voices[0]!.pattern.layers.push({ ...shell("slow", [1]), tier: 2 });
      engine.stop();
      history.set(d);
      selected = "";
      open = false;
      query = "";
      pending = undefined;
      cycle = 0;
      phase = 0;
      await refresh();
    },
    setCorpus: async (id: string) => {
      const f = corpusDocs.find((f) => f.id === id);
      if (!f) throw Error("No corpus piece");
      engine.stop();
      history.set(structuredClone(f.doc));
      piece = id;
      selected = "";
      rowOrder = [];
      open = false;
      cycle = 0;
      phase = 0;
      query = "";
      warning = f.warnings.join(" ");
      await refresh();
    },
    get corpus() {
      return corpusDocs.map((f) => f.id);
    },
    setFixture: async (id: string) => {
      const f = fixtures.find((f) => f.id === id);
      if (!f) throw Error("No fixture");
      engine.stop();
      history.set(structuredClone(f.doc));
      piece = id;
      cycle = 0;
      phase = 0;
      lastCycle = 0;
      selected = "";
      query = "";
      open = false;
      pending = undefined;
      zoom = Math.min(
        1,
        (window.innerWidth - (window.innerWidth > 650 ? 240 : 0)) /
          (window.innerWidth <= 650 ? 420 : 1260),
      );
      await refresh();
    },
  },
});
render();
refresh().catch(fail);
tick();
