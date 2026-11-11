import { fixtures } from './fixtures';
import { mountSheet, sheetModel } from './index';

const name = new URLSearchParams(location.search).get('fixture') ?? 'trio';
const fixture = fixtures[name as keyof typeof fixtures];
if (!fixture) throw Error(`Unknown sheet fixture: ${name}`);
mountSheet(document.querySelector('main')!, sheetModel(fixture));
