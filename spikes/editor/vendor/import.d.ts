import type { Doc } from "../../import/src/document";
export { Doc };
export interface PlainEvent {
  whole: [number, number] | null;
  part: [number, number];
  value: unknown;
  hasOnset: boolean;
  cycle: number;
}
export interface EventResult {
  events: PlainEvent[];
  error: string | null;
  phase?: "evaluation" | "query" | "timeout";
  opaqueValues?: boolean;
}
export function importStrudel(source: string): { doc: Doc; warnings: string[] };
export function generate(doc: Doc): string;
export function queryEvents(
  source: string,
  fromCycle: number,
  toCycle: number,
): Promise<EventResult>;
