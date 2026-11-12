import type { Hap } from './index';
/** Pinned Pattern.tag stores metadata in Hap.context.tags, outside sound values.
 * The canary checks identical voices and the arranged/localized row identities. */
export function instrumentIdentity(hap: Hap): string | undefined {
  const tags = (hap as Hap & { context: { tags?: string[] } }).context.tags;
  return tags
    ?.findLast((tag) => tag.startsWith('odm:instrument:'))
    ?.slice('odm:instrument:'.length);
}
