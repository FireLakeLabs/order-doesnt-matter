import type { Doc } from '../document';
import type { Target } from '../document/edit';
import type { EventResult, SheetSoundState } from '../contract';
export interface EditorContext {
  /** Optional app controls; document editors can also be mounted independently. */
  instrument?: {
    sounds: SheetSoundState[];
    solo: string | null;
    setSolo(id: string | null): void;
  };
  doc: Doc;
  target: Target;
  events?: EventResult;
  window: { fromCycle: number; toCycle: number };
  /** Replace the document. Same gesture string = one undo step and coalesced swaps. */
  apply(next: Doc, options?: { gesture?: string }): void;
  pending: 'none' | 'pending' | 'failed';
}
export interface EditorKind {
  id: string;
  /** Higher wins when several match. The read-only fallback is 0. */
  priority: number;
  matches(target: Target): boolean;
  mount(
    body: HTMLElement,
    context: EditorContext,
  ): { update(context: EditorContext): void; destroy(): void };
}
