import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pause, Play, Square, ClipboardPaste, StepBack, StepForward, Repeat2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog';
import type { StudioSnapshot } from './store';
import { speeds } from './transport';
import { runtime } from './runtime';
import { themeNames, resolveTheme } from './themes';

declare const __BUILD_SHA__: string | null;
const repository = 'https://github.com/FireLakeLabs/order-doesnt-matter';
const strudelSource = (name: string, version: string) =>
  `https://codeberg.org/uzu/strudel/src/tag/${encodeURIComponent(`${name === 'superdough' ? name : `@strudel/${name}`}@${version}`)}`;
export function TopBar({
  snapshot,
  theme,
  setTheme,
}: {
  snapshot: StudioSnapshot;
  theme: string;
  setTheme: (name: string) => void;
}) {
  const { state, canPlay } = snapshot;
  const time = useSyncExternalStore(runtime.transport.subscribe, runtime.transport.getSnapshot);
  const cycle = useRef<HTMLOutputElement>(null);
  useEffect(() => {
    let handle: number;
    const tick = () => {
      if (cycle.current) cycle.current.textContent = `cycle ${runtime.getPlayhead().toFixed(2)}`;
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(handle);
    };
  }, []);
  const [source, setSource] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const load = async () => {
    setImporting(true);
    try {
      await runtime.load(source);
      if (!runtime.app.state.loadError) setPasteOpen(false);
    } finally {
      setImporting(false);
    }
  };
  return (
    <header className="top-bar" data-region="top-bar">
      <style>{`
        .top-bar { gap: 12px; }
        .top-bar h1 { font-size: 13px; }
        .top-bar .transport { gap: 4px; }
        .top-bar .transport button { width: 32px; height: 32px; }
        .top-bar .transport .play-button { width: auto; }
        .speed-control { display: flex; align-items: center; gap: 3px; white-space: nowrap; font-size: 11px; }
        .speed-control span { color: var(--muted); margin-right: 5px; }
        .speed-control button { padding: 4px 7px; border: 1px solid var(--line); border-radius: var(--radius); font-family: var(--font-mono), monospace; }
        .speed-control button[aria-pressed=true], .transport button[aria-pressed=true] { background: var(--accent); color: var(--ground); }
        .tempo { font-size: 13px; line-height: 15px; }
        .tempo .written { display: block; font-size: 9px; }
        .cycle-readout { font: 11px var(--font-mono), monospace; white-space: nowrap; min-width: 85px; }
      `}</style>
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
        {Math.round(runtime.getCps() * 240)} <small>BPM</small>
        {time.speed !== 1 && (
          <small className="written">written at {Math.round((state.cps ?? 0.5) * 240)}</small>
        )}
      </output>
      <output ref={cycle} className="cycle-readout" aria-label="Cycle" />
      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">
            <ClipboardPaste />
            Paste
          </Button>
        </DialogTrigger>
        <DialogContent className="paste-dialog">
          <DialogHeader>
            <DialogTitle>Paste Strudel</DialogTitle>
            <DialogDescription>Import a program as a Studio score.</DialogDescription>
          </DialogHeader>
          <textarea
            aria-label="Strudel program"
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
            }}
            spellCheck={false}
          />
          <Button
            disabled={importing || !source.trim()}
            onClick={() => {
              void load();
            }}
          >
            {importing ? 'Importing…' : 'Import program'}
          </Button>
          <p role="status">{state.loadError}</p>
        </DialogContent>
      </Dialog>
      <span className="top-message" role="status">
        {state.loadError || state.message}
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
        <a href={strudelSource('web', '1.3.0')} target="_blank" rel="noopener">
          Strudel 1.3.0 source
        </a>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="link">About / AGPL</Button>
          </DialogTrigger>
          <DialogContent className="about-notice">
            <DialogHeader>
              <DialogTitle>About Order Doesn't Matter</DialogTitle>
              <DialogDescription>
                A visual instrument for Strudel. Read and edit a program’s score, and follow its
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
            <p>Strudel’s corresponding source for our pinned versions:</p>
            <ul>
              {['core', 'mini', 'tonal', 'transpiler', 'web', 'webaudio', 'superdough'].map(
                (name) => {
                  const version = ['web', 'webaudio', 'superdough'].includes(name)
                    ? '1.3.0'
                    : '1.2.6';
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
