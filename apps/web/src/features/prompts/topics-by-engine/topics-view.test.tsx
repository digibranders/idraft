import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIST_MEDIA } from '@/components/app/data-table/data-table-list';
import { getTopicOrder } from '@/features/prompts/topic-drawer/topic-order-store';
import { PromptsScreen } from '@/features/prompts/prompts-screen';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { MOCK_TERM_IDS } from '@/mocks/entity-fixtures';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { NO_COUNTS, topicCells, type Counts } from '@/mocks/prompt-summary';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender, type ProvidedRenderOptions } from '@/test/render';

/** The address the page is on, which the heat map builds its links from (the mock of the router has no history). */
const address = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
  useSearchParams: () => new URLSearchParams(address.search),
}));

/** Thursday 12 November 2026, noon UTC: the 02:00 run has answered. */
const NOW = new Date('2026-11-12T12:00:00Z');
const SUMMARY_PATH = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/prompts-summary');

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const FYNIX_ID = fynix.project_id;

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
});
afterEach(() => {
  vi.useRealTimers();
  restoreWideScreen();
});

function promptsAs(role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <PromptsScreen
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={{
            id: FYNIX_ID,
            slug: 'fynix',
            name: 'Fynix',
            timeZone: 'Europe/Berlin',
            defaultLanguage: 'en',
            defaultCountryIso: 'DE',
          }}
        />
      </Suspense>
    </PermissionProvider>
  );
}

const renderOn = (searchParams: string, options: ProvidedRenderOptions = {}): ProvidedRender => {
  address.search = searchParams;
  return renderWithProviders(promptsAs('viewer'), { ...options, searchParams });
};
/** A phone: only the list layout of the data tables matches (the stub of the wide screen matches every query). */
const stubPhone = (): void => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === LIST_MEDIA,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
};
const treegrid = (): Promise<HTMLElement> => screen.findByRole('treegrid', { name: 'Groups' });
const headers = (table: HTMLElement): string[] =>
  within(table)
    .getAllByRole('columnheader')
    .map((header) => header.textContent ?? '');
const query = (write: string | undefined): URLSearchParams => new URLSearchParams(write);

/** The requests of the summary that ask for topic rows only, which is how the entities read is told from the page's own. */
function watchEntityReads(): { count: () => number } {
  let reads = 0;
  server.use(
    http.get(SUMMARY_PATH, ({ request }) => {
      if (new URL(request.url).searchParams.get('rows') === 'topics') reads += 1;
      return undefined;
    }),
  );
  return { count: () => reads };
}

describe('the Groups tab: the views', () => {
  it('opens on the List: the columns of the Groups tab, no Platform gap, the counts in the chooser', async () => {
    const reads = watchEntityReads();
    renderOn('');
    const table = await treegrid();
    await within(table).findByRole('button', { name: 'Open the group Paid Search' });
    const shown = headers(table);
    for (const header of ['Search volume', 'Mention rate', 'Citation rate', 'Recommendation rate', 'Share of voice']) {
      expect(shown).toContain(header);
    }
    expect(shown).toContain('Brands');
    // PR-TOPICS-20: no Prompts column, no Trend, no Intent, Cited links or Screenshot; Top platform and the counts wait
    for (const header of [
      'Prompts',
      'Trend',
      'Intent',
      'Cited links',
      'Screenshot',
      'Top platform',
      'ChatGPT mentioned',
    ]) {
      expect(shown).not.toContain(header);
    }
    expect(shown.some((header) => header.startsWith('Platform gap'))).toBe(false);
    expect(screen.getByRole('radio', { name: 'List' })).toBeChecked();
    expect(reads.count()).toBe(0);
  });

  it('an unknown view is the List', async () => {
    renderOn('?view=bogus');
    const table = await treegrid();
    await waitFor(() => expect(headers(table)).toContain('Citation rate'));
    expect(screen.getByRole('radio', { name: 'List' })).toBeChecked();
  });

  it('lists the groups only, each opening onto its prompts, with no parent row', async () => {
    renderOn('');
    const table = await treegrid();
    await within(table).findByRole('button', { name: 'Open the group Paid Search' });
    expect(within(table).queryByRole('button', { name: 'Open the group SEO' })).toBeNull();
    expect(within(table).queryByRole('button', { name: 'Open the group Content Marketing' })).toBeNull();
    expect(within(table).getByRole('button', { name: 'Open the group Technical SEO' })).toBeInTheDocument();
  });

  it('shows the By platform columns for ?view=engines: the group, Mention rate, each platform and the gap', async () => {
    renderOn('?view=engines');
    const table = await treegrid();
    await waitFor(() => expect(headers(table)).toContain('ChatGPT mention'));
    expect(headers(table)).toContain('Gemini mention');
    expect(headers(table)).toContain('Mention rate');
    expect(headers(table).some((header) => header.startsWith('Platform gap'))).toBe(true);
    for (const header of ['ChatGPT mentioned', 'Citation rate', 'Top platform', 'Trend']) {
      expect(headers(table)).not.toContain(header);
    }
    expect(screen.getByRole('radio', { name: 'By platform' })).toBeChecked();
    // No metric to choose: the platform columns show the mention rate
    expect(screen.queryByRole('combobox', { name: 'Metric of the platform columns' })).toBeNull();
  });

  it('the view switch writes ?view, keeps the other keys and puts the sort back on the Mention rate', async () => {
    const writes: string[] = [];
    const { user } = renderOn('?q=paid&sort=-citation', {
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    await treegrid();
    await user.click(screen.getByRole('radio', { name: 'By platform' }));
    await waitFor(() => expect(query(writes.at(-1)).get('view')).toBe('engines'));
    expect(query(writes.at(-1)).get('q')).toBe('paid');
    expect(query(writes.at(-1)).get('sort')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'List' }));
    await waitFor(() => expect(query(writes.at(-1)).get('view')).toBeNull());
  });

  it('sorts by the ChatGPT rate from ?sort=chatgpt_web_rate', async () => {
    renderOn('?view=engines&sort=chatgpt_web_rate');
    const table = await treegrid();
    expect(await within(table).findByRole('columnheader', { name: /^ChatGPT mention/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('falls back to the Mention rate when the sort is on a column the view does not show', async () => {
    renderOn('?view=engines&sort=-citation');
    const table = await treegrid();
    expect(await within(table).findByRole('columnheader', { name: /^Mention rate/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('puts a group with no Gemini answer last in both directions, and its cell says so and not 0', async () => {
    const counted = (valid: number, mentioned: number): Counts => ({
      ...NO_COUNTS,
      n_valid: valid,
      n_observations: valid,
      mentioned,
    });
    const topic = (termId: string, name: string, chatgpt: Counts, gemini: readonly Counts[]): object => ({
      term_id: termId,
      name,
      prompt_count: 2,
      engines: [topicCells('chatgpt_web', [chatgpt, chatgpt]), topicCells('gemini_web', gemini)],
    });
    server.use(
      http.get(SUMMARY_PATH, () =>
        HttpResponse.json({
          data: {
            window: { from: '2026-10-16', to: '2026-11-12', timezone: 'Europe/Berlin' },
            include_branded: false,
            engine_codes: ['chatgpt_web', 'gemini_web'],
            entities: [],
            entity_config_versions: [],
            prompts: [],
            topics: [
              topic(MOCK_TERM_IDS.seo, 'SEO', counted(4, 2), [counted(4, 2), counted(4, 2)]),
              topic(MOCK_TERM_IDS.contentMarketing, 'Content Marketing', counted(4, 2), [counted(4, 4), counted(4, 4)]),
              // Answered on ChatGPT, never on Gemini
              topic(MOCK_TERM_IDS.paidSearch, 'Paid Search', counted(4, 2), []),
            ],
          },
        }),
      ),
    );
    const order = (table: HTMLElement): string[] =>
      within(table)
        .getAllByRole('button', { name: /^Open the group / })
        .map((button) => (button.getAttribute('aria-label') ?? '').replace('Open the group ', ''));
    for (const [sort, expected] of [
      ['gemini_web_rate', ['SEO', 'Content Marketing', 'Paid Search']],
      ['-gemini_web_rate', ['Content Marketing', 'SEO', 'Paid Search']],
    ] as const) {
      const { unmount } = renderOn(`?view=engines&sort=${sort}`);
      const table = await treegrid();
      await waitFor(() => expect(order(table)).toEqual(expected));
      // The unknown cell reads as no answers, never as a rate of 0
      const row = within(table).getByRole('button', { name: 'Open the group Paid Search' }).closest('[role="row"]');
      if (row === null) throw new Error('The row of Paid Search is missing');
      const column = headers(table).findIndex((header) => header.startsWith('Gemini mention'));
      const cells = [...row.querySelectorAll('[role="gridcell"], [role="rowheader"]')].map((cell) => cell.textContent);
      expect(cells).toHaveLength(headers(table).length);
      expect(cells[column]).toBe('No answers');
      unmount();
    }
  });

  it('sorts by the engine gap from ?sort=-engine_gap', async () => {
    renderOn('?view=engines&sort=-engine_gap');
    const table = await treegrid();
    expect(await within(table).findByRole('columnheader', { name: /^Platform gap/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('a platform cell opens the drawer on the Prompts tab with ?eng=', async () => {
    const writes: string[] = [];
    const { user } = renderOn('?view=engines', { onUrlUpdate: ({ queryString }) => writes.push(queryString) });
    const table = await treegrid();
    await user.click(await within(table).findByRole('button', { name: 'Open the prompts of Paid Search on ChatGPT' }));
    const last = query(writes.at(-1));
    expect(last.get('inspect')).toBe(`topic:${MOCK_TERM_IDS.paidSearch}`);
    expect(last.get('itab')).toBe('prompts');
    expect(last.get('eng')).toBe('chatgpt_web');
    expect(last.get('view')).toBe('engines');
    const panel = await screen.findByRole('complementary', { name: 'Paid Search' });
    expect(within(panel).getByRole('tab', { name: /^Prompts/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('a group opened onto its prompts lists them as rows with no box, under the group', async () => {
    const { user } = renderOn('');
    const table = await treegrid();
    await user.click(await within(table).findByRole('button', { name: 'Expand Paid Search, 2 prompts' }));
    const promptRows = within(table)
      .getAllByRole('row')
      .filter((row) => row.getAttribute('aria-level') === '2');
    expect(promptRows.length).toBeGreaterThan(0);
    const [first] = promptRows;
    if (first === undefined) throw new Error('No prompt row');
    // PR-TOPICS-10: a prompt row has no checkbox and no eight-prompt limit
    expect(within(first).queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull();
  });

  it('reads no entities: neither the List nor the By platform view asks for them', async () => {
    const reads = watchEntityReads();
    const { user } = renderOn('');
    await treegrid();
    await user.click(screen.getByRole('radio', { name: 'By platform' }));
    await screen.findByRole('columnheader', { name: /^Platform gap/ });
    expect(reads.count()).toBe(0);
  });

  it('fills the group order store in drawn order and empties it on unmount', async () => {
    const { unmount } = renderOn('');
    const table = await treegrid();
    await within(table).findByRole('button', { name: 'Open the group Paid Search' });
    await waitFor(() => expect(getTopicOrder(FYNIX_ID)).not.toBeNull());
    const order = getTopicOrder(FYNIX_ID) ?? [];
    // Only the groups, in the order they are drawn: the parents (SEO, Content Marketing) are no rows
    expect(order).toEqual(
      expect.arrayContaining([MOCK_TERM_IDS.technicalSeo, MOCK_TERM_IDS.localSeo, MOCK_TERM_IDS.paidSearch]),
    );
    expect(order).not.toContain(MOCK_TERM_IDS.seo);
    expect(order).not.toContain(MOCK_TERM_IDS.contentMarketing);
    expect(new Set(order).size).toBe(order.length);
    const drawn = within(table)
      .getAllByRole('button', { name: /^Open the group / })
      .map((button) => button.getAttribute('aria-label')?.replace('Open the group ', ''));
    const names: Record<string, string> = {
      'Technical SEO': MOCK_TERM_IDS.technicalSeo,
      'Local SEO': MOCK_TERM_IDS.localSeo,
      'Paid Search': MOCK_TERM_IDS.paidSearch,
    };
    expect(order.filter((id) => Object.values(names).includes(id))).toEqual(
      drawn.flatMap((name) => (name !== undefined && names[name] !== undefined ? [names[name]] : [])),
    );
    unmount();
    expect(getTopicOrder(FYNIX_ID)).toBeNull();
  });
});

describe('the Groups tab: the heat map, the export and the phone list', () => {
  it('the view switch offers List, By platform and Heat map', async () => {
    renderOn('');
    await treegrid();
    for (const name of ['List', 'By platform', 'Heat map']) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument();
    }
  });

  it('shows the heat map for ?view=heatmap, with the page switch and the mention rate', async () => {
    renderOn('?view=heatmap');
    const grid = await screen.findByRole('grid', { name: 'Mention by group and platform' });
    expect(screen.getByRole('radio', { name: 'Heat map' })).toBeChecked();
    // The page's own switch stays, so the person can still reach the Prompts tab
    expect(screen.getByRole('radio', { name: 'Prompts' })).toBeInTheDocument();
    expect(await within(grid).findByRole('link', { name: /^Paid Search on ChatGPT/ })).toBeInTheDocument();
    expect(screen.queryByRole('treegrid', { name: 'Groups' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Metric of the platform columns' })).toBeNull();
  });

  it('writes ?view=heatmap from the switch and ?sort from the order select, keeping the other keys', async () => {
    const writes: string[] = [];
    const { user } = renderOn('?q=', { onUrlUpdate: ({ queryString }) => writes.push(queryString) });
    await treegrid();
    await user.click(screen.getByRole('radio', { name: 'Heat map' }));
    await screen.findByRole('grid', { name: 'Mention by group and platform' });
    expect(query(writes.at(-1)).get('view')).toBe('heatmap');
    await user.click(screen.getByRole('combobox', { name: 'Order rows by' }));
    await user.click(await screen.findByRole('option', { name: 'Average rate' }));
    await waitFor(() => expect(query(writes.at(-1)).get('sort')).toBe('avg_rate'));
    expect(query(writes.at(-1)).get('view')).toBe('heatmap');
    await user.click(screen.getByRole('combobox', { name: 'Order rows by' }));
    await user.click(await screen.findByRole('option', { name: 'Prompts' }));
    await waitFor(() => expect(query(writes.at(-1)).get('sort')).toBeNull());
  });

  it('narrows the heat map by the search, as the table is narrowed', async () => {
    renderOn('?view=heatmap&q=paid');
    const grid = await screen.findByRole('grid', { name: 'Mention by group and platform' });
    await within(grid).findByRole('rowheader', { name: 'Paid Search' });
    expect(within(grid).queryByRole('rowheader', { name: 'Technical SEO' })).toBeNull();
    expect(screen.queryByText('Search does not narrow the heat map.')).toBeNull();
  });

  it('fills the group order store from the heat map', async () => {
    renderOn('?view=heatmap');
    const grid = await screen.findByRole('grid', { name: 'Mention by group and platform' });
    await within(grid).findByRole('rowheader', { name: 'Paid Search' });
    await waitFor(() => expect(getTopicOrder(FYNIX_ID)).not.toBeNull());
    expect(getTopicOrder(FYNIX_ID)).toEqual(
      expect.arrayContaining([MOCK_TERM_IDS.technicalSeo, MOCK_TERM_IDS.paidSearch]),
    );
  });

  describe('Export by platform', () => {
    const blobs: Blob[] = [];
    const names: string[] = [];
    beforeEach(() => {
      blobs.length = 0;
      names.length = 0;
      URL.createObjectURL = (blob: Blob | MediaSource): string => {
        if (blob instanceof Blob) blobs.push(blob);
        return 'blob:csv';
      };
      URL.revokeObjectURL = vi.fn();
      // jsdom does not follow a download link: the link's name is what the browser would save the file as
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        names.push(this.download);
      });
    });
    afterEach(() => vi.restoreAllMocks());

    it('downloads the file and toasts the count', async () => {
      const { user } = renderOn('?view=engines');
      const table = await treegrid();
      await within(table).findByRole('button', { name: 'Open the group Paid Search' });
      await user.click(screen.getByRole('button', { name: 'Export by platform' }));
      expect(await screen.findByText(/^\d+ groups exported$/)).toBeInTheDocument();
      expect(names).toEqual(['topics-by-engine-mention-2026-10-16-to-2026-11-12.csv']);
      const [blob] = blobs;
      if (blob === undefined) throw new Error('No file was made');
      const text = await blob.text();
      expect(text).toContain('Group,Prompts,ChatGPT Mention (%)');
      expect(text).toContain('Paid Search');
    });

    /** Group rows given by name, prompt count and mentions of 4 answers, each a top level topic of the mock vocabulary. */
    function answerWith(
      rows: readonly (readonly [termId: string, name: string, promptCount: number, mentioned: number])[],
    ) {
      const counted = (mentioned: number): Counts => ({ ...NO_COUNTS, n_valid: 4, n_observations: 4, mentioned });
      server.use(
        http.get(SUMMARY_PATH, () =>
          HttpResponse.json({
            data: {
              window: { from: '2026-10-16', to: '2026-11-12', timezone: 'Europe/Berlin' },
              include_branded: false,
              engine_codes: ['chatgpt_web'],
              entities: [],
              entity_config_versions: [],
              prompts: [],
              topics: rows.map(([termId, name, promptCount, mentioned]) => ({
                term_id: termId,
                name,
                prompt_count: promptCount,
                engines: [topicCells('chatgpt_web', [counted(mentioned), counted(mentioned)])],
              })),
            },
          }),
        ),
      );
    }
    const exportedNames = async (): Promise<string[]> => {
      const [blob] = blobs;
      if (blob === undefined) throw new Error('No file was made');
      return (await blob.text())
        .split('\r\n')
        .slice(1)
        .filter((line) => line !== '')
        .map((line) => line.split(',')[0] ?? '');
    };

    it('writes the groups the most prompts first, and not in the order of the rates', async () => {
      // The rates run the other way: SEO is best and holds the fewest prompts
      answerWith([
        [MOCK_TERM_IDS.seo, 'SEO', 1, 4],
        [MOCK_TERM_IDS.contentMarketing, 'Content Marketing', 9, 1],
        [MOCK_TERM_IDS.paidSearch, 'Paid Search', 5, 2],
      ]);
      const { user } = renderOn('?view=engines');
      const table = await treegrid();
      await within(table).findByRole('button', { name: 'Open the group Content Marketing' });
      await user.click(screen.getByRole('button', { name: 'Export by platform' }));
      await screen.findByText(/^\d+ groups exported$/);
      expect(await exportedNames()).toEqual(['Content Marketing', 'Paid Search', 'SEO']);
    });

    it('narrows the file as the table is narrowed: by the search', async () => {
      answerWith([
        [MOCK_TERM_IDS.seo, 'SEO', 1, 4],
        [MOCK_TERM_IDS.contentMarketing, 'Content Marketing', 9, 1],
      ]);
      const { user } = renderOn('?view=engines&q=content');
      const table = await treegrid();
      await within(table).findByRole('button', { name: 'Open the group Content Marketing' });
      await user.click(screen.getByRole('button', { name: 'Export by platform' }));
      expect(await screen.findByText('1 group exported')).toBeInTheDocument();
      expect(await exportedNames()).toEqual(['Content Marketing']);
    });

    it('is off while the groups load, so there is no misleading "No group to export"', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.get(SUMMARY_PATH, async ({ request }) => {
          if (new URL(request.url).searchParams.get('rows') !== 'topics') await gate;
          return undefined;
        }),
      );
      renderOn('?view=engines');
      expect(await screen.findByRole('button', { name: 'Export by platform' })).toBeDisabled();
      release();
      const table = await treegrid();
      await within(table).findByRole('button', { name: 'Open the group Paid Search' });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Export by platform' })).toBeEnabled());
    });

    it('is off when the groups could not be read', async () => {
      server.use(
        http.get(SUMMARY_PATH, () =>
          HttpResponse.json({ status: 500, code: 'internal_error', title: 'Failed' }, { status: 500 }),
        ),
      );
      renderOn('?view=engines');
      expect(await screen.findByRole('button', { name: 'Export by platform' })).toBeDisabled();
      expect(screen.queryByText('No group to export')).toBeNull();
    });

    it('is only in the By platform view', async () => {
      renderOn('');
      await treegrid();
      expect(screen.queryByRole('button', { name: 'Export by platform' })).toBeNull();
    });
  });

  describe('on a phone', () => {
    it('renders the phone list under 768 px with the best platform and the platform count', async () => {
      stubPhone();
      renderOn('');
      const list = await screen.findByRole('list', { name: /^Groups, \d+ results/ });
      const paid = await within(list).findByRole('button', { name: /^Paid Search/ });
      expect(paid).toHaveTextContent(/Best on .+ \d+% \(.+ answers\), \d+ platforms?/);
      expect(screen.queryByRole('treegrid')).toBeNull();
      expect(screen.getByRole('radio', { name: 'List' })).toBeChecked();
    });

    it('is the same list for the By platform view and keeps the heat map as a grid', async () => {
      stubPhone();
      const engines = renderOn('?view=engines');
      expect(await screen.findByRole('list', { name: /^Groups, \d+ results/ })).toBeInTheDocument();
      engines.unmount();
      renderOn('?view=heatmap');
      expect(await screen.findByRole('grid', { name: 'Mention by group and platform' })).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: /^Groups/ })).toBeNull();
    });

    it('opens the drawer on Overview from a row', async () => {
      stubPhone();
      const writes: string[] = [];
      const { user } = renderOn('', { onUrlUpdate: ({ queryString }) => writes.push(queryString) });
      const list = await screen.findByRole('list', { name: /^Groups, \d+ results/ });
      await user.click(await within(list).findByRole('button', { name: /^Paid Search/ }));
      await waitFor(() => expect(query(writes.at(-1)).get('inspect')).toBe(`topic:${MOCK_TERM_IDS.paidSearch}`));
      expect(query(writes.at(-1)).get('itab')).toBeNull();
      const panel = await screen.findByRole('complementary', { name: 'Paid Search' });
      expect(within(panel).getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    });
  });
});
