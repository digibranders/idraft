import { isApiProblem, type ApiProblem } from '@/lib/api/problem';
import type { components } from '@/lib/api/schema';

/** What one `bulk-create` request answers. */
export type BulkAnswer = components['schemas']['BulkCreateResult'];

/** One tracked keyword to make: a keyword in a country. */
export interface AddPair<TCountry> {
  keyword: string;
  country: TCountry;
}

export interface ChunkedAdd<TCountry> {
  created: readonly string[];
  restored: readonly string[];
  /** Keywords tracked already in that country, with the tracked keyword each one is. */
  skipped: readonly (AddPair<TCountry> & { id: string })[];
  rejected: readonly (AddPair<TCountry> & { code: string; message: string })[];
  /** The `quota_exceeded` that stopped the add; what earlier requests added stays. */
  stoppedBy: ApiProblem | null;
}

/**
 * Adds the keywords in every country, one request per chunk of keywords and one after another, each item a
 * keyword in a country (keyword by keyword, the countries in their order). The answers are merged, with each
 * skipped or refused item named by its keyword and country. A request the plan has no room for stops the
 * add; any other failure is thrown.
 */
export async function createInChunks<TCountry>({
  chunks,
  countries,
  send,
}: {
  chunks: readonly (readonly string[])[];
  countries: readonly TCountry[];
  send: (items: readonly AddPair<TCountry>[]) => Promise<BulkAnswer>;
}): Promise<ChunkedAdd<TCountry>> {
  const created: string[] = [];
  const restored: string[] = [];
  const skipped: (AddPair<TCountry> & { id: string })[] = [];
  const rejected: (AddPair<TCountry> & { code: string; message: string })[] = [];
  for (const chunk of chunks) {
    const items = chunk.flatMap((keyword) => countries.map((country) => ({ keyword, country })));
    let answer: BulkAnswer;
    try {
      answer = await send(items);
    } catch (error) {
      if (isApiProblem(error, 'quota_exceeded')) return { created, restored, skipped, rejected, stoppedBy: error };
      throw error;
    }
    created.push(...answer.created);
    restored.push(...answer.restored);
    for (const item of answer.skipped) {
      const pair = items[item.index];
      if (pair !== undefined) skipped.push({ ...pair, id: item.existing_id });
    }
    for (const item of answer.rejected) {
      const pair = items[item.index];
      if (pair !== undefined) rejected.push({ ...pair, code: item.code, message: item.message });
    }
  }
  return { created, restored, skipped, rejected, stoppedBy: null };
}
