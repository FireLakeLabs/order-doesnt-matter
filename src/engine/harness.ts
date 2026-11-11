import { createEngine } from './index';
import type { Engine, EngineEvent } from '../contract';
const odm = {
  engine: null as Engine | null,
  events: [] as EngineEvent[],
  fixture: new URL('../../tests/fixtures/sounds/burst.wav', import.meta.url).href,
  error: '',
};
declare global {
  interface Window {
    odm: typeof odm;
  }
}
window.odm = odm;
document.querySelector('button')!.onclick = () => {
  createEngine()
    .then((engine) => {
      odm.engine = engine;
      engine.subscribe((event) => odm.events.push(event));
    })
    .catch((error) => {
      odm.error = String(error);
    });
};
