import type { Doc } from "./document.ts";
import type { EventResult } from "./query.ts";
/** Canonical JSON: event bags are unordered, event multiplicity is retained. */
export function stable(value: unknown): string {
  function sorted(value: unknown): unknown {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(sorted);
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sorted(v)]),
    );
  }
  return JSON.stringify(sorted(value));
}
export function documentIdentity(doc: Doc): string {
  function clean(value: unknown): unknown {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(clean);
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => k !== "id" && k !== "span")
        .map(([k, v]) => [k, clean(v)]),
    );
  }
  return stable(clean(doc));
}
export function eventIdentity(result: EventResult): string {
  return stable({
    error: result.error,
    phase: result.phase,
    events: result.events.map(stable).sort(),
  });
}
