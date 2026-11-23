import { apiMutation } from '@/lib/api/query';

/**
 * The writes of Internal links (the backend OpenAPI). The variables carry url ids as strings; build each id
 * with `checkUrlId` (`queries.ts`), which refuses what the server would.
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
/** Send `body: { status, items: [{ source_url_id, target_url_id }] }`; `open` reopens a decided row. */
export const decideOpportunitiesMutation = apiMutation('put', `${P}/internal-links/opportunities/decisions`);
/** Send `body: { url_ids }` or `body: { all: true }`: pages of the latest crawl move to their suggested tier. */
export const acceptSuggestionsMutation = apiMutation('post', `${P}/internal-links/tier-suggestions/accept`);
export const dismissSuggestionsMutation = apiMutation('post', `${P}/internal-links/tier-suggestions/dismiss`);
export const createRuleMutation = apiMutation('post', `${P}/tier-rules`);
export const updateRuleMutation = apiMutation('patch', `${P}/tier-rules/{rule_id}`);
export const deleteRuleMutation = apiMutation('delete', `${P}/tier-rules/{rule_id}`);
export const previewRuleMutation = apiMutation('post', `${P}/tier-rules/preview`);
/** Send `body: { expires_in_days: 7 | 30 | 90 }`; the answer holds the link's token, this once. */
export const createShareMutation = apiMutation('post', `${P}/internal-links/shares`);
/** Revoking a link already revoked changes nothing. */
export const revokeShareMutation = apiMutation('delete', `${P}/internal-links/shares/{share_id}`);
export const createTierMutation = apiMutation('post', `${W}/page-tiers`);
export const updateTierMutation = apiMutation('patch', `${W}/page-tiers/{tier_id}`);
export const deleteTierMutation = apiMutation('delete', `${W}/page-tiers/{tier_id}`);
