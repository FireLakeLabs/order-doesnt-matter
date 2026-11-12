import { voices, type Doc, type Pattern } from '../index';
import { freshIds } from './shared';
import { song, newSection, refuse } from './section-shared';
export function makeSections(doc: Doc) {
  if (song(doc)) return refuse('This piece already has sections');
  const roots = voices(doc);
  if (!roots.length) return refuse('Add a playable pattern before making sections');
  const fresh = freshIds(doc);
  const content: Pattern = {
    id: fresh('content'),
    tier: 1,
    core: {
      kind: 'group',
      how: 'stack',
      parts: roots.map((v) => ({ id: fresh('part'), pattern: v.pattern, muted: v.muted })),
    },
    layers: [],
  };
  const { definition, reference } = newSection(doc, undefined, content);
  const voice = {
    ...roots[0],
    muted: false,
    pattern: {
      id: fresh('song'),
      tier: 1 as const,
      core: {
        kind: 'group' as const,
        how: 'arrange',
        parts: [{ id: fresh('part'), cycles: 4, pattern: reference }],
      },
      layers: [],
    },
  };
  const last = doc.body.findLastIndex((n) => n.kind === 'voice');
  return {
    ...doc,
    body: doc.body.flatMap<Doc['body'][number]>((n, i) =>
      i === last ? [definition, voice] : n.kind === 'voice' ? [] : [n],
    ),
  };
}
