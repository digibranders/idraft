import type { ProjectEngine } from '@/lib/api/types';

/** What the counts of the page are over, as parts the header puts into words. */
export interface ScopeParts {
  /** The engines' number, or the name of the one engine when only one is shown. */
  engines: number | string;
  /** The market's ISO code, `null` for every market. */
  country: string | null;
  /** The branded prompts are in the counts. */
  branded: boolean;
}

/** The scope of the counts of the topic's figures: the engines shown, the market and the branded choice of the page. */
export function scopeParts({
  engines,
  country,
  includeBranded,
}: {
  engines: readonly ProjectEngine[];
  country: string | null;
  includeBranded: boolean;
}): ScopeParts {
  const [only] = engines;
  return {
    engines: engines.length === 1 && only !== undefined ? only.engine.label : engines.length,
    country,
    branded: includeBranded,
  };
}
