import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller } from './access';
import {
  createReportSchedule,
  createReportShare,
  deleteReportSchedule,
  projectOfReportToken,
  publicReport,
  RATE_LIMITED_REPORT_TOKEN,
  reportSchedulesOf,
  reportSharesOf,
  revokeReportShare,
  updateReportSchedule,
} from '../reports-world';
import { invalidField, mock, problem } from '../respond';
import { expiryDaysValues, reportScheduleFrequencyValues } from '@/lib/api/schema';
import {
  RECIPIENTS_MAX,
  SCHEDULES_MAX,
  type ReportExpiryDays,
  type ReportScheduleFrequency,
} from '@/lib/reports/types';

/**
 * The client report routes of the backend: a project's links and scheduled emails, and the public report a token
 * opens. The public route needs no session; an unknown, expired or revoked token all answer `404 not_found`, and
 * `RATE_LIMITED_REPORT_TOKEN` answers `429 rate_limited` with a `Retry-After`.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/reports';
const DEFAULT_EXPIRY: ReportExpiryDays = 30;
const RETRY_AFTER_SECONDS = 90;
const ADDRESS = /^[^\s@,;<>]+@[^\s@,;<>]+$/;

const field = (body: unknown, name: string): unknown =>
  typeof body === 'object' && body !== null && name in body ? (body as Record<string, unknown>)[name] : undefined;

const frequencyOf = (value: unknown): ReportScheduleFrequency | null =>
  reportScheduleFrequencyValues.find((frequency) => frequency === value) ?? null;

/** The recipients of a body: one to ten distinct addresses, trimmed and in lower case; null when one is not an address. */
function recipientsOf(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > RECIPIENTS_MAX) return null;
  if (!value.every((entry): entry is string => typeof entry === 'string' && ADDRESS.test(entry.trim()))) return null;
  return [...new Set(value.map((entry) => entry.trim().toLowerCase()))];
}

export const reportHandlers: HttpHandler[] = [
  mock('get', `${P}/shares`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'data:read' });
    if (caller instanceof Response) return caller;
    return HttpResponse.json({ data: reportSharesOf(caller.project.project_id) });
  }),

  mock('post', `${P}/shares`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const raw = field(await request.json().catch(() => ({})), 'expires_in_days');
    const days = raw === undefined ? DEFAULT_EXPIRY : (expiryDaysValues.find((value) => value === raw) ?? null);
    if (days === null) return invalidField(request, 'expires_in_days', 'enum', 'Use 7, 30 or 90.');
    const created = createReportShare(caller.project.project_id, caller.session.user.user_id, days);
    return HttpResponse.json({ data: created }, { status: 201 });
  }),

  mock('delete', `${P}/shares/{report_share_id}`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const share = revokeReportShare(caller.project.project_id, String(params.report_share_id));
    return share === null ? problem(request, 'not_found') : HttpResponse.json({ data: share });
  }),

  mock('get', `${P}/schedules`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'data:read' });
    if (caller instanceof Response) return caller;
    return HttpResponse.json({ data: reportSchedulesOf(caller.project.project_id) });
  }),

  mock('post', `${P}/schedules`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json().catch(() => ({}));
    const frequency = frequencyOf(field(body, 'frequency'));
    if (frequency === null) return invalidField(request, 'frequency', 'enum', 'Use weekly or monthly.');
    const recipients = recipientsOf(field(body, 'recipients'));
    if (recipients === null) {
      return invalidField(request, 'recipients', 'value_error', `Give one to ${RECIPIENTS_MAX} email addresses.`);
    }
    if (reportSchedulesOf(caller.project.project_id).length >= SCHEDULES_MAX) {
      return problem(request, 'schedule_limit');
    }
    const created = createReportSchedule(caller.project.project_id, caller.session.user.user_id, {
      frequency,
      recipients,
    });
    return HttpResponse.json({ data: created }, { status: 201 });
  }),

  mock('patch', `${P}/schedules/{report_schedule_id}`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json().catch(() => ({}));
    const recipients = field(body, 'recipients') === undefined ? undefined : recipientsOf(field(body, 'recipients'));
    if (recipients === null) {
      return invalidField(request, 'recipients', 'value_error', `Give one to ${RECIPIENTS_MAX} email addresses.`);
    }
    const paused = field(body, 'paused');
    const frequency = field(body, 'frequency') === undefined ? undefined : frequencyOf(field(body, 'frequency'));
    const changed = updateReportSchedule(caller.project.project_id, String(params.report_schedule_id), {
      ...(frequency === undefined ? {} : { frequency }),
      ...(recipients === undefined ? {} : { recipients }),
      ...(typeof paused === 'boolean' ? { paused } : {}),
    });
    return changed === null ? problem(request, 'not_found') : HttpResponse.json({ data: changed });
  }),

  mock('delete', `${P}/schedules/{report_schedule_id}`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    return deleteReportSchedule(caller.project.project_id, String(params.report_schedule_id))
      ? new HttpResponse(null, { status: 204 })
      : problem(request, 'not_found');
  }),

  mock('get', '/api/v1/public/reports/{token}', ({ request, params }) => {
    const token = String(params.token);
    if (token === RATE_LIMITED_REPORT_TOKEN) {
      return problem(request, 'rate_limited', { headers: { 'retry-after': String(RETRY_AFTER_SECONDS) } });
    }
    return projectOfReportToken(token) === null
      ? problem(request, 'not_found')
      : HttpResponse.json({ data: publicReport() });
  }),
];
