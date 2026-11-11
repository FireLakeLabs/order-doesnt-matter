import {
  bounds,
  territory,
  type Detail,
  type System,
  type Room,
  type Satellite,
} from "./cosmos";
import { settingName, span } from "./scene";
import { staticValue, shortValue } from "./miniature";
export const escapeHtml = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
interface View {
  reducedMotion: boolean;
  cycle: number;
  phase: number;
  selected: string;
  solo: string;
  broken: Record<string, string>;
  sound: (id: string) => { state: string; text: string };
  buttons: (s: System) => string;
  pending?: string;
}
const text = (x: number, y: number, value: unknown, cls: string) =>
  `<text x="${x}" y="${y}" text-anchor="middle" class="${cls}">${escapeHtml(value)}</text>`;
function moonMarkup(
  n: Satellite,
  detail: Detail,
  view: View,
  nested = false,
): string {
  const value = staticValue(n.value),
    label = nested ? n.name : settingName(n.name);
  const nameY = n.children.length ? -n.r + 17 : -7;
  const reading =
    value !== undefined
      ? String(value)
      : n.value.core.kind === "signal"
        ? "∿ " + n.value.core.shape
        : n.value.core.kind === "sequence"
          ? n.value.core.notation || "steps"
          : n.value.core.kind === "group"
            ? n.value.core.how
            : n.value.core.kind === "generator"
              ? "rhythm"
              : "open driver";
  return `<g transform="translate(${n.x} ${n.y})" data-select="${n.id}" tabindex="0" role="button" aria-label="${escapeHtml(label)} ${escapeHtml(value ?? n.value.core.kind)}" class="system-moon ${nested ? "nested-moon" : ""} ${view.selected === n.id ? "selected" : ""}"><title>${escapeHtml(n.name)} · ${escapeHtml(value ?? n.value.core.kind)} · ${escapeHtml(n.value.layers.map((l) => (l.kind === "rewrite" ? l.name + "(" + l.args.map((a) => (a.kind === "literal" ? a.value : a.kind)).join(", ") + ")" : l.kind)).join(" · "))} · belongs to its enclosing disk</title><circle r="${n.r}"/>${text(0, nameY, label, "moon-name")}<text x="0" y="${nameY + 15}" text-anchor="middle" class="moon-reading" ${reading.length * 5 > Math.max(42, n.r * 1.8) ? `textLength="${Math.max(42, n.r * 1.8)}" lengthAdjust="spacingAndGlyphs"` : ""}>${escapeHtml(reading)}</text>${n.value.core.kind === "signal" ? `<text data-driver-value="${n.id}" x="0" y="${nameY + 29}" text-anchor="middle" class="live-value">∿</text>` : ""}${detail === "near" ? (n.shells ?? []).map((sh) => `<g data-select="${sh.id}" role="button" tabindex="0"><circle r="${sh.r}" class="shell"/><text y="${sh.r}" text-anchor="middle" class="rewrite-name">${escapeHtml(sh.name)}</text></g>`).join("") : ""}${detail === "near" ? n.children.map((c) => moonMarkup(c, detail, view, true)).join("") : n.children.length ? text(0, n.r - 8, `${n.children.length} nested · dive`, "moon-reading") : ""}</g>`;
}
export function systemMarkup(
  s: System,
  detail: Detail,
  view: View,
  from?: { x: number; y: number },
): string {
  const p = s.planet,
    far = detail === "far",
    sound = view.sound(p.id),
    broken = view.broken[p.voice],
    quiet = p.muted || (view.solo && view.solo !== p.id);
  const state = broken
    ? "⚠ BROKEN"
    : p.muted
      ? "Muted"
      : quiet
        ? "Solo elsewhere"
        : !p.active
          ? "Not in this section"
          : p.events.length
            ? "Scored onsets"
            : "Rest this cycle";
  const titleY = far ? -49 : -s.r + 17;
  const arc = (a: number, r: number) =>
    `${Math.cos(a * Math.PI * 2 - Math.PI / 2) * r} ${Math.sin(a * Math.PI * 2 - Math.PI / 2) * r}`;
  const face = `<g data-select="${p.id}" data-dive="${p.id}" tabindex="0" role="button" aria-label="${escapeHtml(p.name)} rhythm" class="planet-face ${p.tier === 3 ? "opaque" : ""}"><title>${escapeHtml(p.name)} · click to edit; double-click to dive</title><circle r="30" class="planet-skin"/><circle r="31" class="onset-pulse" data-pulse="${p.id}"/>${p.events
    .slice(0, 400)
    .map((e, j) => {
      let [a, b] = span(e, view.cycle);
      b = Math.min(b, a + 0.9999);
      const r = 22 - (j % 3) * 4;
      return `<path d="M${arc(a, r)}A${r} ${r} 0 ${b - a > 0.5 ? 1 : 0} 1 ${arc(b, r)}" class="event-arc"/>`;
    })
    .join(
      "",
    )}<path data-clock-hand="true" class="planet-clock" d="M0 -26 A26 26 0 0 1 1 -26" transform="rotate(${(view.phase % 1) * 360})"/>${broken ? text(0, 4, "!", "broken-glyph") : ""}</g>`;
  return `<g class="planet system ${p.active ? "" : "inactive"} ${quiet ? "quiet" : ""} ${view.pending === p.voice ? "pending" : ""}" data-instrument="${p.id}" data-muted="${p.muted}" transform="translate(${s.x} ${s.y})">${!view.reducedMotion && from && (from.x !== s.x || from.y !== s.y) ? `<animateTransform attributeName="transform" type="translate" from="${from.x} ${from.y}" to="${s.x} ${s.y}" dur=".7s" calcMode="spline" keySplines=".2 0 .2 1" keyTimes="0;1"/>` : ""}${
    !far
      ? `<circle r="${s.outer}" class="ownership-orbit"/>${s.shells
          .map((sh, j) => {
            const angle = Math.PI / 2 + ((j % 3) - 1) * 0.48,
              x = Math.cos(angle) * sh.r,
              y = Math.sin(angle) * sh.r;
            return `<g data-select="${sh.id}" role="button" tabindex="0" aria-label="${escapeHtml(p.name)} rewrite ${escapeHtml(sh.name)}"><circle r="${sh.r}" class="shell"/><text x="${x}" y="${y + 3}" text-anchor="middle" class="rewrite-name">${escapeHtml(sh.name)}</text></g>`;
          })
          .join("")}${s.moons.map((n) => moonMarkup(n, detail, view)).join("")}`
      : ""
  }${face}${text(0, titleY, p.name, "system-name")}${text(0, titleY + 16, state, "system-state planet-state " + (broken ? "broken-glyph" : ""))}<text x="0" y="${far ? 47 : s.r - 30}" text-anchor="middle" data-sound-state="${sound.state}" class="system-sound"><title>${escapeHtml(sound.text)}</title>${escapeHtml(far ? (sound.state === "ready" ? "Ready" : sound.state === "missing" ? "⚠ Missing" : "Loading") : sound.text.length > 34 ? sound.text.slice(0, 33) + "…" : sound.text)}</text><foreignObject x="-58" y="${far ? 51 : s.r - 23}" width="116" height="26"><div xmlns="http://www.w3.org/1999/xhtml" class="planet-actions">${view.buttons(s)}</div></foreignObject></g>`;
}
export function roomsMarkup(rooms: Room[], systems: System[]): string {
  return rooms
    .map((r, index) => {
      const members = systems.filter((s) => r.members.includes(s.planet.id)),
        b = bounds(members.map((s) => ({ ...s, r: s.r + 16 }))),
        hue = [160, 255, 37, 200][index % 4];
      const points = territory(members);
      const label = `ROOM ${r.id}${r.conflict ? " · conflict" : ""}`;
      const settings = r.settings.join(" · ") || "shared defaults";
      return `<g class="room-territory ${r.conflict ? "conflict" : ""}" style="--room-hue:${hue}" data-room="${r.id}" data-members="${r.members.join(" ")}"><title>${escapeHtml(label)} · ${escapeHtml(settings)}</title><path d="${points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ")}Z" class="room-wash"/><text x="${b.x + 12}" y="${b.y - 17}" class="territory-label">${escapeHtml(label)}</text><text x="${b.x + 12}" y="${b.y - 4}" class="territory-settings">${escapeHtml(settings.length > 70 ? settings.slice(0, 69) + "…" : settings)}</text></g>`;
    })
    .join("");
}
export type { View };
