import type { SongSection } from '../document';

function sectionAt(sections: SongSection[], cycle: number) {
  const total = sections.at(-1);
  const length = total ? total.start + total.cycles : 0;
  const offset = length ? Math.floor(Math.max(0, cycle) / length) * length : 0;
  return {
    offset,
    section: sections.find((s) => cycle - offset >= s.start && cycle - offset < s.start + s.cycles),
  };
}

export function contextLabels(sections: SongSection[], from: number, cycle: number | null) {
  const editing = sectionAt(sections, from).section;
  const at = Math.max(0, cycle ?? from);
  const { section, offset } = sectionAt(sections, at);
  const start = section ? offset + section.start : Math.floor(at / 4) * 4;
  const end = start + (section?.cycles ?? 4);
  const window = `${section ? `${section.name} · ` : ''}cycles ${start}–${end}`;
  return {
    editing: `Editing${editing ? ` ${editing.name}` : ' score'}`,
    playback: cycle === null ? `Playback paused · preview ${window}` : `Playing ${window}`,
  };
}
