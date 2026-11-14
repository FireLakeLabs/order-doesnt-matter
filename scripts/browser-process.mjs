import { spawnSync } from 'node:child_process';

// The CLI owns workers that can still write results after its own PID exits.
// POSIX callers must spawn it detached so only this run's group is terminated.
export function killBrowserRun(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    if (result.error) throw result.error;
    if (result.status) throw Error(`taskkill failed: ${result.stderr}`);
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

// Detaching isolates deadline kills; forward parent cancellation explicitly.
export function forwardBrowserSignals(child) {
  const handlers = [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ].map(([signal, code]) => {
    const stop = () => {
      process.exitCode = code;
      killBrowserRun(child);
    };
    process.once(signal, stop);
    return [signal, stop];
  });
  return () => {
    for (const [signal, stop] of handlers) process.removeListener(signal, stop);
  };
}
