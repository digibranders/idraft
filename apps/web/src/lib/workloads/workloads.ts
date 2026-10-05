import type { CostWorkload } from '@/lib/api/types';

/**
 * The catalog key of a workload under `workloads`: keys are camelCase, the API's codes are not.
 * `t(WORKLOAD_KEYS[workload])` with the `workloads` namespace. Costs and Runs share these names.
 */
export const WORKLOAD_KEYS = {
  seo_rank: 'seoRank',
  ai_prompt: 'aiPrompt',
  ai_mode_keyword: 'aiModeKeyword',
  keyword_metrics: 'keywordMetrics',
  discovery: 'discovery',
  ai_benchmark: 'aiBenchmark',
  gsc_sync: 'gscSync',
  bing_sync: 'bingSync',
  ga4_sync: 'ga4Sync',
  cloudflare_sync: 'cloudflareSync',
  ai_overview: 'aiOverview',
  extraction_llm: 'extractionLlm',
  keyword_research: 'keywordResearch',
  first_party: 'firstParty',
} as const satisfies Record<CostWorkload, string>;

/** Whether an API workload code is one this client has a name for. */
export const isCostWorkload = (value: string): value is CostWorkload => Object.hasOwn(WORKLOAD_KEYS, value);
