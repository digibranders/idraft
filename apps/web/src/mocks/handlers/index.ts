import type { HttpHandler } from 'msw';

import { authHandlers } from './auth';
import { entityHandlers } from './entities';
import { costHandlers } from './costs';
import { integrationHandlers } from './integrations';
import { invitationHandlers } from './invitations';
import { keywordGroupHandlers } from './keyword-groups';
import { keywordImportHandlers } from './keyword-imports';
import { keywordQuotaHandlers } from './keyword-quota';
import { keywordHandlers } from './keywords';
import { meHandlers } from './me';
import { pendingHandlers } from './pending';
import { projectEntityHandlers } from './project-entities';
import { projectHandlers } from './projects';
import { promptAnswerHandlers } from './prompt-answers';
import { promptRunHandlers } from './prompt-run-now';
import { promptHandlers } from './prompts';
import { rankEventsHandlers } from './rank-events';
import { rankHistoryHandlers } from './rank-history';
import { serpHandlers } from './serp';
import { registryHandlers } from './registries';
import { runHandlers } from './runs';
import { scheduleHandlers } from './schedules';
import { taxonomyHandlers } from './taxonomy';
import { termAssignmentHandlers } from './term-assignments';
import { trackedKeywordHandlers } from './tracked-keywords';
import { workspaceHandlers } from './workspaces';
// WP-15 layouts
import { layoutHandlers } from './layouts';
// WP-19 compare
import { compareHandlers } from './compare';
// WP-21 citations
import { citationHandlers } from './citations';
// WP-22 citation-details
import { citationDetailHandlers } from './citation-details';
// WP-24 fanout
import { fanoutHandlers } from './fanout';
// WP-26 evidence
import { evidenceHandlers } from './evidence';
// WP-27 prompt-limits
import { promptLimitHandlers } from './prompt-limits';
// WP-29 prompt-edits
import { promptEditHandlers } from './prompt-edits';
// WP-30 ai-health
import { aiHealthHandlers } from './ai-health';
// WP-31 retention
import { retentionHandlers } from './retention';
// WP-33 ai-overview
import { aiOverviewHandlers } from './ai-overview';
// WP-38 notes
import { noteHandlers } from './notes';
// WP-39 competitors
import { competitorHandlers } from './competitors';
// WP-41 prompt-versions
import { promptVersionHandlers } from './prompt-versions';
// WP-43 panels
import { panelHandlers } from './panels';
// WP-44 prompt-links
import { promptLinkHandlers } from './prompt-links';
// WP-46 candidates
import { candidateHandlers } from './candidates';
// WP-48 alerts
import { alertHandlers } from './alerts';
// WP-49 saved-views
import { savedViewHandlers } from './saved-views';
// WP-50 exports
import { exportHandlers } from './exports';
// WP-51 reports
import { reportHandlers } from './reports';
// WP-52 prompt-timeline
import { promptTimelineHandlers } from './prompt-timeline';
// WP-56 rederive
import { rederiveHandlers } from './rederive';
// WP-57 retrieval
import { retrievalHandlers } from './retrieval';
// WP-59 prompt-stats
import { promptStatHandlers } from './prompt-stats';
// WP-61 sources
import { sourceHandlers } from './sources';
// WP-65 cross-channel
import { crossChannelHandlers } from './cross-channel';
// WP-68 llm-diagnostics
import { llmDiagnosticHandlers } from './llm-diagnostics';
// WP-69 first-party
import { firstPartyHandlers } from './first-party';
// WP-70 geo-readiness
import { geoReadinessHandlers } from './geo-readiness';
// WP-28 prompt-import
import { promptImportHandlers } from './prompt-import';
// WP-40 project-overview-ai
import { projectOverviewAiHandlers } from './project-overview-ai';
// WP-53 command-palette
import { commandPaletteHandlers } from './command-palette';
// WP-55 recommendations
import { recommendationHandlers } from './recommendations';

/**
 * The two mock modes (NEXT_PUBLIC_API_MOCKING). `all` answers every API route and needs no backend;
 * `pending` answers only the endpoints the backend has not built and lets everything else through to it.
 */
export type MockMode = 'pending' | 'all';

export const handlers: readonly HttpHandler[] = [
  ...authHandlers,
  ...meHandlers,
  ...invitationHandlers,
  ...workspaceHandlers,
  ...projectHandlers,
  ...entityHandlers,
  ...projectEntityHandlers,
  ...taxonomyHandlers,
  ...registryHandlers,
  ...keywordHandlers,
  ...trackedKeywordHandlers,
  ...rankEventsHandlers,
  ...keywordQuotaHandlers,
  ...rankHistoryHandlers,
  ...serpHandlers,
  ...keywordGroupHandlers,
  ...termAssignmentHandlers,
  ...keywordImportHandlers,
  ...scheduleHandlers,
  ...runHandlers,
  ...costHandlers,
  ...promptHandlers,
  ...promptRunHandlers,
  ...promptAnswerHandlers,
  ...integrationHandlers,
  // WP-15 layouts
  ...layoutHandlers,
  // WP-19 compare
  ...compareHandlers,
  // WP-21 citations
  ...citationHandlers,
  // WP-22 citation-details
  ...citationDetailHandlers,
  // WP-24 fanout
  ...fanoutHandlers,
  // WP-26 evidence
  ...evidenceHandlers,
  // WP-27 prompt-limits
  ...promptLimitHandlers,
  // WP-29 prompt-edits
  ...promptEditHandlers,
  // WP-30 ai-health
  ...aiHealthHandlers,
  // WP-31 retention
  ...retentionHandlers,
  // WP-33 ai-overview
  ...aiOverviewHandlers,
  // WP-38 notes
  ...noteHandlers,
  // WP-39 competitors
  ...competitorHandlers,
  // WP-41 prompt-versions
  ...promptVersionHandlers,
  // WP-43 panels
  ...panelHandlers,
  // WP-44 prompt-links
  ...promptLinkHandlers,
  // WP-46 candidates
  ...candidateHandlers,
  // WP-48 alerts
  ...alertHandlers,
  // WP-49 saved-views
  ...savedViewHandlers,
  // WP-50 exports
  ...exportHandlers,
  // WP-51 reports
  ...reportHandlers,
  // WP-52 prompt-timeline
  ...promptTimelineHandlers,
  // WP-56 rederive
  ...rederiveHandlers,
  // WP-57 retrieval
  ...retrievalHandlers,
  // WP-59 prompt-stats
  ...promptStatHandlers,
  // WP-61 sources
  ...sourceHandlers,
  // WP-65 cross-channel
  ...crossChannelHandlers,
  // WP-68 llm-diagnostics
  ...llmDiagnosticHandlers,
  // WP-69 first-party
  ...firstPartyHandlers,
  // WP-70 geo-readiness
  ...geoReadinessHandlers,
  // WP-28 prompt-import
  ...promptImportHandlers,
  // WP-40 project-overview-ai
  ...projectOverviewAiHandlers,
  // WP-53 command-palette
  ...commandPaletteHandlers,
  // WP-55 recommendations
  ...recommendationHandlers,
  ...pendingHandlers,
];

export const handlersFor = (mode: MockMode): HttpHandler[] => [...(mode === 'all' ? handlers : pendingHandlers)];

/**
 * What happens to a request no handler answers. In `all` mode an API request without a handler is an error,
 * so a missing mock is noticed at once; anything else (pages, assets, fonts) passes. In `pending` mode every
 * other request goes to the real API.
 */
export const unhandledStrategy =
  (mode: MockMode) =>
  (request: Request, print: { error: () => void }): void => {
    if (mode === 'all' && new URL(request.url).pathname.startsWith('/api/')) print.error();
  };
