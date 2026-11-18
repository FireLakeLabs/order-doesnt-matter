import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { importStrudel } from '../../src/import';
import { initialState, loadPiece } from '../../src/app/state';
import { generate } from '../../src/generate';
import { viewNotes } from '../../src/studio/frame';
import { queryEventsNode } from '../node-query';
import { scoreFrame } from './score-fixture';
import {
  captivePoint,
  flipperAt,
  indexPinball,
  pinballLayout,
  pinballState,
  pointOnRoute,
  routeBetween,
} from '../../src/views/pinball/model';
import type { ViewFrame, ViewNote } from '../../src/views/types';

const corpus = new Map<string, ViewFrame>();
beforeAll(async () => {
  for (const file of ['real-dubstep-arranged', 'real-techno']) {
    const source = readFileSync(`corpus/programs/${file}.strudel`, 'utf8');
    const state = loadPiece(initialState(), source, importStrudel(source));
    const frame = scoreFrame(state.rows.length);
    frame.sections = state.sections.map((s) => ({
      name: s.name,
      from: s.start,
      to: s.start + s.cycles,
    }));
    frame.to = frame.sections.at(-1)?.to ?? 16;
    const entries = await Promise.all(
      state.rows.map(
        async (row) =>
          [
            row.id,
            await queryEventsNode(generate(state.doc!, { only: row.id }), 0, frame.to),
          ] as const,
      ),
    );
    for (const [, result] of entries) expect(result.error).toBeNull();
    frame.notes = viewNotes({ from: 0, to: frame.to, events: Object.fromEntries(entries) });
    frame.instruments.forEach((i, n) => {
      i.id = state.rows[n].id;
      i.name = state.rows[n].name;
    });
    corpus.set(file, frame);
  }
});
it('maps the actual drop at bar 11, 40%: two held bass spans and the next counted split', () => {
  const f = corpus.get('real-dubstep-arranged')!;
  const score = indexPinball(f.notes),
    box = pinballLayout(f),
    state = pinballState(score, box, 10.4);
  expect(state.held).toBe(2);
  expect(state.fragments).toBe(2);
  expect(state.holds.map((h) => h.target.instrument.name).sort()).toEqual([
    'subBass',
    'wobbleBass',
  ]);
  expect(state.holds.every((h) => score.kinds.get(h.target.instrument.id) === 'ramp')).toBe(true);
  expect(state.next?.time).toBe(10.5);
  expect(state.multiball).toBe(2);
  expect(state.routes.map((r) => r.target.instrument.name).sort()).toEqual([
    'dubstepDrums · hh',
    'dubstepDrums · sd',
  ]);
  expect(state.reached).toBe(8);
  expect(state.barNotes).toBe(14);
  expect(f.instruments.find((i) => i.id === flipperAt(f))?.name).toBe('dubstepDrums · bd');
});
it('lands every arrival exactly and gives every tied target a ball at the onset', () => {
  const f = corpus.get('real-dubstep-arranged')!,
    score = indexPinball(f.notes),
    box = pinballLayout(f);
  for (const group of score.groups.slice(1, 60)) {
    const state = pinballState(score, box, group.time - 1e-8);
    expect(state.routes.reduce((n, r) => n + r.count, 0)).toBe(group.notes.length);
    for (const route of state.routes) {
      expect(route.ahead[0]).toEqual(route.position);
      expect(pointOnRoute(route.points, 1)).toMatchObject({ x: route.target.x, y: route.target.y });
      expect(
        Math.hypot(route.position.x - route.target.x, route.position.y - route.target.y),
      ).toBeLessThan(0.001);
    }
    expect(pinballState(score, box, group.time).current?.notes).toEqual(group.notes);
  }
});
it('holds the exact scored span and keeps a note fixed when its siblings or window change', () => {
  const f = scoreFrame(1),
    id = f.instruments[0].id;
  const note: ViewNote = {
    instrument: id,
    start: 1,
    end: 3,
    hasOnset: true,
    value: { note: 'c1' },
  };
  const sibling = { ...note, end: 2 };
  const box = pinballLayout(f),
    score = indexPinball([note, sibling]);
  expect(pinballState(score, box, 0.999).held).toBe(0);
  expect(pinballState(score, box, 1).held).toBe(2);
  expect(pinballState(score, box, 2).held).toBe(1);
  expect(pinballState(score, box, 3).held).toBe(0);
  expect(pinballState(score, box, 2.4).holds[0].positions[0]).toEqual(
    captivePoint(box.targets[0], note, 2.4),
  );
  const cropped = indexPinball([{ ...note, hasOnset: false }]);
  expect(cropped.groups).toHaveLength(0);
  expect(pinballState(cropped, box, 2.4).holds[0].positions).toEqual(
    pinballState(score, box, 2.4).holds[0].positions,
  );
  const vocal = { ...note, value: {}, hasOnset: false };
  expect(pinballState(indexPinball([vocal]), box, 2.4).held).toBe(1);
  expect(indexPinball([vocal]).kinds.get(id)).toBe('spinner');
});
it('fixes target identity from the full part list, independent of roles, names or window occupants', () => {
  const f = corpus.get('real-dubstep-arranged')!,
    first = pinballLayout(f);
  const later = pinballLayout({
    ...f,
    instruments: f.instruments
      .slice()
      .reverse()
      .map((i) => ({ ...i, sounding: false, inSection: false, name: 'renamed' })),
  });
  expect(later.targets.map(({ instrument, ...position }) => [instrument.id, position])).toEqual(
    first.targets.map(({ instrument, ...position }) => [instrument.id, position]),
  );
  const renamed = f.notes.map((n) => ({ ...n, value: { ...n.value, s: 'arbitrary' } }));
  expect(indexPinball(renamed).kinds).toEqual(indexPinball(f.notes).kinds);
  expect(flipperAt({ ...f, notes: renamed })).toEqual(flipperAt(f));
});
it('routes around label rectangles at both stage widths, even with twenty targets', () => {
  for (const count of [1, 12, 20])
    for (const [width, height] of [
      [1300, 760],
      [560, 675],
      [487, 469],
      [1131, 469],
    ]) {
      const f = { ...scoreFrame(count), width, height },
        box = pinballLayout(f);
      for (const a of box.targets)
        for (const b of box.targets) {
          const points = routeBetween(a, b, box);
          const collisions: string[] = [];
          for (let i = 1; i < points.length; i++) {
            const a = points[i - 1],
              b = points[i];
            for (const t of box.targets) {
              const left = t.x - t.labelWidth / 2 - 10,
                right = t.x + t.labelWidth / 2 + 10;
              const top = t.labelY - 21,
                bottom = t.labelY + (t.compact ? 12 : 28);
              if (
                Math.max(a.x, b.x) > left &&
                Math.min(a.x, b.x) < right &&
                Math.max(a.y, b.y) > top &&
                Math.min(a.y, b.y) < bottom
              )
                collisions.push(
                  JSON.stringify({ count, width, height, from: a, to: b, label: t.slot }),
                );
            }
          }
          expect(collisions).toEqual([]);
        }
    }
});
it('retains all 500 dense notes as counted holds and multiball rather than dropping them', () => {
  const f = scoreFrame(20),
    notes = Array.from({ length: 500 }, (_, i) => ({
      instrument: f.instruments[i % 20].id,
      start: 1,
      end: 2,
      hasOnset: true,
      value: { note: 36 },
    }));
  const score = indexPinball(notes),
    box = pinballLayout(f);
  expect(pinballState(score, box, 0.9).travelling).toBe(500);
  const state = pinballState(score, box, 1.4);
  expect(state.held).toBe(500);
  expect(state.holds).toHaveLength(20);
  expect(state.holds.every((h) => h.count === 25)).toBe(true);
  expect(indexPinball(notes.slice().reverse()).groups).toEqual(score.groups);
  expect(indexPinball(corpus.get('real-techno')!.notes).groups.length).toBeGreaterThan(0);
});

it('keeps the four-on-the-floor drum a bumper, the short offbeats rollovers, and drives flippers with the steady downbeat', () => {
  const f = corpus.get('real-techno')!,
    score = indexPinball(f.notes);
  const [drum, hats, clap] = f.instruments;
  expect(score.kinds.get(drum.id)).toBe('bumper');
  expect(score.kinds.get(hats.id)).toBe('rollover');
  expect(score.kinds.get(clap.id)).toBe('bumper');
  expect(flipperAt({ ...f, now: 1.4 })).toBe(drum.id);
  const partial = f.notes.filter((n) => n.start < 4.4);
  expect(indexPinball(partial).kinds.get(hats.id)).toBe('rollover');
  expect(flipperAt({ ...f, notes: partial, now: 1.4 })).toBe(drum.id);
});

it('rejoins a released captive to the next onset starting exactly at the scored end', () => {
  const f = scoreFrame(2),
    [bass, drum] = f.instruments;
  const held = { instrument: bass.id, start: 1, end: 1.7, hasOnset: true, value: { note: 36 } };
  const hit = { instrument: drum.id, start: 2, end: 2.1, hasOnset: true, value: {} };
  const score = indexPinball([held, hit]),
    box = pinballLayout(f);
  expect(pinballState(score, box, 1.699).held).toBe(1);
  const released = pinballState(score, box, 1.7);
  expect(released.held).toBe(0);
  expect(released.routes).toHaveLength(2);
  expect(released.routes[1].position).toMatchObject({ x: box.targets[0].x, y: box.targets[0].y });
  const arriving = pinballState(score, box, 2 - 1e-8).routes[1];
  expect(
    Math.hypot(arriving.position.x - box.targets[1].x, arriving.position.y - box.targets[1].y),
  ).toBeLessThan(0.001);
  expect(pinballState(score, box, 2).routes).toHaveLength(1);
});

it('counts short control continuations separately without inventing live notes or new hits', () => {
  const note = { instrument: '0', start: 1, end: 1.125, hasOnset: true, value: {} };
  const score = indexPinball([note, { ...note, hasOnset: false }, { ...note, hasOnset: false }]);
  expect(score.spans).toEqual([note]);
  expect(score.groups[0].notes).toHaveLength(1);
  expect(score.holds).toHaveLength(0);
  expect(pinballState(score, pinballLayout(scoreFrame(1)), 1.1).fragments).toBe(2);
});
