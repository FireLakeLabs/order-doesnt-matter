import { instruments, sections, walk, type Doc } from '../../document';
import { describeTarget } from '../../document/edit';

/** Kiln's authored instrument and actual arrange uses, independent of generated IDs. */
export function kilnTargets(doc: Doc) {
  const bass = instruments(doc).find((row) => row.name.replaceAll('$', '') === 'bass');
  if (!bass) return null;
  let cutoff: string | undefined;
  walk(doc, (node) => {
    if ('name' in node && ['lpf', 'cutoff'].includes(String(node.name)) && 'value' in node) {
      const target = describeTarget(doc, node.id);
      if (target.instrumentId === bass.id && target.kind === 'setting-constant') cutoff = node.id;
    }
  });
  const uses = sections(doc).filter((section) => section.instrumentIds.includes(bass.id));
  return cutoff && uses.length >= 2
    ? { bass: bass.id, cutoff, first: uses[0], next: uses[1] }
    : null;
}
export const lessons = [
  [
    'Load a piece',
    'Choose Kiln, an original example. Originals or pasted Strudel become a score. You do not need to read the code.',
  ],
  [
    'Play and stop',
    'Press Play. Stop stays above the score. Tempo is in cycles per minute. You can retry Play after an error, or continue stopped.',
  ],
  [
    'Read the score',
    'Choose the first section containing bass (Section 2). Rows are instruments; columns are settings. Marks show real note spans, not a step grid.',
  ],
  [
    'Change a setting',
    'Open bass lpf (cutoff) and change its value from 700 Hz. One editor stays in the page. Changing… tracks scheduling, not proof of audibility. Rhythm has its own editor; Edit as source is always available.',
  ],
  [
    'Undo',
    'Press Done, then Undo to restore 700 Hz. Back only revisits guidance; it does not reverse edits.',
  ],
  [
    'Sections and Follow',
    'Choose the next section containing bass (Section 3), then Follow. Editing can stay pinned while Now and Watch follow playback. Stopped, Follow waits for playback.',
  ],
  [
    'Now and Watch',
    'Enlarge Now, then Close. Repeat with Watch. Now shows instruments; Watch shows scored cycles. Both pause when stopped. Settings live in the score.',
  ],
  [
    'Keep your work',
    'Open Keep work. Recovery keeps one latest document in this browser on this device; browser clearing can remove it. Download document keeps portable JSON; Export Strudel generates fresh code. Open document replaces work after confirmation. Practice is not saved. Downloads here are optional practice copies.',
  ],
] as const;
