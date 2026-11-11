import { parse } from "@strudel/mini/krill-parser.js";
import type { Step } from "./document.ts";

// PEG output boundary. Only fields inspected below are required; unknown
// operators survive as Step.other rather than losing any mini syntax.
interface MiniNode {
  type_: string;
  source_?: string | MiniNode | MiniNode[];
  arguments_?: { alignment?: string };
  options_?: {
    weight?: number;
    reps?: number;
    ops?: { type_: string; arguments_: { amount?: number | null } }[];
  };
  location_?: { start: { offset: number }; end: { offset: number } };
}
function miniNode(value: unknown): MiniNode {
  if (
    !value ||
    typeof value !== "object" ||
    !("type_" in value) ||
    typeof value.type_ !== "string"
  )
    throw Error("Invalid Strudel mini AST");
  return value as MiniNode;
}
export function parseSteps(notation: string): Step[] {
  // This is exactly the quoted-string input used by Strudel's mini2ast.
  const quoted = JSON.stringify(notation);
  const root = miniNode(parse(quoted));
  const raw = (n: MiniNode) =>
    n.location_
      ? quoted.slice(n.location_.start.offset, n.location_.end.offset).trim()
      : notation;
  function step(n: MiniNode): Step {
    if (n.type_ === "atom")
      return n.source_ === "~"
        ? { kind: "rest" }
        : { kind: "value", value: String(n.source_) };
    if (
      n.type_ === "element" &&
      n.source_ &&
      !Array.isArray(n.source_) &&
      typeof n.source_ === "object"
    ) {
      const ops = n.options_?.ops ?? [];
      if (ops.some((o) => !["replicate", "degradeBy"].includes(o.type_)))
        return { kind: "other", notation: raw(n) };
      const child = step(n.source_);
      if (child.kind === "other") return { kind: "other", notation: raw(n) };
      const weight = n.options_?.weight ?? 1,
        repeat = n.options_?.reps ?? 1;
      if (
        (weight !== 1 || repeat !== 1 || ops.length) &&
        child.kind !== "value" &&
        child.kind !== "rest" &&
        child.kind !== "sub"
      )
        return { kind: "other", notation: raw(n) };
      if (
        child.kind === "value" ||
        child.kind === "rest" ||
        child.kind === "sub"
      ) {
        if (weight !== repeat) child.weight = weight;
        if (repeat !== 1) {
          if (child.kind !== "value")
            return { kind: "other", notation: raw(n) };
          child.repeat = repeat;
        }
        const chance = ops.find((o) => o.type_ === "degradeBy");
        if (chance) {
          if (child.kind !== "value")
            return { kind: "other", notation: raw(n) };
          child.chance = chance.arguments_.amount ?? 0.5;
        }
      }
      return child;
    }
    if (n.type_ === "pattern" && Array.isArray(n.source_)) {
      const alignment = n.arguments_?.alignment;
      if (alignment === "fastcat")
        return { kind: "sub", steps: n.source_.map(step) };
      if (alignment === "polymeter_slowcat" || alignment === "stack") {
        const children = n.source_.flatMap((c) =>
          c.type_ === "pattern" &&
          c.arguments_?.alignment === "fastcat" &&
          Array.isArray(c.source_) &&
          (alignment === "polymeter_slowcat" || c.source_.length === 1)
            ? c.source_.map(step)
            : [step(c)],
        );
        return {
          kind: alignment === "stack" ? "together" : "alternate",
          steps: children,
        };
      }
      return { kind: "other", notation: raw(n) };
    }
    return { kind: "other", notation: raw(n) };
  }
  return root.type_ === "pattern" &&
    root.arguments_?.alignment === "fastcat" &&
    Array.isArray(root.source_)
    ? root.source_.map(step)
    : [step(root)];
}
export function printSteps(steps: Step[]): string {
  const one = (s: Step): string => {
    let text: string;
    switch (s.kind) {
      case "value":
        text = s.value;
        break;
      case "rest":
        text = "~";
        break;
      case "sub":
        text = `[${printSteps(s.steps)}]`;
        break;
      case "alternate":
        return `<${printSteps(s.steps)}>`;
      case "together":
        return `[${s.steps.map(one).join(",")}]`;
      case "other":
        return s.notation;
    }
    if ("weight" in s && s.weight !== undefined) text += `@${s.weight}`;
    if (s.kind === "value" && s.repeat !== undefined) text += `!${s.repeat}`;
    if (s.kind === "value" && s.chance !== undefined)
      text += s.chance === 0.5 ? "?" : `?${s.chance}`;
    return text;
  };
  return steps.map(one).join(" ");
}
