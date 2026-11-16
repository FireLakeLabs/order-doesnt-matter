import type { EditorKind } from '../../editor/kind';

/** Park the actual imperative body and closures, including unsubmitted drafts. */
export interface MountedEditor {
  id: string;
  kind: EditorKind;
  handle: ReturnType<EditorKind['mount']>;
  element: HTMLDivElement;
}
export let editorFrozen = false;
let active: (() => void) | undefined;
let parked: MountedEditor | undefined;
let restoring = false;
export function freezeEditor(value: boolean) {
  editorFrozen = value;
}
export function registerEditor(park: () => void) {
  active = park;
  return () => {
    if (active === park) active = undefined;
  };
}
export function parkEditor() {
  active?.();
}
export function holdEditor(value: MountedEditor) {
  parked = value;
  restoring = false;
  value.element.remove();
}
export function restoreEditor() {
  restoring = true;
}
export function takeEditor(id: string, kind: EditorKind) {
  // Practice can have identical node ids to the visitor's piece.
  if (!restoring || parked?.id !== id || parked.kind !== kind) return undefined;
  const value = parked;
  parked = undefined;
  restoring = false;
  return value;
}
