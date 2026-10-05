import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SchedulesScreen } from './schedules-screen';
import type { Role, Schedule } from '@/lib/api/types';
import { LeaveGuardProvider } from '@/lib/navigation/use-leave-guard';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { MOCK_TERM_IDS } from '@/mocks/entity-fixtures';
import { MOCK_GROUP_IDS } from '@/mocks/keyword-fixtures';
import { MOCK_SCHEDULE_IDS } from '@/mocks/operations-fixtures';
import { invalid, mswPath, problem } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/settings/schedules',
}));

const [fynix] = MOCK_PROJECTS;
if (!fynix) throw new Error('no fixture project');
const P = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${fynix.project_id}`;
const SCHEDULES = `${P}/schedules`;
/** Noon on 1 October 2026, UTC: Berlin is on summer time until 25 October. */
const NOON = new Date('2026-10-01T12:00:00Z');

beforeEach(() => {
  vi.setSystemTime(NOON);
});
afterEach(() => {
  vi.useRealTimers();
  server.events.removeAllListeners();
});

function screenAs(role: Role, timeZone: string = fynix?.timezone ?? 'UTC'): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <LeaveGuardProvider>
        <Suspense fallback={null}>
          <SchedulesScreen
            workspaceId={MOCK_WORKSPACE.workspace_id}
            projectId={fynix?.project_id ?? ''}
            workspaceSlug="digibranders"
            projectSlug="fynix"
            timeZone={timeZone}
          />
        </Suspense>
      </LeaveGuardProvider>
    </PermissionProvider>
  );
}

/** The bodies the screen sends with `method` to the schedules routes, as they arrive. */
function recordBodies(method: 'POST' | 'PATCH'): unknown[] {
  const bodies: unknown[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === method && new URL(request.url).pathname.includes('/schedules')) {
      void request
        .clone()
        .json()
        .then((body: unknown) => bodies.push(body));
    }
  });
  return bodies;
}

const table = (): Promise<HTMLElement> => screen.findByRole('table', { name: 'Schedules of this project' });
const rowOf = async (name: string): Promise<HTMLElement> => {
  const found = await within(await table()).findByRole('rowheader', { name: new RegExp(`^${name}`) });
  const row = found.closest('tr');
  if (row === null) throw new Error(`No row for ${name}`);
  return row;
};

async function choose(
  user: ReturnType<typeof renderWithProviders>['user'],
  scope: HTMLElement,
  field: string | RegExp,
  option: string | RegExp,
): Promise<void> {
  await user.click(within(scope).getByRole('combobox', { name: field }));
  await user.click(await screen.findByRole('option', { name: option }));
}

async function openMenu(
  user: ReturnType<typeof renderWithProviders>['user'],
  schedule: string,
  item: string,
): Promise<void> {
  await user.click(await screen.findByRole('button', { name: `Actions for ${schedule}` }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

const SCHEDULE: Schedule = {
  schedule_id: MOCK_SCHEDULE_IDS.dailyRanks,
  project_id: fynix.project_id,
  name: 'Local rankings',
  workload: 'seo_rank',
  cadence: 'weekly',
  weekday: 3,
  month_day: null,
  cron_expr: null,
  window_start_local: '06:30:00',
  window_hours: 4,
  timezone: 'Asia/Tokyo',
  priority: 'high',
  provider_mode: 'priority_queue',
  selector: { priority_lte: 2 },
  is_active: true,
  next_run_at: '2026-10-07T21:30:00.000Z',
  last_run_id: null,
  created_at: '2026-09-29T10:00:00.000Z',
};

/** A list answer holding `schedules`, in place of the fixtures. */
const listing = (...schedules: Schedule[]): ReturnType<typeof http.get> =>
  http.get(mswPath(SCHEDULES), () =>
    HttpResponse.json({ data: schedules, page: { offset: 0, limit: 50, total: schedules.length } }),
  );

describe('Project settings > Schedules', () => {
  it('lists the schedules with what they collect and when, in words', async () => {
    const { container } = renderWithProviders(screenAs('editor'));
    const metrics = await rowOf('Keyword metrics');
    expect(within(metrics).getByText('Keywords not refreshed in 25 days')).toBeInTheDocument();
    expect(within(metrics).getByText('On the 20th of every month at 03:00, 2 hour window')).toBeInTheDocument();
    expect(within(metrics).getByText('Oct 20, 03:00')).toBeInTheDocument();
    expect(within(metrics).getByRole('link', { name: 'Last run' })).toHaveAttribute(
      'href',
      '/digibranders/ops/runs?project=fynix',
    );
    const daily = await rowOf('Daily rankings');
    expect(within(daily).getByText('All keywords')).toBeInTheDocument();
    expect(within(daily).getByText('Every day at 02:00, 6 hour window')).toBeInTheDocument();
    expect(within(daily).getByText('Oct 2, 02:00')).toBeInTheDocument();
    expect(within(daily).getByText('No run yet')).toBeInTheDocument();
    // Paused: no next run, since none is planned until it is resumed
    const weekly = await rowOf('Content keywords, weekly');
    expect(within(weekly).getByText('Groups: Services/Content')).toBeInTheDocument();
    expect(within(weekly).getByText('Every Monday at 02:00, 6 hour window')).toBeInTheDocument();
    expect(within(weekly).getByText('Paused')).toBeInTheDocument();
    expect(within(weekly).queryByText(/^Oct/)).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('names the time zone of a schedule that keeps one other than the project’s', async () => {
    renderWithProviders(screenAs('editor', 'America/New_York'));
    const daily = await rowOf('Daily rankings');
    expect(within(daily).getByText('Europe/Berlin')).toBeInTheDocument();
  });

  it('puts the selectors of every kind into words, and counts what it cannot name', async () => {
    const term = '00000000-0000-4000-8000-0000000000aa';
    server.use(
      listing(
        { ...SCHEDULE, schedule_id: MOCK_SCHEDULE_IDS.dailyRanks, name: 'By priority' },
        {
          ...SCHEDULE,
          schedule_id: MOCK_SCHEDULE_IDS.weeklyContent,
          name: 'Gone',
          selector: { groups: [MOCK_GROUP_IDS.brand, term], terms: [term] },
        },
        {
          ...SCHEDULE,
          schedule_id: MOCK_SCHEDULE_IDS.keywordMetrics,
          name: 'Top priority',
          selector: { priority_lte: 1 },
        },
        {
          ...SCHEDULE,
          schedule_id: '00000000-0000-4000-8000-0000000000bb',
          name: 'Both',
          selector: { groups: [MOCK_GROUP_IDS.brand, MOCK_GROUP_IDS.local], terms: [MOCK_TERM_IDS.localSeo] },
        },
      ),
    );
    renderWithProviders(screenAs('editor'));
    // A keyword has to match the groups and the terms alike, which the words keep apart
    await waitFor(() =>
      expect(
        within(screen.getByRole('table')).getByText('Groups: Brand and Local; Topics: SEO / Local SEO'),
      ).toBeInTheDocument(),
    );
    expect(within(await rowOf('By priority')).getByText('Priority 1 to 2')).toBeInTheDocument();
    expect(within(await rowOf('Top priority')).getByText('Priority 1')).toBeInTheDocument();
    const gone = await rowOf('Gone');
    await waitFor(() =>
      expect(within(gone).getByText('Groups: Brand and 1 removed group; 1 removed term')).toBeInTheDocument(),
    );
    expect(within(gone).getByText('Every Wednesday at 06:30, 4 hour window')).toBeInTheDocument();
    expect(within(gone).getByText('Asia/Tokyo')).toBeInTheDocument();
  });

  it('says what the page is for when there are none, with the action to make one', async () => {
    server.use(listing());
    const { user } = renderWithProviders(screenAs('editor'));
    expect(await screen.findByRole('heading', { name: 'No schedules yet' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New schedule' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'New schedule' }));
    expect(await screen.findByRole('dialog', { name: 'New schedule' })).toBeInTheDocument();
  });

  it('hands focus to the heading once the first schedule is made, since the button it came from is gone', async () => {
    const held: Schedule[] = [];
    server.use(
      http.get(mswPath(SCHEDULES), () =>
        HttpResponse.json({ data: held, page: { offset: 0, limit: 50, total: held.length } }),
      ),
      http.post(mswPath(SCHEDULES), () => {
        const made = { ...SCHEDULE, name: 'First schedule' };
        held.push(made);
        return HttpResponse.json({ data: made }, { status: 201 });
      }),
    );
    const { user } = renderWithProviders(screenAs('editor'));
    await user.click(await screen.findByRole('button', { name: 'New schedule' }));
    const dialog = await screen.findByRole('dialog', { name: 'New schedule' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'First schedule');
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await rowOf('First schedule');
    expect(screen.getByRole('heading', { name: 'Schedules' })).toHaveFocus();
  });

  it('returns focus to the button of the empty state when the dialog it opened is cancelled', async () => {
    server.use(listing());
    const { user } = renderWithProviders(screenAs('editor'));
    await user.click(await screen.findByRole('button', { name: 'New schedule' }));
    const dialog = await screen.findByRole('dialog', { name: 'New schedule' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'New schedule' })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Schedules' })).not.toHaveFocus();
  });

  it('is read-only without schedules:write: the list, one banner and no actions', async () => {
    for (const role of ['analyst', 'viewer'] as const) {
      const { unmount } = renderWithProviders(screenAs(role));
      await rowOf('Daily rankings');
      expect(screen.getByText('Owners, admins and editors can change schedules.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'New schedule' })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
      expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull();
      unmount();
    }
  });

  it('says so when the role cannot read the schedules at all, in one banner and not two', async () => {
    renderWithProviders(screenAs('billing'));
    expect(await screen.findByText('Your role cannot see the schedules of this project.')).toBeInTheDocument();
    expect(screen.queryByText('Owners, admins and editors can change schedules.')).toBeNull();
  });

  it('says when the names of a selector could not be loaded, apart from names still loading', async () => {
    server.use(
      listing({
        ...SCHEDULE,
        name: 'By groups',
        selector: { groups: [MOCK_GROUP_IDS.brand, MOCK_GROUP_IDS.local] },
      }),
      http.get(mswPath(`${P}/keyword-groups`), ({ request }) => problem(request, 'rate_limited')),
    );
    renderWithProviders(screenAs('editor'));
    expect(
      await within(await rowOf('By groups')).findByText('2 groups (names could not be loaded)'),
    ).toBeInTheDocument();
  });

  it('offers a retry when the list does not load', async () => {
    server.use(http.get(mswPath(SCHEDULES), () => problem(new Request('http://localhost'), 'rate_limited')));
    renderWithProviders(screenAs('editor'));
    expect(await screen.findByText('The schedules could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('Schedules: making one', () => {
  it('makes a daily keyword metrics schedule and leaves the provider mode out of the request', async () => {
    const bodies = recordBodies('POST');
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Daily rankings');
    await user.click(screen.getByRole('button', { name: 'New schedule' }));
    const dialog = await screen.findByRole('dialog', { name: 'New schedule' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), '  Nightly metrics ');
    const time = within(dialog).getByRole('textbox', { name: 'Start time' });
    await user.clear(time);
    await user.type(time, '03:30');
    // A keyword metrics schedule has no provider mode of its own to choose
    expect(within(dialog).queryByRole('combobox', { name: 'Provider mode' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(bodies).toEqual([
      {
        name: 'Nightly metrics',
        workload: 'keyword_metrics',
        cadence: 'daily',
        window_start_local: '03:30',
        window_hours: 6,
        timezone: 'Europe/Berlin',
        priority: 'standard',
        selector: { stale_days: 25 },
      },
    ]);
    const made = await rowOf('Nightly metrics');
    expect(within(made).getByText('Every day at 03:30, 6 hour window')).toBeInTheDocument();
    expect(within(made).getByText('Oct 2, 03:30')).toBeInTheDocument();
    expect(await screen.findByText('Nightly metrics created')).toBeInTheDocument();
    expect(screen.getByText('Next run Oct 2, 03:30')).toBeInTheDocument();
  });

  it('makes a weekly rank schedule for a group, with the day and the provider mode', async () => {
    const bodies = recordBodies('POST');
    const { user } = renderWithProviders(screenAs('admin'));
    await rowOf('Daily rankings');
    await user.click(screen.getByRole('button', { name: 'New schedule' }));
    const dialog = await screen.findByRole('dialog', { name: 'New schedule' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Local weekly');
    await choose(user, dialog, 'What to collect', 'SEO rank');
    await choose(user, dialog, 'Repeats', 'Every week');
    await choose(user, dialog, 'On', 'Wednesday');
    await choose(user, dialog, 'Provider mode', /^Priority queue/);
    // The rank selectors: all keywords, groups and terms, or a priority
    expect(
      within(dialog)
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('aria-checked')),
    ).toEqual(['true', 'false', 'false']);
    await user.click(within(dialog).getByRole('radio', { name: /^Groups and terms/ }));
    await user.click(await within(dialog).findByRole('combobox', { name: /^Groups/ }));
    await user.click(await screen.findByRole('option', { name: 'Local' }));
    await user.keyboard('{Escape}');
    expect(await axe(dialog)).toHaveNoViolations();
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(bodies).toEqual([
      {
        name: 'Local weekly',
        workload: 'seo_rank',
        cadence: 'weekly',
        weekday: 3,
        window_start_local: '02:00',
        window_hours: 6,
        timezone: 'Europe/Berlin',
        priority: 'standard',
        provider_mode: 'priority_queue',
        selector: { groups: [MOCK_GROUP_IDS.local] },
      },
    ]);
    const made = await rowOf('Local weekly');
    expect(within(made).getByText('Every Wednesday at 02:00, 6 hour window')).toBeInTheDocument();
    expect(within(made).getByText('Groups: Local')).toBeInTheDocument();
  });

  it('makes a monthly schedule on a day from 1 to 28 and offers no cron', async () => {
    const bodies = recordBodies('POST');
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Daily rankings');
    await user.click(screen.getByRole('button', { name: 'New schedule' }));
    const dialog = await screen.findByRole('dialog', { name: 'New schedule' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Monthly');
    await user.click(within(dialog).getByRole('combobox', { name: 'Repeats' }));
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'Every day',
      'Every week',
      'Every month',
    ]);
    await user.click(screen.getByRole('option', { name: 'Every month' }));
    await user.click(within(dialog).getByRole('combobox', { name: 'Day of the month' }));
    expect(await screen.findAllByRole('option')).toHaveLength(28);
    await user.click(screen.getByRole('option', { name: 'Day 28' }));
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(bodies).toMatchObject([{ cadence: 'monthly', month_day: 28 }]);
    expect(bodies[0]).not.toHaveProperty('weekday');
    expect(within(await rowOf('Monthly')).getByText(/^On the 28th of every month/)).toBeInTheDocument();
  });

  it('checks the name, the time and the days before it sends anything', async () => {
    const bodies = recordBodies('POST');
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Daily rankings');
    await user.click(screen.getByRole('button', { name: 'New schedule' }));
    const dialog = await screen.findByRole('dialog', { name: 'New schedule' });
    const time = within(dialog).getByRole('textbox', { name: 'Start time' });
    await user.clear(time);
    await user.type(time, '6:30');
    const days = within(dialog).getByRole('textbox', { name: 'Days since the last refresh' });
    await user.clear(days);
    await user.type(days, '366');
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
    expect(await within(dialog).findByText('Enter a name.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter the time as hours and minutes, such as 06:00.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a whole number of days from 0 to 365.')).toBeInTheDocument();
    // The selector that names groups or terms names at least one
    await user.click(within(dialog).getByRole('radio', { name: /^Groups and terms/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
    expect(await within(dialog).findByText('Choose at least one group or term.')).toBeInTheDocument();
    expect(bodies).toEqual([]);
  });

  it('takes a staleness of zero days, which the contract allows', async () => {
    const bodies = recordBodies('POST');
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Daily rankings');
    await user.click(screen.getByRole('button', { name: 'New schedule' }));
    const dialog = await screen.findByRole('dialog', { name: 'New schedule' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Everything');
    const days = within(dialog).getByRole('textbox', { name: 'Days since the last refresh' });
    await user.clear(days);
    await user.type(days, '0');
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(bodies).toMatchObject([{ selector: { stale_days: 0 } }]);
  });

  it('offers a keypad that has a colon for the start time, and says what it looks like', async () => {
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Daily rankings');
    await user.click(screen.getByRole('button', { name: 'New schedule' }));
    const dialog = await screen.findByRole('dialog', { name: 'New schedule' });
    const time = within(dialog).getByRole('textbox', { name: 'Start time' });
    // A digits-only keypad has no colon, so "06:30" could not be typed on a phone
    expect(time).toHaveAttribute('inputmode', 'text');
    expect(time).toHaveAttribute('placeholder', '06:00');
  });

  it('puts what the API refuses on its fields, and what belongs to none in an alert', async () => {
    server.use(
      http.post(mswPath(SCHEDULES), ({ request }) =>
        invalid(request, [
          { location: 'body', path: 'window_start_local', code: 'value_error', message: 'Value error' },
          { location: 'body', path: 'timezone', code: 'timezone_unknown', message: 'Unknown time zone.' },
          { location: 'body', path: 'selector.groups', code: 'group_unknown', message: 'Unknown group.' },
          { location: 'body', path: '', code: 'value_error', message: 'Value error, weekday' },
        ]),
      ),
    );
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Daily rankings');
    await user.click(screen.getByRole('button', { name: 'New schedule' }));
    const dialog = await screen.findByRole('dialog', { name: 'New schedule' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Refused');
    await user.click(within(dialog).getByRole('radio', { name: /^Groups and terms/ }));
    await user.click(await within(dialog).findByRole('combobox', { name: /^Groups/ }));
    await user.click(await screen.findByRole('option', { name: 'Local' }));
    await user.keyboard('{Escape}');
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
    expect(await within(dialog).findByText('Enter the time as hours and minutes, such as 06:00.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose a time zone from the list.')).toBeInTheDocument();
    expect(within(dialog).getByText('A chosen group no longer exists. Remove it and try again.')).toBeInTheDocument();
    expect(
      within(dialog).getByText('The weekday or the day of the month does not fit how often the schedule repeats.'),
    ).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
  });

  it('maps the staged errors of the selector, the days and the cadence', async () => {
    server.use(
      http.post(mswPath(SCHEDULES), ({ request }) =>
        invalid(request, [
          { location: 'body', path: 'selector', code: 'selector_empty', message: 'Name the keywords.' },
          { location: 'body', path: 'cadence', code: 'cadence_not_supported', message: 'Daily, weekly or monthly.' },
        ]),
      ),
    );
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Daily rankings');
    await user.click(screen.getByRole('button', { name: 'New schedule' }));
    const dialog = await screen.findByRole('dialog', { name: 'New schedule' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Refused');
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
    expect(await within(dialog).findByText('Choose which keywords to collect.')).toBeInTheDocument();
    expect(within(dialog).getByText('A schedule repeats every day, week or month.')).toBeInTheDocument();
  });

  it('waits for the groups and terms before a schedule that selects by them can be made', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(mswPath(`${P}/keyword-groups`), async () => {
        await gate;
        return undefined;
      }),
    );
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Daily rankings');
    await user.click(screen.getByRole('button', { name: 'New schedule' }));
    const dialog = await screen.findByRole('dialog', { name: 'New schedule' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Waiting');
    await user.click(within(dialog).getByRole('radio', { name: /^Groups and terms/ }));
    expect(within(dialog).getByText('Reading the groups and terms')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create schedule' })).toBeDisabled();
    release();
    expect(await within(dialog).findByRole('combobox', { name: /^Groups/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create schedule' })).toBeEnabled();
  });

  it('says at the top of the dialog when the groups and terms did not load, and reads them again on request', async () => {
    let failing = true;
    server.use(
      http.get(mswPath(`${P}/keyword-groups`), ({ request }) =>
        failing ? problem(request, 'rate_limited') : undefined,
      ),
    );
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Daily rankings');
    await user.click(screen.getByRole('button', { name: 'New schedule' }));
    const dialog = await screen.findByRole('dialog', { name: 'New schedule' });
    await user.click(within(dialog).getByRole('radio', { name: /^Groups and terms/ }));
    const alert = await within(dialog).findByText(
      'The groups and terms could not be loaded, so they cannot be chosen yet.',
    );
    // House rule: what belongs to no field is an alert at the top of the body, above the first field
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    expect(alert.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(within(dialog).getByRole('button', { name: 'Create schedule' })).toBeDisabled();
    failing = false;
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(await within(dialog).findByRole('combobox', { name: /^Groups/ })).toBeInTheDocument();
    expect(
      within(dialog).queryByText('The groups and terms could not be loaded, so they cannot be chosen yet.'),
    ).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Create schedule' })).toBeEnabled();
  });

  it('asks before a dialog with changes is closed', async () => {
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Daily rankings');
    await user.click(screen.getByRole('button', { name: 'New schedule' }));
    const dialog = await screen.findByRole('dialog', { name: 'New schedule' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Half done');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    const question = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    expect(within(question).getByText('The changes to this schedule will be lost.')).toBeInTheDocument();
    await user.click(within(question).getByRole('button', { name: 'Keep editing' }));
    expect(dialog).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'New schedule' })).toHaveFocus();
  });
});

describe('Schedules: changing one', () => {
  it('sends only what changed, and shows the new rule', async () => {
    const bodies = recordBodies('PATCH');
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Daily rankings');
    await openMenu(user, 'Daily rankings', 'Edit');
    const dialog = await screen.findByRole('dialog', { name: 'Edit Daily rankings' });
    // The workload is fixed once a schedule is made
    expect(within(dialog).getByText('A schedule keeps the workload it was made for.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox', { name: 'What to collect' })).toBeNull();
    expect(within(dialog).getByRole('textbox', { name: 'Start time' })).toHaveValue('02:00');
    await choose(user, dialog, 'Window', '4 hours');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(bodies).toEqual([{ window_hours: 4 }]);
    expect(within(await rowOf('Daily rankings')).getByText('Every day at 02:00, 4 hour window')).toBeInTheDocument();
    expect(await screen.findByText('Daily rankings saved')).toBeInTheDocument();
  });

  it('names the day when the cadence changes to one that needs it', async () => {
    const bodies = recordBodies('PATCH');
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Daily rankings');
    await openMenu(user, 'Daily rankings', 'Edit');
    const dialog = await screen.findByRole('dialog', { name: 'Edit Daily rankings' });
    await choose(user, dialog, 'Repeats', 'Every week');
    await choose(user, dialog, 'On', 'Friday');
    await choose(user, dialog, 'Priority', 'High');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(bodies).toEqual([{ cadence: 'weekly', weekday: 5, priority: 'high' }]);
    expect(within(await rowOf('Daily rankings')).getByText(/^Every Friday at 02:00/)).toBeInTheDocument();
  });

  it('changes a rank schedule to the keywords up to a priority', async () => {
    const bodies = recordBodies('PATCH');
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Daily rankings');
    await openMenu(user, 'Daily rankings', 'Edit');
    const dialog = await screen.findByRole('dialog', { name: 'Edit Daily rankings' });
    await user.click(within(dialog).getByRole('radio', { name: /^Keywords by priority/ }));
    await choose(user, dialog, 'Lowest priority collected', '3');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(bodies).toEqual([{ selector: { priority_lte: 3 } }]);
    expect(within(await rowOf('Daily rankings')).getByText('Priority 1 to 3')).toBeInTheDocument();
  });

  it('closes without a request when nothing changed', async () => {
    const bodies = recordBodies('PATCH');
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Daily rankings');
    await openMenu(user, 'Daily rankings', 'Edit');
    const dialog = await screen.findByRole('dialog', { name: 'Edit Daily rankings' });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(bodies).toEqual([]);
  });

  it('puts the errors of a change on its fields', async () => {
    server.use(
      http.patch(mswPath(`${SCHEDULES}/:schedule_id`), ({ request }) =>
        invalid(request, [
          { location: 'body', path: 'weekday', code: 'required', message: 'A weekly schedule names its day.' },
        ]),
      ),
    );
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Content keywords, weekly');
    await openMenu(user, 'Content keywords, weekly', 'Edit');
    const dialog = await screen.findByRole('dialog', { name: 'Edit Content keywords, weekly' });
    // The groups of this schedule show by name
    expect(await within(dialog).findByText('Services/Content')).toBeInTheDocument();
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await user.type(name, ' 2');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Choose the weekday.')).toBeInTheDocument();
  });

  it('says so when the schedule was deleted while it was open, reads the list again and hands focus to the heading', async () => {
    // The list no longer has the row once it is read again, so the menu the dialog came from is gone
    const held: Schedule[] = [SCHEDULE];
    server.use(
      http.get(mswPath(SCHEDULES), () =>
        HttpResponse.json({ data: held, page: { offset: 0, limit: 50, total: held.length } }),
      ),
      http.patch(mswPath(`${SCHEDULES}/:schedule_id`), ({ request }) => {
        held.length = 0;
        return problem(request, 'not_found');
      }),
    );
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Local rankings');
    await openMenu(user, 'Local rankings', 'Edit');
    const dialog = await screen.findByRole('dialog', { name: 'Edit Local rankings' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), ' 2');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Local rankings was deleted by someone else. The list is up to date.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole('rowheader', { name: /^Local rankings/ })).toBeNull());
    expect(screen.getByRole('heading', { name: 'Schedules' })).toHaveFocus();
  });

  it('keeps the dialog open with a sentence when a change is not saved', async () => {
    server.use(http.patch(mswPath(`${SCHEDULES}/:schedule_id`), ({ request }) => problem(request, 'rate_limited')));
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Daily rankings');
    await openMenu(user, 'Daily rankings', 'Edit');
    const dialog = await screen.findByRole('dialog', { name: 'Edit Daily rankings' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), ' 2');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('The schedule was not saved. Try again in a moment.')).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
  });

  it('switches the days of a keyword metrics schedule to groups without carrying the days along', async () => {
    const bodies = recordBodies('PATCH');
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Keyword metrics');
    await openMenu(user, 'Keyword metrics', 'Edit');
    const dialog = await screen.findByRole('dialog', { name: 'Edit Keyword metrics' });
    await user.click(within(dialog).getByRole('radio', { name: /^Groups and terms/ }));
    await user.click(await within(dialog).findByRole('combobox', { name: /^Groups/ }));
    await user.click(await screen.findByRole('option', { name: 'Local' }));
    await user.keyboard('{Escape}');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(bodies).toEqual([{ selector: { groups: [MOCK_GROUP_IDS.local] } }]);
    expect(within(await rowOf('Keyword metrics')).getByText('Groups: Local')).toBeInTheDocument();
  });

  it('sends the name alone for a rename, whatever the selector holds that the form does not show', async () => {
    const ranks: Schedule = { ...SCHEDULE, name: 'Top ranks', selector: { all: true, priority_lte: 2 } };
    const metrics: Schedule = {
      ...SCHEDULE,
      schedule_id: MOCK_SCHEDULE_IDS.keywordMetrics,
      name: 'Bare metrics',
      workload: 'keyword_metrics',
      cadence: 'daily',
      weekday: null,
      provider_mode: 'live',
      selector: {},
    };
    server.use(
      listing(ranks, metrics),
      http.patch(mswPath(`${SCHEDULES}/:schedule_id`), async ({ request, params }) => {
        const body: unknown = await request.clone().json();
        const found = params.schedule_id === ranks.schedule_id ? ranks : metrics;
        const name = typeof body === 'object' && body !== null && 'name' in body ? body.name : undefined;
        return HttpResponse.json({ data: { ...found, name: typeof name === 'string' ? name : found.name } });
      }),
    );
    const bodies = recordBodies('PATCH');
    const { user } = renderWithProviders(screenAs('editor'));
    for (const name of ['Top ranks', 'Bare metrics']) {
      await rowOf(name);
      await openMenu(user, name, 'Edit');
      const dialog = await screen.findByRole('dialog', { name: `Edit ${name}` });
      await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), ' 2');
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(dialog).not.toBeInTheDocument());
    }
    expect(bodies).toEqual([{ name: 'Top ranks 2' }, { name: 'Bare metrics 2' }]);
  });

  it('names the time zone of the next run in a toast when it is not the project’s', async () => {
    const { user } = renderWithProviders(screenAs('editor', 'America/New_York'));
    await rowOf('Daily rankings');
    await openMenu(user, 'Daily rankings', 'Edit');
    const dialog = await screen.findByRole('dialog', { name: 'Edit Daily rankings' });
    await choose(user, dialog, 'Window', '4 hours');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Next run Oct 2, 02:00 (Europe/Berlin)')).toBeInTheDocument();
  });

  it('names the time zone of the next run when a schedule in another one is resumed', async () => {
    const { user } = renderWithProviders(screenAs('editor', 'America/New_York'));
    await rowOf('Content keywords, weekly');
    await openMenu(user, 'Content keywords, weekly', 'Resume');
    expect(await screen.findByText('Content keywords, weekly resumed')).toBeInTheDocument();
    expect(screen.getByText(/^Next run .*\(Europe\/Berlin\)$/)).toBeInTheDocument();
  });

  it('does not offer to edit a schedule of another workload or a cron schedule', async () => {
    server.use(
      listing(
        { ...SCHEDULE, name: 'Search Console', workload: 'gsc_sync' },
        {
          ...SCHEDULE,
          schedule_id: MOCK_SCHEDULE_IDS.weeklyContent,
          name: 'Custom',
          cadence: 'cron',
          cron_expr: '0 2 * * *',
        },
      ),
    );
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Search Console');
    expect(within(await rowOf('Custom')).getByText('On a custom schedule')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Actions for Search Console' }));
    expect(await screen.findByRole('menuitem', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
  });
});

describe('Schedules: pausing, resuming and deleting', () => {
  it('pauses a schedule and resumes it with the next run in the toast', async () => {
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Daily rankings');
    await openMenu(user, 'Daily rankings', 'Pause');
    expect(await screen.findByText('Daily rankings paused')).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByText('Paused')).toHaveLength(2));
    expect(within(await rowOf('Daily rankings')).queryByText('Oct 2, 02:00')).toBeNull();
    await openMenu(user, 'Daily rankings', 'Resume');
    expect(await screen.findByText('Daily rankings resumed')).toBeInTheDocument();
    expect(screen.getByText('Next run Oct 2, 02:00')).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByText('Paused')).toHaveLength(1));
    expect(within(await rowOf('Daily rankings')).getByText('Oct 2, 02:00')).toBeInTheDocument();
  });

  it('sends no body to pause, and offers Resume for a paused schedule only', async () => {
    const asked: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST') {
        void request
          .clone()
          .text()
          .then((text) => asked.push(text));
      }
    });
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Daily rankings');
    await user.click(await screen.findByRole('button', { name: 'Actions for Content keywords, weekly' }));
    expect(await screen.findByRole('menuitem', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Pause' })).toBeNull();
    await user.keyboard('{Escape}');
    await openMenu(user, 'Daily rankings', 'Pause');
    expect(await screen.findByText('Daily rankings paused')).toBeInTheDocument();
    expect(asked).toEqual(['']);
  });

  it('says so when a schedule is not paused', async () => {
    server.use(
      http.post(mswPath(`${SCHEDULES}/:schedule_id/pause`), ({ request }) => problem(request, 'rate_limited')),
    );
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Daily rankings');
    await openMenu(user, 'Daily rankings', 'Pause');
    // An error is shown as a toast and announced as well
    expect(
      (await screen.findAllByText('Daily rankings was not paused. Try again in a moment.')).length,
    ).toBeGreaterThan(0);
    expect(within(await rowOf('Daily rankings')).queryByText('Paused')).toBeNull();
  });

  it('deletes a schedule after saying that its runs stay', async () => {
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Daily rankings');
    await openMenu(user, 'Daily rankings', 'Delete');
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Daily rankings?' });
    expect(
      within(confirm).getByText('Daily rankings stops collecting and leaves the list. Its past runs stay in Runs.'),
    ).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Delete schedule' }));
    await waitFor(() => expect(screen.queryByRole('rowheader', { name: /^Daily rankings/ })).toBeNull());
    expect(await screen.findByText('Daily rankings deleted')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Schedules' })).toHaveFocus();
  });

  it('keeps the schedule when keywords still follow it, and says what to do, with no count the API does not give', async () => {
    // As the backend answers: the code and a sentence, no number of keywords
    server.use(http.delete(mswPath(`${SCHEDULES}/:schedule_id`), ({ request }) => problem(request, 'schedule_in_use')));
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Daily rankings');
    await openMenu(user, 'Daily rankings', 'Delete');
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete Daily rankings?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete schedule' }));
    expect(
      await within(confirm).findByText('Keywords still follow this schedule. Give them another schedule first.'),
    ).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(await rowOf('Daily rankings')).toBeInTheDocument();
  });

  it('reads the list again when the schedule is already gone', async () => {
    server.use(http.delete(mswPath(`${SCHEDULES}/:schedule_id`), ({ request }) => problem(request, 'not_found')));
    const { user } = renderWithProviders(screenAs('editor'));
    await rowOf('Daily rankings');
    await openMenu(user, 'Daily rankings', 'Delete');
    await user.click(await screen.findByRole('button', { name: 'Delete schedule' }));
    expect(
      await screen.findByText('Daily rankings was deleted by someone else. The list is up to date.'),
    ).toBeInTheDocument();
  });
});
