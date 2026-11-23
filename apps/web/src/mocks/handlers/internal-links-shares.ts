import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller } from './access';
import {
  createShare,
  projectOfToken,
  publicSummary,
  RATE_LIMITED_TOKEN,
  revokeShare,
  sharesOf,
} from '../internal-links-shares-world';
import { invalidField, mock, problem } from '../respond';
import { expiryDaysValues } from '@/lib/api/schema';
import type { ExpiryDays } from '@/lib/internal-links/types';

/**
 * The client summary link routes of the backend: a project's links (made, listed, revoked) and the public summary
 * a token opens. The public route needs no session; an unknown, expired or revoked token all answer `404 not_found`,
 * and `RATE_LIMITED_TOKEN` answers `429 rate_limited` with a `Retry-After`.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const DEFAULT_EXPIRY: ExpiryDays = 30;
const RETRY_AFTER_SECONDS = 90;

const expiryOf = (value: unknown): ExpiryDays | null =>
  value === undefined ? DEFAULT_EXPIRY : (expiryDaysValues.find((days) => days === value) ?? null);

export const internalLinkShareHandlers: HttpHandler[] = [
  mock('get', `${P}/internal-links/shares`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'data:read' });
    if (caller instanceof Response) return caller;
    return HttpResponse.json({ data: sharesOf(caller.project.project_id) });
  }),

  mock('post', `${P}/internal-links/shares`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json().catch(() => ({}));
    const raw =
      typeof body === 'object' && body !== null && 'expires_in_days' in body ? body.expires_in_days : undefined;
    const days = expiryOf(raw);
    if (days === null) {
      return invalidField(request, 'expires_in_days', 'enum', 'Use 7, 30 or 90.');
    }
    const created = createShare(caller.project.project_id, caller.session.user.user_id, days);
    return HttpResponse.json({ data: created }, { status: 201 });
  }),

  mock('delete', `${P}/internal-links/shares/{share_id}`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const share = revokeShare(caller.project.project_id, String(params.share_id));
    return share === null ? problem(request, 'not_found') : HttpResponse.json({ data: share });
  }),

  mock('get', '/api/v1/public/internal-links/summary/{token}', ({ request, params }) => {
    const token = String(params.token);
    if (token === RATE_LIMITED_TOKEN) {
      return problem(request, 'rate_limited', { headers: { 'retry-after': String(RETRY_AFTER_SECONDS) } });
    }
    const projectId = projectOfToken(token);
    const summary = projectId === null ? null : publicSummary(projectId);
    return summary === null ? problem(request, 'not_found') : HttpResponse.json({ data: summary });
  }),
];
