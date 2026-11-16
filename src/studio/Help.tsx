import { useEffect, useSyncExternalStore } from 'react';
import { CircleHelp, ArrowRight, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { practice } from './practice';
import { session } from './session';

const lessons = [
  [
    'Make it move',
    'Press Play in the top bar. The two stages dance to the same score.',
    '.play-button',
  ],
  [
    'Take it slow',
    'Try 1/2 Speed in the top bar. Window and Trails in the instrument rail change only the picture.',
    '.speed-control',
  ],
  [
    'Time is yours',
    'Drag the bright playhead in the scrub strip. Let go to carry on from there.',
    '.scrub-strip',
  ],
  [
    'Swap the scenery',
    'Pick a view for either stage. Drag a tile from the view shelf, or use a stage’s Views button.',
    '[data-region="stage-b"]',
  ],
  ['Pick your colours', 'Click a theme swatch in the top bar. Try a new mood.', '.theme-swatches'],
  [
    'Make a little change',
    'Pick an instrument in the rail or score. In the tray, open a setting and change it. Finish when you like. Undo is always in the top bar.',
    '[data-region="tray"]',
  ],
];
export function Help() {
  const state = useSyncExternalStore(practice.subscribe, practice.getSnapshot);
  useEffect(() => {
    if (!state.active) return;
    const target = document.querySelector(lessons[state.step][2]);
    target?.classList.add('tour-target');
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        document.querySelector('[role="dialog"]')
      )
        return;
      event.preventDefault();
      if (session.getSnapshot().editorTarget) session.openEditor(null);
      else practice.close();
    };
    window.addEventListener('keydown', escape);
    return () => {
      target?.classList.remove('tour-target');
      window.removeEventListener('keydown', escape);
    };
  }, [state.active, state.step]);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Help"
        onPointerDown={(event) => {
          event.preventDefault();
          practice.open();
        }}
        onClick={() => {
          practice.open();
        }}
      >
        <CircleHelp />
      </Button>
      <Dialog
        open={state.open}
        onOpenChange={(open) => {
          if (!open) practice.close();
        }}
      >
        <DialogContent className="help-dialog">
          <DialogHeader>
            <DialogTitle>Come play</DialogTitle>
            <DialogDescription>Six little moves to make Studio yours.</DialogDescription>
          </DialogHeader>
          <p>
            Practice on Kiln, an original example. Your piece, Undo, Redo and unfinished input wait
            here in memory. Practice never replaces your recovery. Returning keeps playback stopped.
          </p>
          <p>
            Use Paste for your code or an original. Keep work downloads a portable document or
            Strudel code. Select an instrument in the score to open its tray. Drag the strip to
            explore time, or Shift-drag to mark a loop.
          </p>
          <p>
            Ctrl or ⌘ Z undoes a score change. Add Shift to redo. Escape closes the editor or ends
            practice.
          </p>
          <div className="dialog-actions">
            <Button
              disabled={state.preparing}
              onClick={() => {
                void practice.start();
              }}
            >
              {state.preparing ? 'Getting ready…' : 'Start practice'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                practice.close();
              }}
            >
              Close help
            </Button>
          </div>
          <p role="status">{state.error}</p>
        </DialogContent>
      </Dialog>
      {state.active && (
        <aside className="practice-guide" aria-label="Guided practice">
          <header>
            <span>PLAYTIME · {state.step + 1} / 6</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="End practice"
              onClick={() => {
                practice.close();
              }}
            >
              <X />
            </Button>
          </header>
          <h2>{lessons[state.step][0]}</h2>
          <p>{lessons[state.step][1]}</p>
          <footer>
            <small>Your work is waiting safely.</small>
            <Button
              variant="outline"
              onClick={() => {
                practice.next();
              }}
            >
              {state.step === 5 ? 'Finish practice' : 'Skip step'}
              <ArrowRight />
            </Button>
          </footer>
        </aside>
      )}
    </>
  );
}
