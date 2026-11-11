import type { Arg, Doc, Pattern } from "./document.ts";
import { printSteps } from "./mini.ts";

export function generate(doc: Doc): string {
  function literal(value: unknown): string {
    if (typeof value === "string")
      return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("\n", "\\n").replaceAll("\r", "\\r")}'`;
    if (Array.isArray(value)) return `[${value.map(literal).join(", ")}]`;
    if (value && typeof value === "object")
      return `{${Object.entries(value)
        .map(([k, v]) => `${literal(k)}: ${literal(v)}`)
        .join(", ")}}`;
    return JSON.stringify(value);
  }
  function argument(arg: Arg, hole?: string): string {
    switch (arg.kind) {
      case "literal":
        return literal(arg.value);
      case "pattern":
        return pattern(arg.pattern, hole);
      case "opaque":
        return arg.code;
      case "callback": {
        const parameter = arg.parameter ?? "p";
        return `${parameter} => ${pattern(arg.body, parameter)}`;
      }
    }
  }
  function pattern(p: Pattern, hole?: string): string {
    let text: string;
    const core = p.core;
    switch (core.kind) {
      case "sequence":
        text = JSON.stringify(printSteps(core.steps));
        break;
      case "constant":
        text = literal(core.value);
        break;
      case "data":
        text = literal(core.value);
        break;
      case "signal":
        text = core.shape;
        break;
      case "ref":
        text = core.name;
        break;
      case "hole":
        text = hole ?? "p";
        break;
      case "opaque":
        text = `(${core.code})`;
        break;
      case "generator":
        text = `${core.name}(${core.args.map((a) => argument(a, hole)).join(", ")})`;
        break;
      case "group":
        text = `${core.how}(${core.parts.map((part) => (core.how === "arrange" ? `[${part.cycles ?? 1}, ${pattern(part.pattern, hole)}]` : pattern(part.pattern, hole))).join(", ")})`;
        break;
    }
    // Strudel transpiles double-quoted mini strings itself. Numeric/data
    // receivers need pure() when chained; plain arguments stay plain.
    if (p.layers.length && ["constant", "data"].includes(core.kind))
      text = `pure(${text})`;
    for (const layer of p.layers) {
      if (layer.kind === "settings")
        for (const setting of layer.settings)
          text += `.${setting.name}(${pattern(setting.value, hole)})`;
      else if (layer.kind === "rewrite")
        text += `.${layer.name}(${layer.args.map((a) => argument(a, hole)).join(", ")})`;
      else text += layer.code;
    }
    return text;
  }
  const setup = (i: number) => doc.setup[i]?.code ?? "";
  const shared = (name: string) =>
    doc.shared[name] ? `const ${name} = ${pattern(doc.shared[name])};` : "";
  const voice = (i: number) => {
    const v = doc.voices[i];
    if (!v) return "";
    // Named-label routing is presentation metadata; every generated active
    // voice uses $:. .p() supplies the original name and muting to the REPL.
    const metadata = JSON.stringify({
      name: v.name,
      muted: v.muted,
    }).replaceAll("*/", "*\\/");
    return `${v.muted ? "_$" : "$"}: /*@odm-voice ${metadata}*/ ${pattern(v.pattern)};`;
  };
  const tempo = () => (doc.tempo ? `setcpm(${doc.tempo.cpm});` : "");
  const transform = (i: number) => {
    const t = doc.transforms?.[i];
    return t ? `all(${t.args.map((a) => argument(a)).join(", ")});` : "";
  };
  if (
    doc.setup.length === 1 &&
    !doc.voices.length &&
    !Object.keys(doc.shared).length &&
    !doc.tempo &&
    !doc.transforms?.length
  )
    return doc.setup[0].code;
  const lines: string[] = [];
  if (doc.order) {
    const emitted = {
      setup: new Set<number>(),
      shared: new Set<string>(),
      voice: new Set<number>(),
      transform: new Set<number>(),
      tempo: false,
    };
    for (const entry of doc.order)
      switch (entry.kind) {
        case "setup":
          if (!emitted.setup.has(entry.index)) lines.push(setup(entry.index));
          emitted.setup.add(entry.index);
          break;
        case "shared":
          if (!emitted.shared.has(entry.name)) lines.push(shared(entry.name));
          emitted.shared.add(entry.name);
          break;
        case "voice":
          if (!emitted.voice.has(entry.index)) lines.push(voice(entry.index));
          emitted.voice.add(entry.index);
          break;
        case "tempo":
          if (!emitted.tempo) lines.push(tempo());
          emitted.tempo = true;
          break;
        case "transform":
          if (!emitted.transform.has(entry.index))
            lines.push(transform(entry.index));
          emitted.transform.add(entry.index);
          break;
      }
    // Editors can append nodes without knowing the import-only execution map.
    if (!emitted.tempo && doc.tempo) lines.unshift(tempo());
    doc.setup.forEach((_, i) => {
      if (!emitted.setup.has(i)) lines.push(setup(i));
    });
    Object.keys(doc.shared).forEach((name) => {
      if (!emitted.shared.has(name)) lines.push(shared(name));
    });
    doc.voices.forEach((_, i) => {
      if (!emitted.voice.has(i)) lines.push(voice(i));
    });
    doc.transforms?.forEach((_, i) => {
      if (!emitted.transform.has(i)) lines.push(transform(i));
    });
  } else
    lines.push(
      tempo(),
      ...doc.setup.map((_, i) => setup(i)),
      ...Object.keys(doc.shared).map(shared),
      ...doc.voices.map((_, i) => voice(i)),
      ...(doc.transforms ?? []).map((_, i) => transform(i)),
    );
  return lines.filter(Boolean).join("\n") + "\n";
}
