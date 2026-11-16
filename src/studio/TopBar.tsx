import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Pause, Play, Square, StepBack, StepForward, Repeat2, Undo2, Redo2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog';
import type { StudioClock } from './clock';
import type { StudioSnapshot } from './store';
import { speeds } from './transport';
import { runtime } from './runtime';
import { themeNames, resolveTheme } from './themes';
import { dependencies } from '../../package.json';
import { PasteProgram } from './PasteProgram';
import { KeepWork } from './KeepWork';
import { Help } from './Help';
import { session } from './session';

declare const __BUILD_SHA__: string | null;
const repository = 'https://github.com/FireLakeLabs/order-doesnt-matter';
const strudelSource = (name: string, version: string) =>
  `https://codeberg.org/uzu/strudel/src/tag/${encodeURIComponent(`${name === 'superdough' ? name : `@strudel/${name}`}@${version}`)}`;
export function TopBar({
  clock,
  snapshot,
  theme,
  setTheme,
}: {
  clock: StudioClock;
  snapshot: StudioSnapshot;
  theme: string;
  setTheme: (name: string) => void;
}) {
  const { state, canPlay } = snapshot;
  const { editorTarget } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const time = useSyncExternalStore(runtime.transport.subscribe, runtime.transport.getSnapshot);
  const cycle = useRef<HTMLOutputElement>(null);
  const tempo = useRef<HTMLElement>(null);
  useEffect(
    () =>
      clock.subscribe(({ now, cps }) => {
        if (cycle.current) cycle.current.textContent = `cycle ${now.toFixed(2)}`;
        if (tempo.current) tempo.current.textContent = String(Math.round(cps * 240));
      }),
    [clock],
  );
  return (
    <header className="top-bar" data-region="top-bar">
      <h1>
        ORDER DOESN’T MATTER <span>STUDIO</span>
      </h1>
      <div className="transport">
        <Button
          className="play-button"
          disabled={!canPlay}
          onClick={() => {
            if (state.playing) runtime.pause();
            else void runtime.play();
          }}
        >
          {state.playing ? <Pause /> : <Play />}
          {state.playing ? 'Pause' : 'Play'}
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Stop"
          onClick={() => {
            runtime.stop();
          }}
        >
          <Square />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Step back one beat"
          disabled={state.playing || time.scrubbing}
          onClick={() => {
            runtime.step(-1);
          }}
        >
          <StepBack />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Step forward one beat"
          disabled={state.playing || time.scrubbing}
          onClick={() => {
            runtime.step(1);
          }}
        >
          <StepForward />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={time.loop ? 'Clear loop' : 'Mark loop'}
          title={
            time.loop
              ? `Loop cycles ${String(time.loop.from)}–${String(time.loop.to)}; click to clear`
              : 'Mark loop: drag across the strip (or Shift-drag anytime)'
          }
          aria-pressed={!!time.loop || time.marking}
          onClick={() => {
            runtime.toggleLoop();
          }}
        >
          <Repeat2 />
        </Button>
      </div>
      <div className="speed-control" aria-label="Speed">
        <span>Speed</span>
        {speeds.map((speed, i) => (
          <button
            key={speed}
            aria-label={`Speed ${String(speed)}`}
            aria-pressed={time.speed === speed}
            onClick={() => {
              runtime.setSpeed(speed);
            }}
          >
            {['1/4', '1/2', '3/4', '1×'][i]}
          </button>
        ))}
      </div>
      <output className="tempo">
        <span ref={tempo} /> <small>BPM</small>
        {time.speed !== 1 && (
          <small className="written">written at {Math.round((state.cps ?? 0.5) * 240)}</small>
        )}
      </output>
      <output ref={cycle} className="cycle-readout" aria-label="Cycle" />
      <Button
        variant="ghost"
        size="icon"
        aria-label="Undo"
        disabled={!runtime.app.editor?.canUndo}
        onClick={() => runtime.app.editor?.undo()}
      >
        <Undo2 />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Redo"
        disabled={!runtime.app.editor?.canRedo}
        onClick={() => runtime.app.editor?.redo()}
      >
        <Redo2 />
      </Button>
      <PasteProgram
        active={!runtime.app.practice}
        disabled={!!editorTarget}
        error={state.loadError}
      />
      {runtime.app.practice && (
        <PasteProgram key="practice" active disabled={!!editorTarget} error={state.loadError} />
      )}
      <KeepWork />
      <Help />
      {!!state.warnings.length && (
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost">Notes ({state.warnings.length})</Button>
          </DialogTrigger>
          <DialogContent className="notes-dialog">
            <DialogHeader>
              <DialogTitle>Notes about this piece</DialogTitle>
              <DialogDescription>
                Code stays in your piece, including the parts we do not model.
              </DialogDescription>
            </DialogHeader>
            <ul>
              {state.warnings.map((warning, i) => (
                <li key={i}>{warning.message}</li>
              ))}
            </ul>
          </DialogContent>
        </Dialog>
      )}
      <span
        className="top-message"
        title={
          state.loadError ||
          state.message ||
          (runtime.app.retention.notice.includes('could not') ? runtime.app.retention.notice : '')
        }
        role="status"
      >
        {state.loadError ||
          state.message ||
          (runtime.app.retention.notice.includes('could not') ? runtime.app.retention.notice : '')}
      </span>
      <div className="theme-swatches" aria-label="Themes">
        {themeNames.map((name) => (
          <button
            key={name}
            title={name}
            aria-label={`Theme ${name}`}
            aria-pressed={theme === name}
            style={{ background: resolveTheme(name).accent }}
            onClick={() => {
              setTheme(name);
            }}
          />
        ))}
      </div>
      <nav className="source-links">
        <a href={repository} target="_blank" rel="noopener">
          Our source
        </a>
        <a href={strudelSource('web', dependencies['@strudel/web'])} target="_blank" rel="noopener">
          Strudel {dependencies['@strudel/web']} source
        </a>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="link">About / AGPL</Button>
          </DialogTrigger>
          <DialogContent className="about-notice">
            <DialogHeader>
              <DialogTitle>About Order Doesn't Matter</DialogTitle>
              <DialogDescription>
                A visual instrument for Strudel. Read and edit a program's score, and follow its
                cycles.
              </DialogDescription>
            </DialogHeader>
            <p>
              Made by Fire Lake Labs. Our own source code is MIT licensed. This app includes Strudel
              and other software under AGPL-3.0-or-later and other licences. The app as distributed
              is provided under the AGPL terms. You may use, share and modify it under those terms.
              It comes with no warranty.
            </p>
            <p>
              <a
                href={`${repository}/tree/${__BUILD_SHA__ ?? 'main'}`}
                target="_blank"
                rel="noopener"
              >
                Source for this version
              </a>
            </p>
            <small>
              {__BUILD_SHA__
                ? `Commit ${__BUILD_SHA__}`
                : 'Build commit unavailable; this link opens the main branch.'}
            </small>
            <a href="/licenses.txt" target="_blank" rel="noopener">
              Full licence texts and third-party notices
            </a>
            <p>
              <a href="https://strudel.cc" target="_blank" rel="noopener">
                Visit Strudel
              </a>
            </p>
            <p>Strudel's corresponding source for our pinned versions:</p>
            <ul>
              {['core', 'mini', 'tonal', 'transpiler', 'web', 'webaudio', 'superdough'].map(
                (name) => {
                  const packageName = name === 'superdough' ? name : `@strudel/${name}`;
                  const version = dependencies[packageName as keyof typeof dependencies];
                  return (
                    <li key={name}>
                      <a href={strudelSource(name, version)} target="_blank" rel="noopener">
                        {name === 'superdough' ? name : `@strudel/${name}`}@{version}
                      </a>
                    </li>
                  );
                },
              )}
            </ul>
          </DialogContent>
        </Dialog>
      </nav>
    </header>
  );
}
