import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller } from './access';
import { registrableOf } from './citations-model';
import { answersOf, findAnswer, idOf } from './prompt-answers';
import { invalid, mock, problem, requestIdOf } from '../respond';
import type { ObservationDetail, Problem, Schemas } from '@/lib/api/types';
import { REQUEST_ID_HEADER } from '@/lib/request-id';

/**
 * `GET {P}/ai/observations/{observation_id}/compare`: an answer against the newest earlier answer of the same prompt
 * and engine that named the own brand (contract note `docs/ai-visibility/contracts/evidence.md`, rules D1 and D2).
 * It is worked out from the same answers the detail route serves, never written down.
 */

const COMPARE =
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/observations/{observation_id}/compare' as const;
/** Citations the API leaves out of a comparison (D2): an address that was never resolved, and the engine's own. */
const FLAGGED: ReadonlySet<string> = new Set(['unresolved_redirect', 'engine_internal']);

type Entity = Schemas['CompareEntity'];
type Source = Schemas['CompareSource'];

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `404 no_baseline`: the answer exists, and nothing earlier is there to compare it with. The mocks' problem list has no such code. */
function noBaseline(request: Request): HttpResponse<Problem> {
  const requestId = requestIdOf(request);
  return HttpResponse.json(
    {
      type: 'https://idraft.ai/api/problems/no_baseline',
      title: 'No earlier answer to compare',
      status: 404,
      code: 'no_baseline',
      instance: new URL(request.url).pathname,
      request_id: requestId,
    },
    { status: 404, headers: { 'content-type': 'application/problem+json', [REQUEST_ID_HEADER]: requestId } },
  );
}

/** D2, entities: the accepted mentions of a tracked role, by entity id. */
function namedBy(answer: ObservationDetail): Map<string, Entity> {
  const found = new Map<string, Entity>();
  for (const mention of answer.mentions) {
    const { role } = mention;
    if (mention.mention_status !== 'accepted' || (role !== 'own' && role !== 'competitor' && role !== 'watch'))
      continue;
    found.set(mention.entity_id, { entity_id: mention.entity_id, name: mention.name, role });
  }
  return found;
}

/** D2, sources: the registrable domain of each citation, with the host and title of its first, flagged citations left out. */
function citedBy(answer: ObservationDetail): Map<string, Source> {
  const found = new Map<string, Source>();
  for (const citation of answer.citations) {
    if (citation.flags.some((flag) => FLAGGED.has(flag))) continue;
    const domain = registrableOf(citation.host);
    if (!found.has(domain)) {
      found.set(domain, {
        registrable_domain: domain,
        host: citation.host,
        domain_role: citation.domain_role,
        title: citation.title,
      });
    }
  }
  return found;
}

const side = (answer: ObservationDetail): Schemas['CompareSide'] => ({
  observation_id: answer.observation_id,
  observed_at: answer.observed_at,
  own_mentioned: answer.facts?.own_mentioned ?? false,
  own_domain_cited: answer.facts?.own_domain_cited ?? false,
});

const only = <T>(from: ReadonlyMap<string, T>, other: ReadonlyMap<string, T>): T[] =>
  [...from].filter(([key]) => !other.has(key)).map(([, value]) => value);

/** D1: strictly earlier than the answer (its time, then its number), of the same prompt and engine, valid and naming the own brand. */
const isBaselineOf =
  (latest: ObservationDetail) =>
  (candidate: ObservationDetail): boolean =>
    candidate.subject.prompt_id === latest.subject.prompt_id &&
    candidate.engine_code === latest.engine_code &&
    candidate.facts?.is_valid === true &&
    candidate.facts.own_mentioned &&
    (Date.parse(candidate.observed_at) < Date.parse(latest.observed_at) ||
      (Date.parse(candidate.observed_at) === Date.parse(latest.observed_at) &&
        BigInt(candidate.observation_id) < BigInt(latest.observation_id)));

function compare(latest: ObservationDetail, baseline: ObservationDetail): Schemas['AnswerCompare'] {
  const nowNamed = namedBy(latest);
  const wasNamed = namedBy(baseline);
  const nowCited = citedBy(latest);
  const wasCited = citedBy(baseline);
  const entities = (list: Entity[]): Entity[] =>
    list.sort((a, b) => byText(a.name, b.name) || byText(a.entity_id, b.entity_id));
  const sources = (list: Source[]): Source[] => list.sort((a, b) => byText(a.registrable_domain, b.registrable_domain));
  return {
    prompt_id: latest.subject.prompt_id,
    engine_code: latest.engine_code as Schemas['EngineCode'],
    latest: side(latest),
    baseline: side(baseline),
    entities: {
      gained: entities(only(nowNamed, wasNamed)),
      lost: entities(only(wasNamed, nowNamed)),
      kept: entities([...nowNamed].filter(([id]) => wasNamed.has(id)).map(([, entity]) => entity)),
    },
    sources: {
      gained: sources(only(nowCited, wasCited)),
      lost: sources(only(wasCited, nowCited)),
      kept_count: [...nowCited.keys()].filter((domain) => wasCited.has(domain)).length,
    },
  };
}

export const evidenceHandlers: HttpHandler[] = [
  mock('get', COMPARE, ({ request, cookies, params }) => {
    // The route takes no parameter; the `observed_at` hint of the detail route is read and ignored, as the API does
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['observed_at'],
    });
    if (caller instanceof Response) return caller;
    const id = idOf(String(params.observation_id));
    if (typeof id !== 'bigint') return invalid(request, [id]);
    const projectId = caller.project.project_id;
    const now = Date.now();
    const latest = findAnswer(projectId, id, null, now);
    if (latest === null) return problem(request, 'not_found');
    // `answersOf` is newest first, so the first match is the newest earlier answer
    const baseline = answersOf(projectId, now).find(isBaselineOf(latest));
    return baseline === undefined ? noBaseline(request) : HttpResponse.json({ data: compare(latest, baseline) });
  }),
];
