import { queryEventsWithBudget } from './evaluate';
import type { Question } from './evaluate-browser';
// A worker owns this host's stand-ins. Never import the host into the page.
self.onmessage = async (event: MessageEvent<Question>) => {
  const { code, from, to, playbackStarts, initialCps } = event.data;
  self.postMessage(
    await queryEventsWithBudget(code, from, to, undefined, playbackStarts, initialCps),
  );
};
