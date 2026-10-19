import { describe, expect, it } from 'vitest';

import {
  CADENCES,
  DEFAULT_STALE_DAYS,
  OFFERED_PROVIDER_MODES,
  PROVIDER_MODES,
  SCHEDULE_ERROR_KEYS,
  SCHEDULE_PRIORITIES,
  SCHEDULE_WORKLOADS,
  SELECTOR_MODES,
  WORKLOAD_PROVIDER_MODES,
  WORKLOAD_SELECTOR_MODES,
  clockOf,
  createBodyOf,
  errorMessageKey,
  errorTarget,
  isRetiredProviderMode,
  isClock,
  isEditableSchedule,
  newScheduleValues,
  selectorOfValues,
  selectorParts,
  updateBodyOf,
  valuesOfSchedule,
  wholeNumber,
  type ScheduleValues,
} from './schedule-model';
import {
  scheduleCadenceValues,
  schedulePriorityValues,
  scheduleProvider_modeValues,
  scheduleWorkloadValues,
} from '@/lib/api/schema';
import type { Schedule } from '@/lib/api/types';

const GROUP = '11111111-1111-4111-8111-111111111111';
const OTHER_GROUP = '22222222-2222-4222-8222-222222222222';
const TERM = '33333333-3333-4333-8333-333333333333';

const SCHEDULE: Schedule = {
  schedule_id: '44444444-4444-4444-8444-444444444444',
  project_id: '55555555-5555-4555-8555-555555555555',
  name: 'Daily rankings',
  workload: 'seo_rank',
  cadence: 'daily',
  weekday: null,
  month_day: null,
  cron_expr: null,
  window_start_local: '02:00:00',
  window_hours: 6,
  timezone: 'Europe/Berlin',
  priority: 'standard',
  provider_mode: 'standard_queue',
  selector: { all: true },
  is_active: true,
  next_run_at: '2026-10-02T00:00:00.000Z',
  last_run_id: null,
  created_at: '2026-09-29T10:00:00.000Z',
};

const withSchedule = (change: Partial<Schedule>): Schedule => ({ ...SCHEDULE, ...change });
const valuesWith = (change: Partial<ScheduleValues>, schedule: Schedule = SCHEDULE): ScheduleValues => ({
  ...valuesOfSchedule(schedule),
  ...change,
});

describe('the values the schedule form offers', () => {
  it('stay inside what the API takes', () => {
    expect(SCHEDULE_WORKLOADS.every((workload) => scheduleWorkloadValues.includes(workload))).toBe(true);
    expect(CADENCES.every((cadence) => scheduleCadenceValues.includes(cadence))).toBe(true);
    expect([...SCHEDULE_PRIORITIES].sort()).toEqual([...schedulePriorityValues].sort());
    expect([...PROVIDER_MODES].sort()).toEqual([...scheduleProvider_modeValues].sort());
  });

  it('offer rankings the standard and the priority queue, and keyword metrics no mode at all', () => {
    expect(OFFERED_PROVIDER_MODES).toEqual(['standard_queue', 'priority_queue']);
    expect(WORKLOAD_PROVIDER_MODES.seo_rank).toEqual(['standard_queue', 'priority_queue']);
    expect(WORKLOAD_PROVIDER_MODES.keyword_metrics).toEqual([]);
    // Live stays readable: the API still names it on a schedule it returns
    expect(PROVIDER_MODES).toContain('live');
    expect(OFFERED_PROVIDER_MODES).not.toContain('live');
  });

  it('call a live rank schedule retired, and no other schedule', () => {
    expect(isRetiredProviderMode(withSchedule({ provider_mode: 'live' }))).toBe(true);
    expect(isRetiredProviderMode(withSchedule({ provider_mode: 'priority_queue' }))).toBe(false);
    expect(isRetiredProviderMode(withSchedule({ workload: 'keyword_metrics', provider_mode: 'live' }))).toBe(false);
  });

  it('never offer cron, which the planner has no rule for', () => {
    expect(CADENCES).toEqual(['daily', 'weekly', 'monthly']);
  });

  it('give each workload the selectors the API takes for it', () => {
    expect(WORKLOAD_SELECTOR_MODES.keyword_metrics).toEqual(['stale', 'all', 'groups']);
    expect(WORKLOAD_SELECTOR_MODES.seo_rank).toEqual(['all', 'groups', 'priority']);
    expect(SELECTOR_MODES).toEqual(['stale', 'all', 'groups', 'priority']);
  });

  it('start a new schedule in the project time zone, on the workload its first selector fits', () => {
    expect(newScheduleValues('Asia/Tokyo')).toMatchObject({
      workload: 'keyword_metrics',
      cadence: 'daily',
      timezone: 'Asia/Tokyo',
      selector_mode: 'stale',
      stale_days: String(DEFAULT_STALE_DAYS),
      provider_mode: 'standard_queue',
    });
  });

  it('read a schedule back with its time as hours and minutes', () => {
    expect(valuesOfSchedule(SCHEDULE)).toMatchObject({
      name: 'Daily rankings',
      window_start_local: '02:00',
      window_hours: '6',
      weekday: '1',
      month_day: '1',
      selector_mode: 'all',
    });
    expect(clockOf('06:30:00')).toBe('06:30');
    expect(clockOf('06:30')).toBe('06:30');
  });

  it('read the mode of a selector from what it names', () => {
    expect(valuesOfSchedule(withSchedule({ workload: 'keyword_metrics', selector: { stale_days: 7 } }))).toMatchObject({
      selector_mode: 'stale',
      stale_days: '7',
    });
    expect(valuesOfSchedule(withSchedule({ selector: { priority_lte: 2 } }))).toMatchObject({
      selector_mode: 'priority',
      priority_lte: '2',
    });
    expect(valuesOfSchedule(withSchedule({ selector: { groups: [GROUP], terms: [TERM] } }))).toMatchObject({
      selector_mode: 'groups',
      groups: [GROUP],
      terms: [TERM],
    });
  });
});

describe('the checks of the form', () => {
  it('takes a time of day only as HH:MM', () => {
    expect(['00:00', '06:30', '23:59'].every(isClock)).toBe(true);
    expect(['6:30', '24:00', '06:60', '06:30:00', '06:30+02:00', '', 'noon'].some(isClock)).toBe(false);
  });

  it('reads a whole number inside its range, and nothing else', () => {
    expect(wholeNumber('25', 1, 365)).toBe(25);
    expect(wholeNumber(' 25 ', 1, 365)).toBe(25);
    expect(['0', '366', '2.5', '-3', '1e2', '', 'abc'].map((text) => wholeNumber(text, 1, 365))).toEqual(
      Array.from({ length: 7 }, () => null),
    );
  });

  it('edits only the two workloads this step runs, and never a cron schedule', () => {
    expect(isEditableSchedule(SCHEDULE)).toBe(true);
    expect(isEditableSchedule(withSchedule({ workload: 'gsc_sync' }))).toBe(false);
    expect(isEditableSchedule(withSchedule({ cadence: 'cron', cron_expr: '0 2 * * *' }))).toBe(false);
  });
});

describe('the selector a form sends', () => {
  it('is all, the days, the priority, or the groups and terms, by mode', () => {
    expect(selectorOfValues(valuesWith({ selector_mode: 'all' }))).toEqual({ all: true });
    expect(selectorOfValues(valuesWith({ selector_mode: 'stale', stale_days: '10' }))).toEqual({ stale_days: 10 });
    expect(selectorOfValues(valuesWith({ selector_mode: 'priority', priority_lte: '3' }))).toEqual({
      priority_lte: 3,
    });
    expect(selectorOfValues(valuesWith({ selector_mode: 'groups', groups: [GROUP], terms: [] }))).toEqual({
      groups: [GROUP],
    });
  });

  it('keeps what the form cannot show of a schedule that names a group and more', () => {
    const stale = withSchedule({ workload: 'keyword_metrics', selector: { stale_days: 25, groups: [GROUP] } });
    expect(selectorOfValues(valuesOfSchedule(stale), stale.selector)).toEqual({ stale_days: 25, groups: [GROUP] });
    expect(selectorOfValues({ ...valuesOfSchedule(stale), selector_mode: 'all' }, stale.selector)).toEqual({
      all: true,
    });
    const ranked = withSchedule({ selector: { priority_lte: 2, terms: [TERM] } });
    expect(selectorOfValues(valuesOfSchedule(ranked), ranked.selector)).toEqual({ priority_lte: 2, terms: [TERM] });
  });

  it('keeps nothing of a stale or priority selector once it is switched to groups', () => {
    const stale = withSchedule({ workload: 'keyword_metrics', selector: { stale_days: 25 } });
    expect(selectorOfValues(valuesWith({ selector_mode: 'groups', groups: [GROUP] }, stale), stale.selector)).toEqual({
      groups: [GROUP],
    });
    const priority = withSchedule({ selector: { priority_lte: 2 } });
    expect(
      selectorOfValues(valuesWith({ selector_mode: 'groups', terms: [TERM] }, priority), priority.selector),
    ).toEqual({ terms: [TERM] });
    const all = withSchedule({ selector: { all: true } });
    expect(selectorOfValues(valuesWith({ selector_mode: 'groups', groups: [GROUP] }, all), all.selector)).toEqual({
      groups: [GROUP],
    });
  });

  it('keeps what a groups selector already had when its groups change', () => {
    const kept = withSchedule({ workload: 'keyword_metrics', selector: { stale_days: 25, groups: [GROUP] } });
    expect(selectorOfValues(valuesWith({ groups: [OTHER_GROUP] }, kept), kept.selector)).toEqual({
      groups: [OTHER_GROUP],
      stale_days: 25,
    });
    // A member the workload does not take is not carried over to its selector
    const ranked = withSchedule({ selector: { priority_lte: 2, groups: [GROUP] } });
    expect(selectorOfValues(valuesWith({ groups: [OTHER_GROUP] }, ranked), ranked.selector)).toEqual({
      groups: [OTHER_GROUP],
      priority_lte: 2,
    });
  });
});

describe('the body of a new schedule', () => {
  it('leaves the provider mode out for keyword metrics, whose mode is the workload’s own', () => {
    const body = createBodyOf({
      ...newScheduleValues('Europe/Berlin'),
      name: '  Monthly metrics ',
      window_start_local: '03:00',
      window_hours: '2',
    });
    expect(body).toEqual({
      name: 'Monthly metrics',
      workload: 'keyword_metrics',
      cadence: 'daily',
      window_start_local: '03:00',
      window_hours: 2,
      timezone: 'Europe/Berlin',
      priority: 'standard',
      selector: { stale_days: 25 },
    });
    expect(body).not.toHaveProperty('provider_mode');
  });

  it('sends the weekday of a weekly schedule, with the provider mode of a rank schedule', () => {
    const body = createBodyOf({
      ...newScheduleValues('UTC'),
      name: 'Weekly',
      workload: 'seo_rank',
      cadence: 'weekly',
      weekday: '0',
      provider_mode: 'priority_queue',
      selector_mode: 'groups',
      groups: [GROUP, OTHER_GROUP],
    });
    expect(body).toMatchObject({ cadence: 'weekly', weekday: 0, provider_mode: 'priority_queue' });
    expect(body).toMatchObject({ selector: { groups: [GROUP, OTHER_GROUP] } });
    expect(body).not.toHaveProperty('month_day');
  });

  it('never sends live for a rank schedule, and a form that holds it is a mistake of the caller', () => {
    const rank: ScheduleValues = {
      ...newScheduleValues('UTC'),
      name: 'Ranks',
      workload: 'seo_rank',
      selector_mode: 'all',
    };
    expect(createBodyOf({ ...rank, provider_mode: 'standard_queue' })).toMatchObject({
      provider_mode: 'standard_queue',
    });
    expect(() => createBodyOf({ ...rank, provider_mode: 'live' })).toThrow(/live/);
  });

  it('sends the day of the month of a monthly schedule and no weekday', () => {
    const body = createBodyOf({
      ...newScheduleValues('UTC'),
      name: 'Monthly',
      cadence: 'monthly',
      month_day: '28',
    });
    expect(body).toMatchObject({ cadence: 'monthly', month_day: 28 });
    expect(body).not.toHaveProperty('weekday');
  });
});

describe('the body of a change', () => {
  it('is empty while nothing changed, whitespace around the name included', () => {
    expect(updateBodyOf(valuesOfSchedule(SCHEDULE), SCHEDULE)).toEqual({});
    expect(updateBodyOf(valuesWith({ name: '  Daily rankings  ' }), SCHEDULE)).toEqual({});
  });

  it('sends the fields that changed and no others', () => {
    expect(updateBodyOf(valuesWith({ name: 'Rankings', window_hours: '4' }), SCHEDULE)).toEqual({
      name: 'Rankings',
      window_hours: 4,
    });
    expect(updateBodyOf(valuesWith({ window_start_local: '15:30', priority: 'high' }), SCHEDULE)).toEqual({
      window_start_local: '15:30',
      priority: 'high',
    });
    expect(updateBodyOf(valuesWith({ timezone: 'Asia/Tokyo' }), SCHEDULE)).toEqual({ timezone: 'Asia/Tokyo' });
  });

  it('names the day when the cadence starts to use one, and not when it stops', () => {
    expect(updateBodyOf(valuesWith({ cadence: 'weekly', weekday: '3' }), SCHEDULE)).toEqual({
      cadence: 'weekly',
      weekday: 3,
    });
    expect(updateBodyOf(valuesWith({ cadence: 'monthly', month_day: '15' }), SCHEDULE)).toEqual({
      cadence: 'monthly',
      month_day: 15,
    });
    const weekly = withSchedule({ cadence: 'weekly', weekday: 1 });
    expect(updateBodyOf(valuesWith({ cadence: 'daily', weekday: '1' }, weekly), weekly)).toEqual({ cadence: 'daily' });
    expect(updateBodyOf(valuesWith({ weekday: '5' }, weekly), weekly)).toEqual({ weekday: 5 });
    expect(updateBodyOf(valuesWith({ cadence: 'monthly', month_day: '2' }, weekly), weekly)).toEqual({
      cadence: 'monthly',
      month_day: 2,
    });
  });

  it('leaves a day alone that a schedule of another cadence only remembers in the form', () => {
    const weekly = withSchedule({ cadence: 'weekly', weekday: 1 });
    expect(updateBodyOf(valuesWith({ month_day: '9' }, weekly), weekly)).toEqual({});
  });

  it('sends the selector once its meaning changed, and never the provider mode of keyword metrics', () => {
    expect(updateBodyOf(valuesWith({ selector_mode: 'priority', priority_lte: '2' }), SCHEDULE)).toEqual({
      selector: { priority_lte: 2 },
    });
    expect(updateBodyOf(valuesWith({ selector_mode: 'groups', groups: [GROUP] }), SCHEDULE)).toEqual({
      selector: { groups: [GROUP] },
    });
    // The groups chosen in another order are the same selector
    const two = withSchedule({ selector: { groups: [GROUP, OTHER_GROUP] } });
    expect(updateBodyOf(valuesWith({ groups: [OTHER_GROUP, GROUP] }, two), two)).toEqual({});
    const metrics = withSchedule({ workload: 'keyword_metrics', provider_mode: 'live', selector: { stale_days: 25 } });
    expect(updateBodyOf(valuesWith({ provider_mode: 'standard_queue' }, metrics), metrics)).toEqual({});
    expect(updateBodyOf(valuesWith({ provider_mode: 'live', stale_days: '30' }, metrics), metrics)).toEqual({
      selector: { stale_days: 30 },
    });
  });

  it('sends the provider mode of a rank schedule when it changed, and never live', () => {
    expect(updateBodyOf(valuesWith({ provider_mode: 'priority_queue' }), SCHEDULE)).toEqual({
      provider_mode: 'priority_queue',
    });
    expect(() => updateBodyOf(valuesWith({ provider_mode: 'live' }), SCHEDULE)).toThrow(/live/);
  });

  it('sends no provider mode for a rank schedule that still holds live, until a queue is chosen', () => {
    const held = withSchedule({ provider_mode: 'live' });
    expect(valuesOfSchedule(held).provider_mode).toBe('live');
    expect(updateBodyOf(valuesWith({ name: 'Renamed' }, held), held)).toEqual({ name: 'Renamed' });
    expect(updateBodyOf(valuesWith({}, held), held)).toEqual({});
    expect(updateBodyOf(valuesWith({ provider_mode: 'standard_queue' }, held), held)).toEqual({
      provider_mode: 'standard_queue',
    });
  });

  it('sends the name alone for a rename, whatever the selector holds that the form cannot show', () => {
    // All keywords up to a priority: the radio shows "all keywords", and the priority is not its to rewrite
    const allAndPriority = withSchedule({ selector: { all: true, priority_lte: 2 } });
    expect(updateBodyOf(valuesWith({ name: 'Renamed' }, allAndPriority), allAndPriority)).toEqual({ name: 'Renamed' });
    // A keyword metrics schedule with no selector at all reads as the staleness default
    const bare = withSchedule({ workload: 'keyword_metrics', provider_mode: 'live', selector: {} });
    expect(updateBodyOf(valuesWith({ name: 'Renamed' }, bare), bare)).toEqual({ name: 'Renamed' });
    const groupsAndDays = withSchedule({
      workload: 'keyword_metrics',
      provider_mode: 'live',
      selector: { stale_days: 25, groups: [GROUP] },
    });
    expect(updateBodyOf(valuesWith({ name: 'Renamed' }, groupsAndDays), groupsAndDays)).toEqual({ name: 'Renamed' });
  });

  it('sends no selector when its controls were changed and then put back', () => {
    const allAndPriority = withSchedule({ selector: { all: true, priority_lte: 2 } });
    // The priority was picked in the other mode and abandoned: the radio is back on all keywords
    expect(updateBodyOf(valuesWith({ priority_lte: '4', name: 'Renamed' }, allAndPriority), allAndPriority)).toEqual({
      name: 'Renamed',
    });
    const stale = withSchedule({ workload: 'keyword_metrics', provider_mode: 'live', selector: { stale_days: 25 } });
    expect(updateBodyOf(valuesWith({ stale_days: ' 25 ' }, stale), stale)).toEqual({});
  });

  it('sends the selector alone when only a selector control changed', () => {
    const allAndPriority = withSchedule({ selector: { all: true, priority_lte: 2 } });
    expect(
      updateBodyOf(valuesWith({ selector_mode: 'priority', priority_lte: '3' }, allAndPriority), allAndPriority),
    ).toEqual({ selector: { priority_lte: 3 } });
    const groupsAndDays = withSchedule({
      workload: 'keyword_metrics',
      provider_mode: 'live',
      selector: { stale_days: 25, groups: [GROUP] },
    });
    expect(updateBodyOf(valuesWith({ groups: [GROUP, OTHER_GROUP] }, groupsAndDays), groupsAndDays)).toEqual({
      selector: { groups: [GROUP, OTHER_GROUP], stale_days: 25 },
    });
  });
});

describe('the words of a selector', () => {
  const known = {
    groups: new Map([
      [GROUP, 'Brand'],
      [OTHER_GROUP, 'Services / Audits'],
    ]),
    terms: new Map([[TERM, 'Topics: SEO']]),
  };

  it('names the days, the priority, all keywords, the groups and the terms', () => {
    expect(selectorParts({ all: true }, known)).toEqual([{ kind: 'all' }]);
    expect(selectorParts({ stale_days: 25 }, known)).toEqual([{ kind: 'stale', days: 25 }]);
    expect(selectorParts({ priority_lte: 2 }, known)).toEqual([{ kind: 'priority', max: 2 }]);
    expect(selectorParts({ groups: [GROUP, OTHER_GROUP], terms: [TERM] }, known)).toEqual([
      { kind: 'groups', names: ['Brand', 'Services / Audits'], removed: 0, pending: 0 },
      { kind: 'terms', names: ['Topics: SEO'], removed: 0, pending: 0 },
    ]);
  });

  it('counts the groups that no longer exist, and the ones whose names are still loading', () => {
    expect(selectorParts({ groups: [GROUP, 'gone'] }, known)).toEqual([
      { kind: 'groups', names: ['Brand'], removed: 1, pending: 0 },
    ]);
    expect(selectorParts({ groups: [GROUP], terms: [TERM] }, { groups: null, terms: null })).toEqual([
      { kind: 'groups', names: [], removed: 0, pending: 1 },
      { kind: 'terms', names: [], removed: 0, pending: 1 },
    ]);
  });

  it('tells a list that failed to load apart from one still loading', () => {
    expect(
      selectorParts({ groups: [GROUP, OTHER_GROUP], terms: [TERM] }, { groups: 'failed', terms: known.terms }),
    ).toEqual([
      { kind: 'groups', names: [], removed: 0, pending: 0, unread: 2 },
      { kind: 'terms', names: ['Topics: SEO'], removed: 0, pending: 0 },
    ]);
    expect(selectorParts({ terms: [TERM] }, { groups: null, terms: 'failed' })).toEqual([
      { kind: 'terms', names: [], removed: 0, pending: 0, unread: 1 },
    ]);
  });

  it('says nothing for a selector that names nothing', () => {
    expect(selectorParts({}, known)).toEqual([]);
    expect(selectorParts({ all: null, groups: [], terms: null }, known)).toEqual([]);
  });
});

describe('the field an API error belongs to', () => {
  const item = (path: string, code: string): Parameters<typeof errorTarget>[0] => ({
    location: 'body',
    path,
    code,
    message: code,
  });

  it('is the field of the form that shows what the path names', () => {
    expect(errorTarget(item('window_start_local', 'value_error'))).toEqual({
      field: 'window_start_local',
      key: 'window_start_local.value_error',
    });
    expect(errorTarget(item('weekday', 'required'))).toEqual({ field: 'weekday', key: 'weekday.required' });
    expect(errorTarget(item('selector', 'selector_empty'))).toEqual({
      field: 'selector_mode',
      key: 'selector_mode.selector_empty',
    });
    expect(errorTarget(item('selector.groups', 'group_unknown'))).toEqual({
      field: 'groups',
      key: 'groups.group_unknown',
    });
    expect(errorTarget(item('selector.terms', 'term_unknown'))).toEqual({
      field: 'terms',
      key: 'terms.term_unknown',
    });
    expect(errorTarget(item('selector.stale_days', 'selector_conflict'))).toEqual({
      field: 'selector_mode',
      key: 'selector_mode.selector_conflict',
    });
    expect(errorTarget(item('selector.stale_days', 'int_parsing'))).toEqual({
      field: 'stale_days',
      key: 'stale_days.int_parsing',
    });
  });

  it('is the provider mode field for a mode the workload does not take, with words of its own', () => {
    const target = errorTarget(item('provider_mode', 'provider_mode_not_supported'));
    expect(target).toEqual({ field: 'provider_mode', key: 'provider_mode.provider_mode_not_supported' });
    expect(errorMessageKey(target.key)).toBe('providerModeNotSupported');
    expect(Object.keys(SCHEDULE_ERROR_KEYS)).toContain(target.key);
  });

  it('is no field for the body as a whole or for something the form does not show', () => {
    expect(errorTarget(item('', 'value_error'))).toEqual({ field: null, key: '.value_error' });
    expect(errorTarget(item('cron_expr', 'not_applicable'))).toEqual({ field: null, key: 'cron_expr.not_applicable' });
  });
});
