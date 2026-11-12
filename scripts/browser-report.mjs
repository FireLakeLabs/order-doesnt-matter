// One clock for Playwright steps and browser performance marks, counted once.
import { dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
export function phaseTimings(result) {
  const phases = {
    page: 0,
    import: 0,
    playback: 0,
    swap: 0,
    observation: 0,
    capture: 0,
    teardown: 0,
    other: 0,
  };
  const spans = [];
  const allHooks = [];
  const visit = (step, phase = 'other', priority = 0) => {
    if (['beforeAll hook', 'afterAll hook', 'Worker Cleanup'].includes(step.title))
      allHooks.push({ start: +step.startTime, end: +step.startTime + step.duration });
    if (phase === 'other') {
      if (step.title.startsWith('ODM:')) phase = step.title.slice(4);
      else if (step.title === 'After Hooks' || step.title === 'Worker Cleanup') phase = 'teardown';
      else if (/Navigate to/.test(step.title)) phase = 'page';
      else if (/Screenshot|video/i.test(step.title)) phase = 'capture';
      else if (/poll |Wait for/.test(step.title)) phase = 'observation';
    }
    spans.push({ start: +step.startTime, end: +step.startTime + step.duration, phase, priority });
    step.steps.forEach((child) => visit(child, phase, priority + 1));
  };
  result.steps.forEach((step) => visit(step));
  const attachment = result.attachments.find((a) => a.name === 'browser-marks')?.body;
  if (attachment) {
    const { origin, marks } = JSON.parse(attachment.toString());
    for (const mark of marks)
      spans.push({
        start: origin + mark.start,
        end: origin + mark.end,
        phase: mark.name,
        priority: 100 + ['observation', 'playback', 'swap', 'capture'].indexOf(mark.name),
      });
  }
  const start = +result.startTime;
  let end = start + result.duration;
  // Playwright excludes beforeAll/afterAll slots from result.duration, although
  // their steps share its wall-clock origin. Compact those intervals out instead
  // of clipping away the test's actual trailing work.
  const excluded = [];
  for (const interval of allHooks.sort((a, b) => a.start - b.start)) {
    const last = excluded.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else excluded.push({ ...interval });
  }
  for (const interval of excluded)
    if (interval.start <= end && interval.end > start)
      end += interval.end - Math.max(start, interval.start);
  const points = [
    ...new Set([
      start,
      end,
      ...spans.flatMap((s) => [s.start, s.end]),
      ...excluded.flatMap((s) => [s.start, s.end]),
    ]),
  ]
    .filter((p) => p >= start && p <= end)
    .sort((a, b) => a - b);
  for (let i = 1; i < points.length; i++) {
    if (excluded.some((s) => s.start <= points[i - 1] && s.end >= points[i])) continue;
    const active = spans
      .filter((s) => s.start <= points[i - 1] && s.end >= points[i])
      .sort((a, b) => b.priority - a.priority);
    phases[active[0]?.phase ?? 'other'] += points[i] - points[i - 1];
  }
  return phases;
}
export default class BrowserReport {
  rows = [];
  onTestEnd(test, result) {
    this.rows.push({
      title: test.titlePath().filter(Boolean).join(' > '),
      status: result.status,
      ms: result.duration,
      phases: phaseTimings(result),
      sharedSetupMs: (() => {
        const body = result.attachments.find((a) => a.name === 'browser-shared-setup')?.body;
        return body ? JSON.parse(body.toString()).ms : undefined;
      })(),
    });
  }
  onEnd() {
    for (const path of [process.env.ODM_REPORT_PATH, process.env.ODM_PROFILE_PATH].filter(
      Boolean,
    )) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(this.rows, null, 2) + '\n');
    }
  }
}
