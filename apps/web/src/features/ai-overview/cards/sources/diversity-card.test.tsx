import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { diversityEngine, diversityRead, diversityWeek } from './model/change-fixtures';
import DiversityCard from './diversity-card';
import { OverviewProvider } from '../../overview-context';
import type { CardProps } from '@/features/layouts';
import type { SourceDiversity } from '@/lib/citations/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { setAiSeeded } from '@/mocks/ai-seed';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { cardInOverview, overviewProject } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';
import { drawnSeries, readExport, renderCard, tooltipText, yAxisOf, type DrawnSeries } from '@/test/weekly-card-kit';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
vi.mock('@/components/app/chart/echart', async () => (await import('@/test/weekly-card-kit')).echartStandIn);

const TYPE = 'sources.diversity';
const TITLE = 'Source diversity over time';
const DIVERSITY = '*/api/v1/workspaces/:w/projects/:p/ai/sources/diversity';
const WEEKS = ['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'] as const;

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** ChatGPT cites every week; Gemini has a week with no citation unit (Oct 26). */
function read(average: number | null = 15.3): SourceDiversity {
  return diversityRead(
    [
      diversityEngine('chatgpt_web', {
        answers: 400,
        units: 1900,
        domains: 90,
        effective: 18.6,
        weeks: [
          diversityWeek(WEEKS[0], 200, 41, 18.6),
          diversityWeek(WEEKS[1], 150, 38, 17),
          diversityWeek(WEEKS[2], 180, 40, 16.2),
          diversityWeek(WEEKS[3], 160, 36, 15),
        ],
      }),
      diversityEngine('gemini_web', {
        answers: 300,
        units: 900,
        domains: 60,
        effective: 12,
        weeks: [
          diversityWeek(WEEKS[0], 100, 30, 12.5),
          diversityWeek(WEEKS[1], 0, 0, null),
          diversityWeek(WEEKS[2], 90, 25, 10),
          diversityWeek(WEEKS[3], 80, 22, 9),
        ],
      }),
    ],
    { distinct: 412, average },
  );
}

function serve(body: SourceDiversity = read()): void {
  server.use(http.get(DIVERSITY, () => HttpResponse.json(body)));
}

const failing = (requestId: string): Response =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: requestId },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

async function drawLines(searchParams = 'cmp=off'): Promise<ReturnType<typeof renderCard>> {
  const rendered = renderCard(TYPE, DiversityCard, {}, { searchParams });
  await screen.findByTestId('echart-canvas');
  return rendered;
}

const lineOf = (id: string): DrawnSeries => {
  const found = drawnSeries().find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`No series ${id}`);
  return found;
};

const axisText = (value: number): string => {
  const label = (yAxisOf().axisLabel ?? {}) as { formatter: (input: number) => string };
  return label.formatter(value);
};

/** What the chart says about itself to people who cannot see it: the paragraph its image points at. */
const spokenSummary = (): string => {
  const described = screen.getByTestId('echart-canvas').parentElement?.getAttribute('aria-describedby') ?? '';
  return document.getElementById(described)?.textContent ?? '';
};

// Built from code points, so this file does not contain the characters it looks for
const DASHES = new RegExp(`[${String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015)}]`);
// ASCII text, where the number formatters may write a no-break space
const PRINTABLE = new RegExp(`^[\\x20-\\x7e${String.fromCharCode(0xa0)}]*$`);

describe('the source diversity card (CH-26)', () => {
  it('shows a skeleton at its height, then one line per asked engine in the colour of the engine', async () => {
    server.use(
      http.get(DIVERSITY, async () => {
        await delay(60);
        return HttpResponse.json(read());
      }),
    );
    renderCard(TYPE, DiversityCard, {});
    const heading = await screen.findByRole('heading', { name: TITLE });
    expect(heading.closest('section')).toHaveAttribute('aria-busy', 'true');
    await screen.findByTestId('echart-canvas');
    expect(drawnSeries().map((entry) => entry.id)).toEqual(['chatgpt_web', 'gemini_web']);
    expect(lineOf('chatgpt_web')).toMatchObject({ name: 'ChatGPT', type: 'line', color: '#c1' });
    expect(lineOf('gemini_web')).toMatchObject({ name: 'Gemini', color: '#c2' });
    expect(screen.getByRole('img', { name: TITLE })).toHaveStyle({ height: '240px' });
  });

  it('plots the distinct domains of each week first, and the effective sources when the measure is switched', async () => {
    serve();
    const { user } = await drawLines();
    expect(lineOf('chatgpt_web').data).toEqual([41, 38, 40, 36]);
    await user.click(screen.getByRole('radio', { name: 'Effective sources' }));
    expect(lineOf('chatgpt_web').data).toEqual([18.6, 17, 16.2, 15]);
    expect(lineOf('gemini_web').data).toEqual([12.5, null, 10, 9]);
  });

  it('keeps a week with no citation unit as a gap in both measures, never as 0', async () => {
    serve();
    const { user } = await drawLines();
    expect(lineOf('gemini_web').data).toEqual([30, null, 25, 22]);
    await user.click(screen.getByRole('radio', { name: 'Effective sources' }));
    expect(lineOf('gemini_web').data[1]).toBeNull();
    expect(lineOf('gemini_web').connectNulls).toBe(false);
    expect(tooltipText(1)).toContain('Gemini|No citation unit this week');
  });

  it('never adds the engines together: one series each and no line for all of them', async () => {
    serve();
    await drawLines();
    expect(drawnSeries()).toHaveLength(2);
    expect(drawnSeries().some((entry) => /all|total|every/i.test(entry.name ?? ''))).toBe(false);
  });

  it('writes the value as domains, or as effective sources, with the units behind it in the tooltip', async () => {
    serve();
    const { user } = await drawLines();
    expect(tooltipText(0)).toContain('Week of Oct 19');
    expect(tooltipText(0)).toContain('ChatGPT|41 domains, 200 citation units');
    await user.click(screen.getByRole('radio', { name: 'Effective sources' }));
    expect(tooltipText(0)).toContain('ChatGPT|18.6 effective sources, 200 citation units in 41 domains');
  });

  it('starts the axis at 0 and writes its ticks as plain numbers', async () => {
    serve();
    const { user } = await drawLines();
    expect(yAxisOf()).toMatchObject({ min: 0 });
    expect(axisText(40)).toBe('40');
    await user.click(screen.getByRole('radio', { name: 'Effective sources' }));
    expect(axisText(10)).toBe('10.0');
  });

  it('shows the units and the domains of every week in the Table view, in both measures', async () => {
    serve();
    const { user } = await drawLines();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: TITLE });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(5);
    expect(rows[1]).toHaveTextContent('Oct 19');
    expect(rows[1]).toHaveTextContent('41 domains, 200 citation units');
    await user.click(screen.getByRole('button', { name: 'Table' }));
    await user.click(screen.getByRole('radio', { name: 'Effective sources' }));
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const effective = await screen.findByRole('table', { name: TITLE });
    expect(within(effective).getAllByRole('row')[1]).toHaveTextContent(
      '18.6 effective sources, 200 citation units in 41 domains',
    );
  });

  it('gives the formula of the measure in its info popover, and changes it with the measure', async () => {
    serve();
    const { user } = await drawLines();
    await user.click(screen.getByRole('button', { name: 'About Distinct domains' }));
    expect(await screen.findByText(/registrable domains with at least one citation unit/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('radio', { name: 'Effective sources' }));
    await user.click(screen.getByRole('button', { name: 'About Effective sources' }));
    expect(await screen.findByText(/square of the total citation units, divided by the sum/)).toBeInTheDocument();
    expect(screen.getByText(/inverse of the Herfindahl index/)).toBeInTheDocument();
  });

  it('labels the engine average as the equal-weight mean of the engines with units, from the API only', async () => {
    serve();
    const { unmount } = await drawLines();
    expect(
      screen.getByText('Equal-weight mean of the engines with units: 15.3 effective sources.'),
    ).toBeInTheDocument();
    unmount();
    // Both engines have effective sources, and the API sends no average: the card does not make one up
    serve(read(null));
    await drawLines();
    expect(screen.queryByText(/Equal-weight mean/)).not.toBeInTheDocument();
  });

  it('says in the footnote that engines are not added and a week without a unit is a gap', async () => {
    serve();
    await drawLines();
    expect(screen.getByText(/engines are never added together/)).toBeInTheDocument();
    expect(screen.getByText(/gap in the line, not 0/)).toBeInTheDocument();
    expect(
      screen.getByText('Citations flagged as unresolved redirects or engine-internal links are left out.'),
    ).toBeInTheDocument();
  });

  it('names the window, the domains over every engine, and the engines in the meta line', async () => {
    serve();
    await drawLines();
    expect(
      screen.getByText(
        'Oct 16 to Nov 12, 2026, 412 distinct domains over ChatGPT and Gemini, branded prompts left out',
      ),
    ).toBeInTheDocument();
  });

  it('describes the first and the last point of each engine in the summary', async () => {
    serve();
    const { user } = await drawLines();
    expect(spokenSummary()).toContain('ChatGPT: 41 domains in the week of Oct 19, 36 domains in the week of Nov 9.');
    expect(spokenSummary()).toContain('Gemini: 30 domains in the week of Oct 19, 22 domains in the week of Nov 9.');
    await user.click(screen.getByRole('radio', { name: 'Effective sources' }));
    expect(spokenSummary()).toContain(
      'ChatGPT: 18.6 effective sources in the week of Oct 19, 15.0 effective sources in the week of Nov 9.',
    );
  });

  it('describes an engine with one week, and an engine with no week with units', async () => {
    serve(
      diversityRead([
        diversityEngine('chatgpt_web', {
          weeks: [diversityWeek(WEEKS[0], 0, 0, null), diversityWeek(WEEKS[1], 50, 12, 6)],
        }),
        diversityEngine('gemini_web', {
          weeks: [diversityWeek(WEEKS[0], 0, 0, null), diversityWeek(WEEKS[1], 0, 0, null)],
        }),
      ]),
    );
    await drawLines();
    expect(spokenSummary()).toContain('ChatGPT: 12 domains in the week of Oct 26.');
    expect(spokenSummary()).toContain('Gemini: no week with a citation unit.');
  });

  it('operates the measure with the arrow keys and says the measure it now shows', async () => {
    serve();
    const { user } = await drawLines();
    const distinct = screen.getByRole('radio', { name: 'Distinct domains' });
    expect(distinct).toBeChecked();
    distinct.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Effective sources' })).toBeChecked();
    await waitFor(() => {
      expect(document.getElementById('live-region-polite')).toHaveTextContent('Showing effective sources');
    });
    expect(lineOf('chatgpt_web').data).toEqual([18.6, 17, 16.2, 15]);
  });

  it('exports every week of every engine under the layout item id, with units, domains and effective sources', async () => {
    serve();
    const { user } = await drawLines();
    const [block] = await readExport(user);
    expect(block?.id).toBe('card-under-test');
    expect(block?.header).toEqual([
      'Week starting',
      'Engine',
      'Citation units',
      'Distinct domains',
      'Effective sources',
    ]);
    expect(block?.rows).toHaveLength(8);
    expect(block?.rows[0]).toEqual(['2026-10-19', 'ChatGPT', 200, 41, 18.6]);
    // The week with no unit exports the counts the API sent, and the effective sources it did not compute as empty, not 0
    expect(block?.rows[5]).toEqual(['2026-10-26', 'Gemini', 0, 0, null]);
  });

  it('says no engine is on, and asks nothing, when the project has none', async () => {
    const asked = vi.fn();
    server.use(
      http.get(DIVERSITY, () => {
        asked();
        return HttpResponse.json(read());
      }),
    );
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
    renderWithProviders(
      <PermissionProvider membership={membershipFactory('admin')}>
        <OverviewProvider
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={overviewProject('cleanstart')}
        >
          <DiversityCard item={{ id: 'bare', type: TYPE }} options={{}} width="half" mode="view" live />
        </OverviewProvider>
      </PermissionProvider>,
      { searchParams: 'cmp=off' },
    );
    expect(await screen.findByText('No engine is on for this project')).toBeInTheDocument();
    expect(screen.queryByTestId('echart-canvas')).not.toBeInTheDocument();
    expect(asked).not.toHaveBeenCalled();
  });

  it('says branded prompts alone cannot be read for sources, and asks nothing', async () => {
    const asked = vi.fn();
    server.use(
      http.get(DIVERSITY, () => {
        asked();
        return HttpResponse.json(read());
      }),
    );
    renderCard(TYPE, DiversityCard, {}, { searchParams: 'cmp=off&branded=only' });
    expect(await screen.findByText('Sources cannot be read for branded prompts alone')).toBeInTheDocument();
    expect(asked).not.toHaveBeenCalled();
  });

  it('says no source was cited in any week, without a line of zeros, when no week holds a unit', async () => {
    serve(
      diversityRead([
        diversityEngine('chatgpt_web', { weeks: WEEKS.map((week) => diversityWeek(week, 0, 0, null)) }),
        diversityEngine('gemini_web', { weeks: WEEKS.map((week) => diversityWeek(week, 0, 0, null)) }),
      ]),
    );
    renderCard(TYPE, DiversityCard, {});
    expect(await screen.findByText('No source was cited in any week of this window')).toBeInTheDocument();
    expect(screen.queryByTestId('echart-canvas')).not.toBeInTheDocument();
  });

  it('says there is no valid answer when no engine has one in the window', async () => {
    serve(
      diversityRead([
        diversityEngine('chatgpt_web', { answers: 0, citing: 0, units: 0, domains: 0, effective: null, weeks: [] }),
      ]),
    );
    renderCard(TYPE, DiversityCard, {});
    expect(await screen.findByText('No valid answers in these 28 days')).toBeInTheDocument();
  });

  it('shows Retry and an error id for a failed read, and Retry reads again', async () => {
    server.use(http.get(DIVERSITY, () => failing('req-div')));
    const rendered = renderCard(TYPE, DiversityCard, {});
    expect(await screen.findByText('Could not load source diversity over time')).toBeInTheDocument();
    expect(screen.getByText('Error ID req-div')).toBeInTheDocument();
    serve();
    await rendered.user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('echart-canvas')).toBeInTheDocument();
  });

  it('keeps the lines and says these are the last figures read when a refetch fails', async () => {
    serve();
    const { queryClient } = await drawLines();
    server.use(http.get(DIVERSITY, () => failing('req-stale')));
    void queryClient.refetchQueries({ queryKey: [] });
    expect(await screen.findByText('These are the last figures read')).toBeInTheDocument();
    expect(screen.getByTestId('echart-canvas')).toBeInTheDocument();
  });

  it('keeps the lines at full strength with the refetch bar while a new scope is read', async () => {
    serve();
    const { queryClient, container } = await drawLines();
    server.use(
      http.get(DIVERSITY, async () => {
        await delay(200);
        return HttpResponse.json(read());
      }),
    );
    void queryClient.refetchQueries({ queryKey: [] });
    await waitFor(() => {
      expect(container.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
    });
    expect(screen.getByTestId('echart-canvas')).toBeInTheDocument();
    expect(container.querySelector('section')?.className ?? '').not.toMatch(/opacity/);
  });

  it('is arranged and not used in customize mode: every button of the card is inside an inert body', async () => {
    serve();
    const Card = (props: CardProps): ReactElement => (
      <div inert data-testid="card-body">
        <DiversityCard {...props} />
      </div>
    );
    renderWithProviders(cardInOverview({ type: TYPE, Card }), { searchParams: 'cmp=off' });
    const body = await screen.findByTestId('card-body');
    await within(body).findByTestId('echart-canvas');
    const targets = [...body.querySelectorAll('button, a[href], [role="radio"]')];
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(target.closest('[inert]')).toBe(body);
  });

  it('passes axe, and writes no dash and nothing beyond ASCII in what it draws', async () => {
    serve();
    const { container, user } = await drawLines();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    await screen.findByRole('table', { name: TITLE });
    const text = container.textContent;
    expect(DASHES.test(text)).toBe(false);
    expect(text).not.toMatch(/ - /);
    expect(text).toMatch(PRINTABLE);
  });

  it('draws the card on the seeded Eventus world', async () => {
    setAiSeeded(true);
    renderCard(TYPE, DiversityCard, {}, { world: 'eventus-security', searchParams: 'cmp=off' });
    await screen.findByTestId('echart-canvas');
    expect(drawnSeries().length).toBeGreaterThan(0);
  });
});
