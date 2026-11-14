import { migrate, type Doc } from '../document';

export const RECOVERY_KEY = 'odm:recovery';
export const documentJSON = (doc: Doc) => JSON.stringify(doc, null, 2) + '\n';
export const readDocument = (text: string): Doc => migrate(JSON.parse(text));

/** One latest document, no engine state. Namespace + suspension isolate future practice. */
export function createRetention(
  options: {
    storage?: () => Pick<Storage, 'getItem' | 'setItem'>;
    namespace?: string;
  } = {},
) {
  const storage = options.storage ?? (() => localStorage);
  const key = options.namespace ?? RECOVERY_KEY;
  let candidate: Doc | null = null,
    suspended = false,
    last: Doc | null = null;
  let notice = 'Recovery on this device: ready after you load a piece.';
  try {
    const text = storage().getItem(key);
    if (text !== null) {
      candidate = readDocument(text);
      notice = 'Work from your last visit is available. Recover it, or load another piece.';
    }
  } catch {
    notice = 'Recovery could not be read on this device. Download a document to keep your work.';
  }
  return {
    get candidate() {
      return candidate;
    },
    get notice() {
      return notice;
    },
    suspend(value: boolean) {
      suspended = value;
    },
    adopt() {
      candidate = null;
    },
    record(doc: Doc | null) {
      if (!doc || doc === last || suspended || candidate) return;
      last = doc;
      try {
        storage().setItem(key, documentJSON(doc));
        notice = 'Latest document kept on this device. Download a copy for safekeeping.';
      } catch {
        notice =
          'Recovery could not be saved on this device (storage unavailable or full). Download a document to keep your work.';
      }
    },
  };
}
