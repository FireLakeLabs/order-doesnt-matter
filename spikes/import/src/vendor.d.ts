declare module "@strudel/core/controls.mjs" {
  export const isControlName: (name: string) => boolean;
}
declare module "@strudel/core/state.mjs" {
  export default class State {
    constructor(span: unknown, controls?: unknown);
  }
}
declare module "@strudel/core/timespan.mjs" {
  export default class TimeSpan {
    constructor(from: number, to: number);
  }
}
declare module "@strudel/mini/krill-parser.js" {
  export function parse(source: string): unknown;
}

declare module "@strudel/core/pattern.mjs" {
  export class Pattern {}
}
