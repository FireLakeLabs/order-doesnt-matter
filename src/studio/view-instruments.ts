import { walk, type Doc } from '../document';
import { describeTarget } from '../document/edit';
import { sheetModel } from '../sheet/model';
import type { ViewInstrument, ViewSetting } from '../views/types';

type Facts = Pick<ViewInstrument, 'settings' | 'rewrites' | 'room'>;
export interface InstrumentSetting extends ViewSetting {
  nodeId: string;
  sectionId?: string;
}
export interface InstrumentRewrite {
  nodeId: string;
  name: string;
  label: string;
  source: boolean;
  sectionId?: string;
}
export interface InstrumentDetails {
  settings: InstrumentSetting[];
  rewrites: InstrumentRewrite[];
}
const detailsCache = new WeakMap<Doc, Map<string, InstrumentDetails>>();
const factsCache = new WeakMap<Doc, Map<string, Facts>>();
const labels: Record<string, string> = {
  rhythm: 'Rhythm',
  note: 'Notes',
  n: 'Notes',
  freq: 'Frequency',
  s: 'Sound',
  lpf: 'Cutoff',
  cutoff: 'Cutoff',
  hpf: 'High pass',
  hcutoff: 'High pass',
  gain: 'Level',
  resonance: 'Resonance',
  lpq: 'Resonance',
  shape: 'Drive',
  room: 'Reverb',
  roomsize: 'Room size',
  size: 'Room size',
  pan: 'Pan',
  delay: 'Delay',
  delaytime: 'Delay time',
  delayfeedback: 'Delay feedback',
  attack: 'Attack',
  release: 'Release',
  decay: 'Decay',
  sustain: 'Sustain',
  speed: 'Speed',
  orbit: 'Room',
  fmi: 'FM amount',
  fm: 'FM amount',
};
export const plainName = (name: string) => labels[name] ?? name.replace(/([a-z])([A-Z])/g, '$1 $2');

/** One document inventory for views and editing. The sheet owns settings-in-use
 * and rewrite order; target addresses and occurrence scope stay in this host. */
export function instrumentDetails(doc: Doc | null): Map<string, InstrumentDetails> {
  if (!doc) return new Map();
  const cached = detailsCache.get(doc);
  if (cached) return cached;
  const order = new Map<string, number>();
  walk(doc, (node) => order.set(node.id, order.size));
  const sheet = sheetModel({
    doc,
    fromCycle: 0,
    toCycle: 1,
    events: {},
    sounds: [],
    playhead: null,
  });
  const result = new Map<string, InstrumentDetails>();
  for (const row of sheet.rows) {
    const entries = row.cells
      .filter((cell) => cell.name !== 'rhythm' && cell.kind !== 'unused')
      .map((cell) => ({ nodeId: cell.nodeId, name: cell.name }));
    const rewrites: InstrumentRewrite[] = row.rewrites.map((chip) => ({
      nodeId: chip.nodeId,
      name: chip.name,
      label: `${chip.name} ${chip.summary}`.trim(),
      source: chip.source,
    }));
    const seen = new Set([...entries, ...rewrites].map((entry) => entry.nodeId));
    for (const use of row.useTargets) {
      if (seen.has(use.nodeId)) continue;
      seen.add(use.nodeId);
      const target = describeTarget(doc, use.nodeId);
      if (target.node && 'value' in target.node)
        entries.push({ nodeId: use.nodeId, name: target.control });
      else
        rewrites.push({
          nodeId: use.nodeId,
          name:
            target.node && 'name' in target.node && typeof target.node.name === 'string'
              ? target.node.name
              : 'Source text',
          label: use.text.replace(/^in .*?: /, ''),
          source: target.kind === 'source',
          sectionId: target.section?.id,
        });
    }
    entries.sort((a, b) => (order.get(a.nodeId) ?? -1) - (order.get(b.nodeId) ?? -1));
    const settings = entries.map((entry): InstrumentSetting => {
      const target = describeTarget(doc, entry.nodeId);
      const kind =
        target.kind === 'setting-constant'
          ? 'constant'
          : target.kind === 'setting-values'
            ? 'values'
            : target.kind === 'setting-signal'
              ? 'signal'
              : 'other';
      return {
        ...entry,
        label: plainName(entry.name),
        kind,
        sectionId: target.section?.id,
        ...(kind === 'constant' &&
        (typeof target.value === 'number' || typeof target.value === 'string')
          ? { value: target.value }
          : {}),
      };
    });
    result.set(row.id, { settings, rewrites });
  }
  detailsCache.set(doc, result);
  return result;
}

/** Overview collapses occurrence targets into one setting in use. Section
 * variations must not advertise a definition's constant as universal. */
export function instrumentFacts(doc: Doc | null): Map<string, Facts> {
  if (!doc) return new Map();
  const cached = factsCache.get(doc);
  if (cached) return cached;
  const facts = new Map<string, Facts>();
  for (const [id, details] of instrumentDetails(doc)) {
    const settings = new Map<string, ViewSetting>();
    for (const setting of details.settings) {
      let kind = setting.kind;
      const previous = settings.get(setting.name);
      if (previous) {
        if (previous.kind === 'signal' || kind === 'signal') kind = 'signal';
        else if (
          previous.kind === 'values' ||
          (kind === 'constant' && previous.value !== setting.value)
        )
          kind = 'values';
      }
      settings.set(setting.name, {
        name: setting.name,
        label: setting.label,
        kind,
        ...(kind === 'constant' && setting.value !== undefined ? { value: setting.value } : {}),
      });
    }
    const orbit = settings.get('orbit');
    const room =
      orbit?.kind === 'constant' && typeof orbit.value === 'number'
        ? orbit.value
        : orbit
          ? null
          : 1;
    facts.set(id, {
      settings: [...settings.values()],
      rewrites: details.rewrites
        .filter((rewrite) => !rewrite.source)
        .map((rewrite) => rewrite.label),
      room,
    });
  }
  factsCache.set(doc, facts);
  return facts;
}
