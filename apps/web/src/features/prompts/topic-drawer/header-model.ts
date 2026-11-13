import type { ProjectEngine } from '@/lib/api/types';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

/** Where a topic sits in its vocabulary: what the category badge says and what its tooltip adds. */
export interface TopicCategory {
  /** The topics above it, by name, in the tree's own form ("SEO / Technical SEO"). */
  text: string;
  /** The whole path, the topic itself last. */
  path: string;
}

/**
 * The category badge of a topic's header (WB-TI-02 and 23): the path of its parent, so a level 2 topic says its parent's
 * name and a level 3 topic says "Root / Parent". A top level topic sits under nothing and has none; so has a key the tree
 * does not hold (the prompts without a topic among them). The tree's paths already hold the names joined, so none is
 * joined here.
 */
export function categoryOf(key: string, tree: readonly NamedTerm[]): TopicCategory | null {
  const topic = tree.find((entry) => entry.termId === key);
  if (topic === undefined || topic.parentId === null) return null;
  const parent = tree.find((entry) => entry.termId === topic.parentId);
  return parent === undefined ? null : { text: parent.path, path: topic.path };
}

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
