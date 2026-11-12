import { expect, it } from 'vitest';
import { pending, transition } from './pending';

const doc = { version: 2 as const, body: [] };
function edit() {
  return transition(pending(doc), {
    type: 'edit',
    doc,
    target: 'cutoff',
    token: 1,
    playing: true,
    instruments: ['bass'],
    names: ['bass'],
  });
}
it('another instrument cannot clear pending; the edited instrument clears it even before sent', () => {
  let p = edit();
  p = transition(p, { type: 'trigger', revision: 2, instrument: 'drums', cycle: 4 });
  p = transition(p, { type: 'swapped', revision: 2, cycle: 4 });
  p = transition(p, { type: 'sent', doc, token: 1, revision: 2 });
  expect(p.entries.cutoff.status).toBe('pending');
  expect(
    transition(p, { type: 'trigger', revision: 1, instrument: 'bass', cycle: 4.5 }).entries.cutoff
      .status,
  ).toBe('pending');
  expect(
    transition(p, { type: 'trigger', revision: 2, instrument: 'bass', cycle: 4.5 }).entries,
  ).toEqual({});
  let early = transition(edit(), { type: 'trigger', revision: 2, instrument: 'bass', cycle: 4.5 });
  early = transition(early, { type: 'sent', doc, token: 1, revision: 2 });
  expect(early.entries).toEqual({});
});
it('a silent scheduling window starts the full-cycle fallback, rather than clearing a sparse edit', () => {
  let p = transition(edit(), { type: 'sent', doc, token: 1, revision: 2 });
  p = transition(p, { type: 'committed', revision: 2, cycle: 4.25 });
  expect(p.entries.cutoff.status).toBe('pending');
  expect(transition(p, { type: 'progress', cycle: 5.249 }).entries.cutoff.status).toBe('pending');
  expect(transition(p, { type: 'progress', cycle: 5.25 }).entries).toEqual({});
});
it('coalesced drags wait for the latest revision and failure restores the confirmed document', () => {
  let p = transition(edit(), { type: 'sent', doc, token: 1, revision: 2 });
  p = transition(p, {
    type: 'edit',
    doc,
    target: 'cutoff',
    token: 2,
    playing: true,
    instruments: ['bass'],
  });
  p = transition(p, { type: 'trigger', revision: 2, instrument: 'bass', cycle: 4 });
  p = transition(p, { type: 'sent', doc, token: 2, revision: 3 });
  expect(p.entries.cutoff.status).toBe('pending');
  p = transition(p, { type: 'trigger', revision: 3, instrument: 'drums', cycle: 4.25 });
  expect(p.entries.cutoff.status).toBe('pending');
  expect(
    transition(p, { type: 'trigger', revision: 3, instrument: 'bass', cycle: 4.5 }).entries,
  ).toEqual({});
  const bad = { ...doc, body: [] };
  p = transition(p, {
    type: 'edit',
    doc: bad,
    target: 'cutoff',
    token: 3,
    playing: true,
    instruments: ['bass'],
  });
  p = transition(p, { type: 'failed', token: 3, reason: 'refused' });
  expect(p.doc).toBe(doc);
  expect(p.entries.cutoff.status).toBe('failed');
});
