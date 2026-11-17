import { apiMutation } from '@/lib/api/query';

/**
 * The writes of Internal links (the backend OpenAPI). The variables carry url ids as numbers (`urlIdNumber` in
 * `queries.ts` makes them).
 */
const W = '/api/v1/workspaces/{workspace_id}';
// Literal strings, so each path below keeps its literal type for the typed client
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';

export const setTiersMutation = apiMutation('put', `${P}/pages/tiers`);
export const resetTiersMutation = apiMutation('post', `${P}/pages/tiers/reset`);
export const importTiersMutation = apiMutation('post', `${P}/pages/tiers/import`);
export const changeTagsMutation = apiMutation('put', `${P}/pages/tags`);
/** Send `body: { higher_limit: false }`: the API wants a JSON body; `true` after a crawl stopped at its ceiling. */
export const startCrawlMutation = apiMutation('post', `${P}/link-crawls`);
export const cancelCrawlMutation = apiMutation('post', `${P}/link-crawls/{run_id}/cancel`);
/** Send `body: { internal_links: {...} }`: the settings route takes `seo` and `internal_links`, at least one. */
export const updateSettingsMutation = apiMutation('patch', `${P}/settings`);
export const createRuleMutation = apiMutation('post', `${P}/tier-rules`);
export const updateRuleMutation = apiMutation('patch', `${P}/tier-rules/{rule_id}`);
export const deleteRuleMutation = apiMutation('delete', `${P}/tier-rules/{rule_id}`);
export const previewRuleMutation = apiMutation('post', `${P}/tier-rules/preview`);
export const createTierMutation = apiMutation('post', `${W}/page-tiers`);
export const updateTierMutation = apiMutation('patch', `${W}/page-tiers/{tier_id}`);
export const deleteTierMutation = apiMutation('delete', `${W}/page-tiers/{tier_id}`);
