import { queryEvents } from './evaluate';
// A worker owns this host's stand-ins. Never import the host into the page.
self.onmessage = async (event: MessageEvent<{ code: string; from: number; to: number }>) => {
  const { code, from, to } = event.data;
  self.postMessage(await queryEvents(code, from, to));
};
