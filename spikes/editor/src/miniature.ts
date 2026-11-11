import type { PlainEvent } from "./adapter";
export function eventValues(e: PlainEvent, name = ""): unknown[] {
  const v = e.value;
  const value =
    v && typeof v === "object"
      ? name
        ? Reflect.get(
            v,
            name === "lpf" ? "cutoff" : name === "hpf" ? "hcutoff" : name,
          )
        : (Reflect.get(v, "note") ??
          Reflect.get(v, "n") ??
          Reflect.get(v, "s") ??
          Reflect.get(v, "value"))
      : v;
  return Array.isArray(value) ? value : [value];
}
export function eventLanes(events: PlainEvent[], name = "") {
  const keys = [
    ...new Set(
      events.flatMap((e) =>
        eventValues(e, name)
          .filter((v) => v !== undefined)
          .map(String),
      ),
    ),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return {
    keys,
    parts: events.flatMap((e) =>
      eventValues(e, name).map((value) => ({
        event: e,
        value,
        track: Math.max(0, keys.indexOf(String(value))),
      })),
    ),
  };
}
export const shortValue = (x: unknown): string =>
  typeof x === "number" ? String(Number(x.toPrecision(4))) : String(x ?? "");
export function staticValue(
  p: import("../../import/src/document").Pattern,
): unknown {
  return p.core.kind === "constant"
    ? p.core.value
    : p.core.kind === "sequence" &&
        p.core.steps.length === 1 &&
        p.core.steps[0]?.kind === "value" &&
        !p.layers.length
      ? p.core.steps[0].value
      : undefined;
}
