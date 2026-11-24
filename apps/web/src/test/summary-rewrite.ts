import { vi } from 'vitest';

/** The prompts summary body as a test edits it: rows with engines, whatever else the mock sent. */
export interface SummaryBody {
  data: {
    prompts: {
      text: string;
      intent?: unknown;
      linked_keyword?: unknown;
      engines: ({ engine_code: string } & Record<string, unknown>)[];
    }[];
  };
}

/**
 * Lets the mock answer the prompts summary and hands its body to `edit` before the page reads it, to stand in for a
 * backend that sends other fields than the mock does. Undo it with `vi.restoreAllMocks()`.
 */
export function rewriteSummary(edit: (body: SummaryBody) => void): void {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const response = await realFetch(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://localhost');
    if (!url.pathname.endsWith('/ai/prompts-summary')) return response;
    const body = (await response.json()) as SummaryBody;
    edit(body);
    return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
  });
}

const UNBUILT: ReadonlySet<string> = new Set(['position', 'sentiment', 'recommended', 'other_brands', 'top_links']);

/** The facts of the Prompts columns that the API does not send yet: only `latest` is built. */
export function leaveOutUnbuiltFacts(body: SummaryBody): void {
  for (const row of body.data.prompts) {
    delete row.intent;
    delete row.linked_keyword;
    row.engines = row.engines.map(
      (engine) =>
        Object.fromEntries(
          Object.entries(engine).filter(([field]) => !UNBUILT.has(field)),
        ) as (typeof row.engines)[number],
    );
  }
}
