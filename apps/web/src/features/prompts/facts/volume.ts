import type { LinkedKeywordVolume } from './types';

/**
 * `not_collected`: the backend sends no linked keyword yet. `no_link`: the prompt (or no prompt of the group) is linked
 * to a keyword. `no_volume`: the keywords are linked but none has its monthly searches yet.
 */
export type VolumeUnknown = 'not_collected' | 'no_link' | 'no_volume';

export type VolumeReading =
  { state: 'ok'; value: number; keyword: string } | { state: 'unknown'; reason: VolumeUnknown };

/** A prompt's volume: the monthly searches of the keyword it is linked to. `undefined` is not sent, `null` is no link. */
export function promptVolumeOf(link: LinkedKeywordVolume | null | undefined): VolumeReading {
  if (link === undefined) return { state: 'unknown', reason: 'not_collected' };
  if (link === null) return { state: 'unknown', reason: 'no_link' };
  if (link.search_volume === null) return { state: 'unknown', reason: 'no_volume' };
  return { state: 'ok', value: link.search_volume, keyword: link.keyword };
}

export type GroupVolumeReading =
  | {
      state: 'ok';
      /** The searches of the keywords that have a volume, each keyword once. */
      value: number;
      /** Distinct keywords the prompts are linked to. */
      keywords: number;
      /** Of those, keywords with no volume yet: the value is then a lower bound, not the whole. */
      missing: number;
      prompts: number;
    }
  | { state: 'unknown'; reason: VolumeUnknown; keywords: number; prompts: number };

/**
 * The volume of a group: each linked keyword once, however many prompts share it. `links` is one entry per prompt of the
 * group. Keywords without a volume are never counted as 0: they are reported in `missing`. A group where any prompt
 * carries no link field at all (`undefined`) is `not_collected`: its keywords are not all known.
 */
export function groupVolumeOf(links: readonly (LinkedKeywordVolume | null | undefined)[]): GroupVolumeReading {
  const prompts = links.length;
  // One prompt without the field means the group's keywords are not all known: a partial sum would read as the whole
  if (links.some((link) => link === undefined)) {
    return { state: 'unknown', reason: 'not_collected', keywords: 0, prompts };
  }
  const keywords = new Map<string, number | null>();
  for (const link of links) {
    if (link === undefined || link === null) continue;
    const known = keywords.get(link.keyword);
    keywords.set(link.keyword, known ?? link.search_volume);
  }
  if (keywords.size === 0) return { state: 'unknown', reason: 'no_link', keywords: 0, prompts };
  const volumes = [...keywords.values()].filter((volume): volume is number => volume !== null);
  if (volumes.length === 0) return { state: 'unknown', reason: 'no_volume', keywords: keywords.size, prompts };
  return {
    state: 'ok',
    value: volumes.reduce((sum, volume) => sum + volume, 0),
    keywords: keywords.size,
    missing: keywords.size - volumes.length,
    prompts,
  };
}
