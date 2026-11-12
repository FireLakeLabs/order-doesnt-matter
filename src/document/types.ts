export type JsonValue =
  | null
  | number
  | string
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };
export type Tier = 1 | 2 | 3;
export type Role =
  | 'instrument'
  | 'setting'
  | 'rhythm'
  | 'rewrite'
  | 'section'
  | 'driver'
  | 'argument'
  | 'setup';
export interface Meta {
  id: string;
  tier: Tier;
  role?: Role;
  span?: { start: number; end: number };
}
export interface Doc {
  version: 2;
  body: TopLevel[];
}
export type TopLevel =
  | (Meta & { kind: 'setup'; code: string })
  | (Meta & { kind: 'tempo'; cpm: number })
  | (Meta & {
      kind: 'shared';
      name: string;
      nameSource: 'author' | 'generated';
      purpose?: 'instrument' | 'section' | 'value';
      pattern: Pattern;
    })
  | Voice
  | (Meta & { kind: 'transform'; name: 'all'; args: Arg[] });
export interface Voice extends Meta {
  kind: 'voice';
  name: string;
  nameSource: 'author' | 'generated';
  muted: boolean;
  pattern: Pattern;
}
export interface Pattern extends Meta {
  origin?: string;
  label?: string;
  comment?: string;
  muted?: boolean;
  core: Core;
  layers: Layer[];
}
export interface GroupPart {
  id: string;
  labelSource?: 'author' | 'generated';
  pattern: Pattern;
  cycles?: number;
  label?: string;
  muted?: boolean;
}
export type Core =
  | { kind: 'sequence'; steps: Step[]; notation: string }
  | { kind: 'signal'; shape: string; args?: Arg[] }
  | { kind: 'constant'; value: number | string | boolean }
  | { kind: 'data'; value: JsonValue }
  | { kind: 'group'; how: string; parts: GroupPart[] }
  | { kind: 'generator'; name: string; args: Arg[] }
  | { kind: 'ref'; name: string }
  | { kind: 'hole' }
  | { kind: 'opaque'; code: string };
export type Step =
  | { kind: 'value'; value: string; weight?: number; repeat?: number; chance?: number }
  | { kind: 'rest'; weight?: number; was?: string }
  | { kind: 'sub'; steps: Step[]; weight?: number }
  | { kind: 'alternate'; steps: Step[] }
  | { kind: 'together'; steps: Step[] }
  | { kind: 'euclid'; step: Step; pulses: Step; steps: Step; rotation?: Step }
  | { kind: 'polymeter'; steps: Step[]; per?: Step }
  | { kind: 'choose'; steps: Step[] }
  | { kind: 'other'; notation: string };
export type Layer = SettingsLayer | RewriteLayer | OpaqueLayer;
export interface SettingsLayer extends Meta {
  kind: 'settings';
  settings: Setting[];
}
export interface Setting extends Meta {
  name: string;
  value: Pattern;
}
export interface RewriteLayer extends Meta {
  kind: 'rewrite';
  name: string;
  args: Arg[];
}
export interface OpaqueLayer extends Meta {
  kind: 'opaque';
  code: string;
}
export type Arg = { name?: string } & (
  | { kind: 'literal'; value: JsonValue }
  | { kind: 'pattern'; pattern: Pattern }
  | { kind: 'callback'; body: Pattern; parameter?: string }
  | { kind: 'opaque'; code: string }
);

/** Every addressable serialized node, including a group occurrence. */
export type DocumentNode = Meta | GroupPart;
