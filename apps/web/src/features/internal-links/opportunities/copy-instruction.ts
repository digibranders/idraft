import type { Opportunity } from '@/lib/internal-links/types';

/** What the copy button puts on the clipboard (mock `instruction`). */
export const instruction = (row: {
  source: Pick<Opportunity['source'], 'url'>;
  target: Pick<Opportunity['target'], 'url'>;
  phrase: string;
}): string => `On ${row.source.url} link the words "${row.phrase}" to ${row.target.url}.`;
