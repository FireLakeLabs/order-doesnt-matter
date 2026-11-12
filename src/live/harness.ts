import '../app/style.css';
import { instruments, sections } from '../document';
import { fixtures } from '../sheet/fixtures';
import { liveModel, mountLivePanel, updateLivePanel } from './index';
import type { LiveModel } from './model';
const host = document.querySelector('main')!;
const fixture = fixtures.trio;
const input = {
  ...fixture,
  rows: instruments(fixture.doc),
  sections: sections(fixture.doc),
  solo: null,
};
mountLivePanel(host, liveModel(input));
Object.assign(window, {
  setLiveModel: (model: LiveModel) => {
    mountLivePanel(host, model);
    return (next: LiveModel) => updateLivePanel(host, next);
  },
  setLiveCycle: (playhead: number | null) =>
    updateLivePanel(host, liveModel({ ...input, playhead })),
});
