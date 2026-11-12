import type { Doc } from '../document';
import type { Target } from '../document/edit';
import type { EventResult } from '../contract';
export interface EditorContext {
  doc: Doc;
  target: Target;
  events?: EventResult;
  window: { fromCycle: number; toCycle: number };
  /** Replace the document. Same gesture string = one undo step and coalesced swaps. */
  apply(next: Doc, options?: { gesture?: string; selection?: string }): void;
  /** Ask about a hypothetical document over the current window, with a worker budget. */
  ask?(doc: Doc, instrumentId: string): Promise<EventResult>;
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
