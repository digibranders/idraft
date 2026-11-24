import { onMockReset } from './state';
import type {
  ClientReport,
  CreatedReportShare,
  ReportExpiryDays,
  ReportSchedule,
  ReportScheduleFrequency,
  ReportShare,
  ReportShareState,
} from '@/lib/reports/types';
import type { MetricCell } from '@/lib/api/types';

/**
 * The client reports of the mock API: links and scheduled emails per project, and the public report a token opens.
 * Like every mock state it lives in the memory of one page session and starts again on a reset. A token is kept as
 * made (the API keeps only its hash) and is answered once, by the create.
 */

const DAY_MS = 86_400_000;
/** The token that always answers 429, so a screen and its tests can show the wait. */
export const RATE_LIMITED_REPORT_TOKEN = 'rate-limited-report-token';

interface StoredShare {
  id: string;
  project_id: string;
  token: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

interface StoredSchedule extends ReportSchedule {
  project_id: string;
}

let shares: StoredShare[] = [];
let schedules: StoredSchedule[] = [];
let counter = 0;
onMockReset(() => {
  shares = [];
  schedules = [];
  counter = 0;
});

const nextId = (): string => {
  counter += 1;
  // Ids sort in the order they were made
  return `0192e4a0-b000-7000-8000-${String(counter).padStart(12, '0')}`;
};

const stateOf = (share: StoredShare, now: number): ReportShareState =>
  share.revoked_at !== null ? 'revoked' : Date.parse(share.expires_at) <= now ? 'expired' : 'active';

const viewOf = (share: StoredShare, now: number): ReportShare => ({
  id: share.id,
  created_at: share.created_at,
  created_by: share.created_by,
  expires_at: share.expires_at,
  revoked_at: share.revoked_at,
  state: stateOf(share, now),
});

const hex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');

export function reportSharesOf(projectId: string, now = Date.now()): ReportShare[] {
  return shares
    .filter((share) => share.project_id === projectId)
    .map((share) => viewOf(share, now))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}

export function createReportShare(
  projectId: string,
  userId: string,
  days: ReportExpiryDays,
  now = Date.now(),
): CreatedReportShare {
  const share: StoredShare = {
    id: nextId(),
    project_id: projectId,
    token: hex(24),
    created_by: userId,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + days * DAY_MS).toISOString(),
    revoked_at: null,
  };
  shares = [...shares, share];
  return { ...viewOf(share, now), token: share.token };
}

/** Revokes a link of the project; null for one the project does not have. Revoking twice changes nothing. */
export function revokeReportShare(projectId: string, shareId: string, now = Date.now()): ReportShare | null {
  const share = shares.find((candidate) => candidate.id === shareId && candidate.project_id === projectId);
  if (share === undefined) return null;
  share.revoked_at ??= new Date(now).toISOString();
  return viewOf(share, now);
}

/** The project a token opens, or null for an unknown, expired or revoked one. */
export function projectOfReportToken(token: string, now = Date.now()): string | null {
  const share = shares.find((candidate) => candidate.token === token);
  return share !== undefined && stateOf(share, now) === 'active' ? share.project_id : null;
}

/** The first send after `now`: Monday 06:00 UTC for weekly, the 1st at 06:00 UTC for monthly. */
export function nextSlot(frequency: ReportScheduleFrequency, now: number): string {
  const at = new Date(now);
  if (frequency === 'weekly') {
    const monday = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - ((at.getUTCDay() + 6) % 7), 6);
    return new Date(monday > now ? monday : monday + 7 * DAY_MS).toISOString();
  }
  const first = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1, 6);
  return new Date(first > now ? first : Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1, 6)).toISOString();
}

const scheduleView = (stored: StoredSchedule): ReportSchedule => ({
  id: stored.id,
  frequency: stored.frequency,
  recipients: stored.recipients,
  paused: stored.paused,
  next_run_at: stored.next_run_at,
  last_sent_at: stored.last_sent_at,
  last_error: stored.last_error,
  created_by: stored.created_by,
  created_at: stored.created_at,
});

export const reportSchedulesOf = (projectId: string): ReportSchedule[] =>
  schedules.filter((schedule) => schedule.project_id === projectId).map(scheduleView);

export function createReportSchedule(
  projectId: string,
  userId: string,
  body: { frequency: ReportScheduleFrequency; recipients: string[] },
  now = Date.now(),
): ReportSchedule {
  const schedule: StoredSchedule = {
    id: nextId(),
    project_id: projectId,
    frequency: body.frequency,
    recipients: body.recipients,
    paused: false,
    next_run_at: nextSlot(body.frequency, now),
    last_sent_at: null,
    last_error: null,
    created_by: userId,
    created_at: new Date(now).toISOString(),
  };
  schedules = [...schedules, schedule];
  return scheduleView(schedule);
}

export function updateReportSchedule(
  projectId: string,
  scheduleId: string,
  body: { frequency?: ReportScheduleFrequency | null; recipients?: string[] | null; paused?: boolean | null },
  now = Date.now(),
): ReportSchedule | null {
  const schedule = schedules.find((candidate) => candidate.id === scheduleId && candidate.project_id === projectId);
  if (schedule === undefined) return null;
  if (body.recipients != null) schedule.recipients = body.recipients;
  if (body.paused != null) schedule.paused = body.paused;
  if (body.frequency != null) schedule.frequency = body.frequency;
  // A new rhythm, or a schedule that runs again, waits for its next slot
  if (body.frequency != null || body.paused === false) schedule.next_run_at = nextSlot(schedule.frequency, now);
  return scheduleView(schedule);
}

export function deleteReportSchedule(projectId: string, scheduleId: string): boolean {
  const before = schedules.length;
  schedules = schedules.filter((schedule) => !(schedule.id === scheduleId && schedule.project_id === projectId));
  return schedules.length < before;
}

const cell = (successes: number, trials: number): MetricCell => ({
  value: trials > 0 ? successes / trials : null,
  numerator: successes,
  denominator: trials,
  n_observations: trials,
  pooled: { successes, trials },
});
const week = (
  start: string,
  mentioned: [number, number],
  cited: [number, number],
): ClientReport['engines'][number]['weeks'][number] => ({
  week_start: start,
  is_pooled: false,
  pool_weeks: null,
  mentioned: cell(...mentioned),
  cited: cell(...cited),
});

/** The report every active link of the mock opens: the last 28 days of Eventus Security on two engines. */
export function publicReport(): ClientReport {
  return {
    host: 'eventussecurity.com',
    window_from: '2026-10-28',
    window_to: '2026-11-24',
    timezone: 'Asia/Kolkata',
    generated_at: new Date().toISOString(),
    prompt_count: 24,
    engines: [
      {
        engine_code: 'chatgpt_web',
        mentioned: cell(71, 192),
        cited: cell(38, 192),
        weeks: [
          week('2026-10-26', [13, 48], [6, 48]),
          week('2026-11-02', [15, 48], [8, 48]),
          week('2026-11-09', [19, 48], [11, 48]),
          week('2026-11-16', [24, 48], [13, 48]),
        ],
      },
      {
        engine_code: 'gemini_web',
        mentioned: cell(44, 168),
        cited: cell(29, 168),
        weeks: [
          week('2026-10-26', [8, 42], [5, 42]),
          week('2026-11-02', [9, 42], [6, 42]),
          week('2026-11-09', [12, 42], [8, 42]),
          week('2026-11-16', [15, 42], [10, 42]),
        ],
      },
    ],
    brands: [
      {
        name: 'Eventus Security',
        role: 'own',
        engines: [
          { engine_code: 'chatgpt_web', mentioned: cell(71, 192) },
          { engine_code: 'gemini_web', mentioned: cell(44, 168) },
        ],
      },
      {
        name: 'CyberNX',
        role: 'competitor',
        engines: [
          { engine_code: 'chatgpt_web', mentioned: cell(96, 192) },
          { engine_code: 'gemini_web', mentioned: cell(81, 168) },
        ],
      },
      {
        name: 'Wipro CyberSecurity',
        role: 'competitor',
        engines: [
          { engine_code: 'chatgpt_web', mentioned: cell(47, 192) },
          { engine_code: 'gemini_web', mentioned: cell(76, 168) },
        ],
      },
    ],
    cited_domains: [
      {
        registrable_domain: 'eventussecurity.com',
        domain_role: 'own',
        citation_units: 67,
        source_share: cell(67, 413),
      },
      { registrable_domain: 'cybernx.com', domain_role: 'competitor', citation_units: 58, source_share: cell(58, 413) },
      {
        registrable_domain: 'gartner.com',
        domain_role: 'third_party',
        citation_units: 41,
        source_share: cell(41, 413),
      },
      {
        registrable_domain: 'techtarget.com',
        domain_role: 'third_party',
        citation_units: 33,
        source_share: cell(33, 413),
      },
    ],
  };
}
