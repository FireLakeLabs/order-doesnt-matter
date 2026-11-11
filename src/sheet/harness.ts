import { fixtures } from './fixtures';
import { mountSheet, sheetModel, setPlayhead, type SheetModel } from './index';

const params = new URLSearchParams(location.search);
const host = document.querySelector('main')!;
const modelUrl = params.get('model');
if (modelUrl) {
  const response = await fetch(modelUrl);
  if (!response.ok) throw Error(`Cannot load sheet model: ${response.status}`);
  mountSheet(host, (await response.json()) as SheetModel);
} else {
  const name = params.get('fixture') ?? 'trio';
  const fixture = fixtures[name as keyof typeof fixtures];
  if (!fixture) throw Error(`Unknown sheet fixture: ${name}`);
  mountSheet(host, sheetModel(fixture));
}
// The harness exposes only the redraw seam, for DOM-preservation browser checks.
Object.assign(window, { setSheetPlayhead: (x: number | null) => setPlayhead(host, x) });
