import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller } from './access';
import { isOneOf, queryError } from './rules';
import { aiReferralsAnswer, comparedPeriod, type ReferralClassifier } from '../ai-referrals';
import { integrationWorld, liveIntegrations } from '../integrations-state';
import { invalid, mock, problem } from '../respond';
import { daysBetween, shiftIsoDate, validateDateWindow } from '../serp-views';
import type { ValidationItem } from '@/lib/api/types';
import { formatIsoDate } from '@/lib/format';

/**
 * WP-69: `GET {P}/fp/ai-referrals` (19 section 3.10, docs/ai-visibility/contracts/fp-ai-referrals.md): the visits from
 * AI platforms of the project's GA4 property, per platform, counted two ways. The project is connected when the
 * browser linked a GA4 property to it on the integrations page (the mocks keep that in a cookie), so the card can
 * be walked from "not connected" to its figures; the figures come from ../ai-referrals.ts. `group_by` other than
 * `assistant` answers `not_available`, as the route does for `landing_page`: the mock builds the one grouping the card asks.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const ALLOWED = ['from', 'to', 'compare', 'compare_from', 'compare_to', 'group_by', 'classifier'];
const DEFAULT_DAYS = 28;
const MAX_DAYS = 92;
const COMPARES = ['none', 'previous_period', 'previous_year'] as const;
const GROUPS = ['assistant', 'origin', 'landing_page'] as const;
const CLASSIFIERS = ['both', 'ga4_ai_assistant_channel', 'own_rules'] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A query parameter that must be one of `allowed`, or a field error. */
function choice<T extends string>(
  url: URL,
  name: string,
  allowed: readonly T[],
  fallback: T,
  errors: ValidationItem[],
): T {
  const value = url.searchParams.get(name);
  if (value === null) return fallback;
  if (isOneOf(value, allowed)) return value;
  errors.push(queryError(name, 'enum', `Allowed: ${allowed.join(', ')}.`));
  return fallback;
}

export const firstPartyHandlers: HttpHandler[] = [
  mock('get', `${P}/fp/ai-referrals`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ALLOWED,
    });
    if (caller instanceof Response) return caller;
    const { url } = caller;
    const errors: ValidationItem[] = [];
    const compare = choice(url, 'compare', COMPARES, 'none', errors);
    const group = choice(url, 'group_by', GROUPS, 'assistant', errors);
    const classifier: ReferralClassifier = choice(url, 'classifier', CLASSIFIERS, 'both', errors);
    const now = Date.now();
    const zone = caller.project.timezone;
    const today = formatIsoDate(new Date(now).toISOString(), zone);
    const toParam = url.searchParams.get('to');
    const fromParam = url.searchParams.get('from');
    const window = validateDateWindow(
      fromParam ?? shiftIsoDate(toParam ?? today, 1 - DEFAULT_DAYS),
      toParam,
      now,
      zone,
      MAX_DAYS,
    );
    if ('error' in window) errors.push(window.error);
    const ownFrom = url.searchParams.get('compare_from');
    const ownTo = url.searchParams.get('compare_to');
    if ((ownFrom === null) !== (ownTo === null)) {
      errors.push(queryError(ownFrom === null ? 'compare_from' : 'compare_to', 'missing', 'Give both or neither.'));
    }
    for (const [name, value] of [
      ['compare_from', ownFrom],
      ['compare_to', ownTo],
    ] as const) {
      if (value !== null && !ISO_DATE.test(value)) {
        errors.push(queryError(name, 'date_parsing', 'Input should be a valid date'));
      }
    }
    if (errors.length > 0) return invalid(request, errors);
    if ('problem' in window) {
      return problem(request, 'window_too_large', {
        detail: `A request covers at most ${String(MAX_DAYS)} days.`,
        limit_days: MAX_DAYS,
      });
    }
    // Pushed to `errors` above and answered; this narrows the type
    if ('error' in window) return invalid(request, [window.error]);
    if (group !== 'assistant') {
      return problem(request, 'not_available', { detail: 'The mock groups the visits by platform only.' });
    }
    const { firstDate: from, lastDate: to } = window.range;
    const own = ownFrom !== null && ownTo !== null ? { from: ownFrom, to: ownTo } : null;
    if (own !== null && (own.from > own.to || daysBetween(own.from, own.to) > MAX_DAYS)) {
      return invalid(request, [queryError('compare_from', 'range_invalid', 'The compared period is not valid.')]);
    }
    const compared = own ?? (compare === 'none' ? null : comparedPeriod(compare, from, to));
    const connected = liveIntegrations(integrationWorld(cookies)).some(
      (row) => row.kind === 'ga4' && row.projectId === caller.project.project_id,
    );
    return HttpResponse.json(
      aiReferralsAnswer({ from, to, compare: compared, classifier, timezone: zone, connected, today, now }),
    );
  }),
];
