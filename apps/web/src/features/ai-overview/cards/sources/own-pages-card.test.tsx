import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OwnPagesCard from './own-pages-card';
import { pagePage, pageRow } from './model/page.test-fixtures';
import { at, sourcesMeta } from './model/source.test-fixtures';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import { CardInfoProvider } from '@/components/app/chart/card-info';
import type { CardDrill } from '../engines/use-card-seams';
import type { CardProps } from '@/features/layouts';
import type { SourcePagePage } from '@/lib/citations/types';
import { clearPreferences } from '@/lib/preferences/storage';
import { axe } from '@/test/axe';
import { cardInOverview, type OverviewWorld } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { failing, renderWithoutPlatform } from '@/test/overview-no-platform';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const seam = vi.hoisted(() => ({ drill: null as CardDrill | null }));
vi.mock('../engines/use-card-seams', async (importActual) => {
  const actual = await importActual<typeof import('../engines/use-card-seams')>();
  return {
    ...actual,
    useCardDrill: (): CardDrill => {
      const real = actual.useCardDrill();
      return seam.drill ?? real;
    },
  };
});

const PAGES = '*/api/v1/workspaces/:w/projects/:p/ai/sources/pages';
const HEADING = 'Your pages cited';
const CAPTION = 'Your pages by citation units';
const ENGINES = ['chatgpt_web', 'gemini_web'] as const;

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  seam.drill = null;
  clearPreferences();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const META = sourcesMeta({ units: 18420, answers: 6210, citing: 5100, engines: ENGINES, byRole: { own: 1032 } });

/** Three own pages on one domain: 612, 300 and 120 citation units. */
function page(): SourcePagePage {
  return pagePage(
    [
      pageRow({
        url: 'https://fynix.com/pricing?utm_source=x',
        urlId: 11,
        units: 612,
        answers: 540,
        prompts: 88,
        title: 'Pricing | Fynix',
        engines: [
          ['chatgpt_web', 301],
          ['gemini_web', 112],
        ],
      }),
      pageRow({ url: 'https://fynix.com/blog/crm-guide', urlId: 12, units: 300, answers: 250, prompts: 40 }),
      pageRow({ url: 'https://fynix.com/docs/start', urlId: 13, units: 120, answers: 100, prompts: 12 }),
    ],
    META,
  );
}

const serve = (body: SourcePagePage = page()): void => {
  server.use(http.get(PAGES, () => HttpResponse.json(body)));
};

const sink: { read: () => ExportRead } = { read: () => ({ blocks: [], loading: 0 }) };
function Reader(): ReactElement {
  const reader = useExportBlocks();
  useEffect(() => {
    sink.read = reader;
  }, [reader]);
  return <></>;
}

interface RenderOptions {
  rows?: string;
  world?: OverviewWorld;
}

function renderCard(
  searchParams = 'cmp=off',
  { rows = '8', world = 'fynix' }: RenderOptions = {},
): ReturnType<typeof renderWithProviders> {
  const Card = (props: CardProps): ReactElement => (
    <ExportProvider>
      <Reader />
      <CardInfoProvider>
        <OwnPagesCard {...props} options={{ rows }} />
      </CardInfoProvider>
    </ExportProvider>
  );
  return renderWithProviders(cardInOverview({ type: 'sources.own_pages', Card, world }), { searchParams });
}

const barList = (): Promise<HTMLElement> => screen.findByRole('table', { name: CAPTION });
const labelsOf = (list: HTMLElement): string[] =>
  within(list)
    .getAllByRole('row')
    .map((item) => item.querySelector('th a, th > span > span')?.textContent ?? '');

describe('the your pages cited card', () => {
  it('shows one line per page, the path with a chart-1 bar, its share of the units of your domains and its units', async () => {
    serve();
    renderCard();
    const list = await barList();
    expect(labelsOf(list)).toEqual(['/pricing', '/blog/crm-guide', '/docs/start']);
    const rows = within(list).getAllByRole('row');
    expect(within(at(rows, 0)).getByText('59%')).toBeInTheDocument();
    expect(within(at(rows, 0)).getByText('612 units')).toBeInTheDocument();
    for (const row of rows) expect(row.querySelector('[data-slot="domain-bar"]')?.className).toContain('bg-chart-1');
  });

  it('says the units of your domains in the meta line, and has the preview info text', async () => {
    serve();
    renderCard();
    await barList();
    expect(await screen.findByText('1,032 units from fynix.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /about your pages cited/i })).toBeInTheDocument();
    expect(screen.getByText(/Which pages of your site AI answers cite\./)).toBeInTheDocument();
  });

  it('keeps its header and says the preview reason when no page of yours was cited, and never a zero', async () => {
    serve(pagePage([], sourcesMeta({ units: 900, answers: 40, citing: 30, engines: ENGINES, byRole: { own: 0 } })));
    renderCard();
    expect(await screen.findByRole('heading', { name: HEADING })).toBeInTheDocument();
    expect(await screen.findByText('None of your pages was cited')).toBeInTheDocument();
    expect(screen.getByText('No answer in this scope cited a page of your domain.')).toBeInTheDocument();
    expect(screen.queryByText(/\b0 units/)).not.toBeInTheDocument();
  });

  it('says the same when no answer cited any page', async () => {
    serve(pagePage([], sourcesMeta({ units: 0, answers: 40, citing: 0, engines: ENGINES, byRole: {} })));
    renderCard();
    expect(await screen.findByText('None of your pages was cited')).toBeInTheDocument();
  });

  it('links each page to its drawer on the Cited pages tab of Citations', async () => {
    serve();
    renderCard();
    const link = await screen.findByRole('link', { name: '/pricing' });
    const href = new URL(link.getAttribute('href') ?? '', 'http://localhost');
    expect(href.pathname).toBe('/digibranders/fynix/ai/citations');
    expect(href.searchParams.get('inspect')).toMatch(/^cited-page:\d+$/);
  });

  it('registers every page for the export with address, title and units by platform', async () => {
    serve();
    renderCard();
    await barList();
    const block = sink.read().blocks[0];
    expect(block?.rows).toHaveLength(3);
    expect(block?.rows[0]?.[0]).toBe('/pricing');
  });

  it('passes axe', async () => {
    serve();
    const { container } = renderCard();
    await barList();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the idle state, and asks nothing, when no platform is on for the project', async () => {
    const asked = vi.fn();
    server.use(
      http.get(PAGES, () => {
        asked();
        return HttpResponse.json(page());
      }),
    );
    renderWithoutPlatform(
      <OwnPagesCard
        item={{ id: 'bare', type: 'sources.own_pages' }}
        options={{ rows: '8' }}
        width="half"
        mode="view"
        live
      />,
    );
    expect(await screen.findByText('No platform is on for this project')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: CAPTION })).not.toBeInTheDocument();
    expect(asked).not.toHaveBeenCalled();
  });

  it('shows Retry and an error id for a failed read, and Retry reads again', async () => {
    server.use(http.get(PAGES, () => failing('req-1')));
    const { user } = renderCard();
    expect(await screen.findByText('Could not load your cited pages')).toBeInTheDocument();
    expect(screen.getByText('Error ID req-1')).toBeInTheDocument();
    serve();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await barList()).toBeInTheDocument();
  });

  it('draws provider text as text: an address with markup is no markup', async () => {
    serve(
      pagePage(
        [
          pageRow({
            url: 'https://fynix.com/%3Cimg%20src=x%20onerror=alert(1)%3E',
            urlId: 21,
            units: 50,
            title: '<b>bold</b>',
          }),
        ],
        META,
      ),
    );
    renderCard();
    await barList();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
  });
});
