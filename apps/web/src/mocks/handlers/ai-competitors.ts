import { HttpResponse, http, type HttpHandler } from 'msw';

import { projectCaller, type ProjectCaller } from './access';
import { readOf, SCOPE } from './citations';
import { countedAnswers, NO_FLAGS, unitsOf } from './citations-model';
import { isActiveRole } from '../entities-state';
import { mock, mswPath } from '../respond';
import type { Schemas } from '@/lib/api/types';

/**
 * Two reads of the competitor drawer of the AI visibility Overview.
 *
 * `ai/competitors` (the real route, contract C5): only the part the drawer reads, the citation share of each tracked
 * entity on each engine, counted from the same answers and citation units as the Sources page (`./citations-model`).
 * Mentioned, Share of voice and Recommendation of each entry are withheld (`insufficient_data`): the drawer reads those
 * from the prompts summary, as the cards do, so the two are never mixed for one number.
 *
 * `ai/sources/overlap` (backend request 6, NOT in the API yet): a fixture of the domains cited in the answers that mention
 * each brand, so the Cited domains tab can be seen and tested. The weights are sample values, which is allowed in a fixture
 * and shipped nowhere: a production build never asks for this route (`sourcesCollected`).
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const OVERLAP = `${P}/ai/sources/overlap`;
const OVERLAP_QUERY = [
  'entity_id',
  'from',
  'to',
  'filter[engine_code_in]',
  'include_branded',
  'branded_only',
  'filter[country_iso]',
  'filter[term]',
];
const ALLOWED = [
  ...SCOPE.filter((name) => name !== 'filter[prompt_id]'),
  'branded_only',
  'entity_ids',
  'include',
  'lost_limit',
  'sources_limit',
  'compare',
  'compare_from',
  'compare_to',
];

type Metric = Schemas['AiMetricValue'];
type Window = Schemas['MetricWindow'];

const trackedOf = (caller: ProjectCaller): Schemas['SummaryEntity'][] =>
  caller.world.roles
    .filter(
      (role) =>
        role.project_id === caller.project.project_id &&
        isActiveRole(role) &&
        (role.role === 'own' || role.role === 'competitor') &&
        role.track_ai !== false,
    )
    .flatMap((role) => {
      const entity = caller.world.entities.find((candidate) => candidate.entity_id === role.entity_id);
      return entity === undefined || (role.role !== 'own' && role.role !== 'competitor')
        ? []
        : [{ entity_id: entity.entity_id, name: entity.canonical_name, role: role.role }];
    });

function metric(
  key: string,
  window: Window,
  engine: string,
  entityId: string,
  numerator: number | null,
  denominator: number | null,
): Metric {
  return {
    denominator,
    engine_code: engine,
    entity_id: entityId,
    filters: { branded_only: false, country_iso: null, include_branded: false, term_id: null },
    is_estimate: false,
    method: 'fixture',
    method_version: 1,
    metric: key,
    n_observations: denominator ?? 0,
    numerator,
    unit: 'ratio',
    value: numerator === null || denominator === null || denominator === 0 ? null : numerator / denominator,
    window,
    ...(numerator === null ? { suppressed_reason: 'insufficient_data' as const } : {}),
  };
}

/** The sample top domains of the overlap fixture: a weight each, and whether a third party owns the page. */
const THIRD_PARTY: readonly (readonly [string, number])[] = [
  ['g2.com', 9],
  ['reddit.com', 7.5],
  ['capterra.com', 6.5],
  ['techradar.com', 6],
  ['forbes.com', 5.2],
  ['zapier.com', 4.4],
  ['youtube.com', 3.2],
  ['quora.com', 2.4],
  ['wikipedia.org', 2.1],
];

interface SampleDomain {
  domain: string;
  share: number;
  third_party: boolean;
}

function shares(weights: readonly (readonly [string, number, boolean])[]): SampleDomain[] {
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  return [...weights]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([domain, weight, thirdParty]) => ({ domain, share: weight / total, third_party: thirdParty }));
}

export const aiCompetitorHandlers: HttpHandler[] = [
  mock('get', `${P}/ai/competitors`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: [...new Set(new URL(request.url).searchParams.keys())],
    });
    if (caller instanceof Response) return caller;
    const read = readOf(request, cookies, params, ALLOWED, { roles: false, flags: false }, () => null);
    if (read instanceof Response) return read;
    const { scope, answers, url } = read;
    const window: Window = { from: scope.window.first, to: scope.window.last, timezone: caller.project.timezone };
    const tracked = trackedOf(caller);
    const asked = (url.searchParams.get('entity_ids') ?? '').split(',').filter((id) => id !== '');
    const units = new Map<string, number>();
    const totals = new Map<string, number>();
    for (const answer of countedAnswers(answers, scope)) {
      for (const unit of unitsOf(answer, NO_FLAGS)) {
        totals.set(answer.engine, (totals.get(answer.engine) ?? 0) + 1);
        const key = `${answer.engine}|${unit.role_entity_id ?? ''}`;
        units.set(key, (units.get(key) ?? 0) + 1);
      }
    }
    const rows = tracked
      .filter((entity) => asked.length === 0 || asked.includes(entity.entity_id))
      .map((entity) => ({
        entity: {
          entity_id: entity.entity_id,
          canonical_name: entity.name,
          color_index: null,
          entity_type: 'brand' as const,
          role: entity.role,
        },
        by_engine: scope.engines.map((engine) => ({
          engine_code: engine,
          is_top_competitor: false,
          citation_share: metric(
            'ai.citation_share',
            window,
            engine,
            entity.entity_id,
            units.get(`${engine}|${entity.entity_id}`) ?? 0,
            totals.get(engine) ?? 0,
          ),
          mention_rate: metric('ai.mention_rate', window, engine, entity.entity_id, null, null),
          share_of_voice: metric('ai.share_of_voice', window, engine, entity.entity_id, null, null),
          recommendation_rate: metric('ai.recommendation_rate', window, engine, entity.entity_id, null, null),
        })),
      }));
    return HttpResponse.json({
      data: rows,
      meta: {
        branded_only: false,
        engine_codes: [...scope.engines],
        entities: tracked,
        entity_config_versions: [1],
        include_branded: scope.includeBranded,
        notes: [],
        window,
      },
    });
  }),
  http.get(mswPath(OVERLAP), ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: OVERLAP_QUERY,
    });
    if (caller instanceof Response) return caller;
    const id = caller.url.searchParams.get('entity_id');
    const tracked = trackedOf(caller);
    const rival = tracked.find((entity) => entity.entity_id === id && entity.role === 'competitor');
    const own = tracked.find((entity) => entity.role === 'own');
    if (rival === undefined || own === undefined) return new HttpResponse(null, { status: 404 });
    const domainOf = (entityId: string): string =>
      caller.world.domains.find((domain) => domain.entity_id === entityId)?.host ?? 'example.com';
    // A sample tilt per brand and domain (0.4 to 1.8), so the two lists differ the way real ones do
    const tilt = (entityId: string, domain: string): number => {
      let hash = 0;
      for (const char of `${entityId}|${domain}`) hash = (hash * 31 + char.charCodeAt(0)) % 997;
      return 0.4 + (hash % 15) / 10;
    };
    const side = (entityId: string, otherId: string): SampleDomain[] =>
      shares([
        ...THIRD_PARTY.map(([domain, weight]): [string, number, boolean] => [
          domain,
          weight * tilt(entityId, domain),
          true,
        ]),
        [domainOf(entityId), 8, false],
        [domainOf(otherId), 1, false],
      ]);
    return HttpResponse.json({
      data: { theirs: side(rival.entity_id, own.entity_id), yours: side(own.entity_id, rival.entity_id) },
    });
  }),
];
