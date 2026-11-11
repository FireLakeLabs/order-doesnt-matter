// Additional pinned-package surfaces used only by the no-audio host and import adapters.
declare module '@strudel/core' {
  export function stack(...patterns: Pattern[]): Pattern;
  export function createParams(...names: string[]): Record<string, unknown>;
  export function register(...args: unknown[]): unknown;
  export const strudelScope: Record<string, unknown>;
}
declare module '@strudel/mini' {
  export function miniAllStrings(): void;
}
declare module '@strudel/tonal';
declare module '@strudel/core/controls.mjs' {
  export function isControlName(name: string): boolean;
}
declare module '@strudel/mini/krill-parser.js' {
  export function parse(source: string): unknown;
}
