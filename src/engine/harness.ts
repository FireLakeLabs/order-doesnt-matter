import { createEngine } from './index';
import type { Engine, EngineEvent } from '../contract';
import type { profilePattern } from '../strudel/playback-profile';
const odm = {
  engine: null as Engine | null,
  events: [] as EngineEvent[],
  fixture: new URL('../../tests/fixtures/sounds/burst.wav', import.meta.url).href,
  error: '',
  profile: null as
    | null
    | ((code: string, scale: number) => Promise<ReturnType<typeof profilePattern>>),
};
declare global {
  interface Window {
    odm: typeof odm;
  }
}
window.odm = odm;
document.querySelector('button')!.onclick = () => {
  if (new URLSearchParams(location.search).has('profile')) {
    void (async () => {
      const [{ createAudio }, { profilePattern }] = await Promise.all([
        import('../strudel/audio'),
        import('../strudel/playback-profile'),
      ]);
      let scale = 1,
        profile: ReturnType<typeof profilePattern>;
      const audio = await createAudio({
        inspect: (p, cps) => {
          profile = profilePattern(p, cps, scale);
        },
      });
      odm.profile = async (code, factor) => {
        scale = factor;
        await audio.prepare(code, 0, 1);
        return profile;
      };
    })().catch((error) => {
      odm.error = String(error);
    });
    return;
  }
  createEngine()
    .then((engine) => {
      odm.engine = engine;
      engine.subscribe((event) => odm.events.push(event));
    })
    .catch((error) => {
      odm.error = String(error);
    });
};
