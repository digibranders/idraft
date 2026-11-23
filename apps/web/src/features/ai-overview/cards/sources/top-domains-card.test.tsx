import { screen, within } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CardInfoProvider } from '@/components/app/chart/card-info';
import { at, domainPage, domainRow, sourcesMeta } from './model/source.test-fixtures';
import TopDomainsCard from './top-domains-card';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import type { CardDrill } from '../engines/use-card-seams';
import type { CardProps } from '@/features/layouts';
import type { SourceDomainPage } from '@/lib/citations/types';
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

const DOMAINS = '*/api/v1/workspaces/:w/projects/:p/ai/sources/domains';
const HEADING = 'Top cited domains';
const CAPTION = 'Top cited domains by citation units';
const ENGINES = ['chatgpt_web', 'gemini_web'] as const;
const TOTAL = 18420;

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

/** Four domains of 18,420 citation units: one of yours, one competitor and two third parties. */
function page(over: { answers?: number; valid?: number } = {}): SourceDomainPage {
  const common = { total: TOTAL, valid: over.valid ?? 6210 };
  return domainPage(
    [
      domainRow({
        domain: 'g2.com',
        units: 1912,
        answers: 1104,
        prompts: 211,
        engines: [
          ['chatgpt_web', 1200],
          ['gemini_web', 712],
        ],
        ...common,
      }),
      domainRow({ domain: 'fynix.com', role: 'own', units: 1500, answers: 900, ...common }),
      domainRow({ domain: 'capterra.com', units: 1300, answers: 700, ...common }),
      domainRow({ domain: 'hubspot.com', role: 'competitor', units: 900, answers: 500, entityId: 'e-2', ...common }),
    ],
    sourcesMeta({ units: TOTAL, answers: over.answers ?? 6210, citing: 5100, engines: ENGINES }),
    4,
  );
}

const serve = (current: SourceDomainPage): void => {
  server.use(http.get(DOMAINS, () => HttpResponse.json(current)));
};

const sink: { read: () => ExportRead } = { read: () => ({ blocks: [], loading: 0 }) };
function Reader(): ReactElement {
  const reader = useExportBlocks();
  useEffect(() => {
    sink.read = reader;
  }, [reader]);
  return <></>;
}

function renderCard({
  rows = '8',
  role = 'all',
  world = 'fynix',
}: { rows?: string; role?: string; world?: OverviewWorld } = {}): ReturnType<typeof renderWithProviders> {
  const Card = (props: CardProps): ReactElement => (
    <ExportProvider>
      <Reader />
      <CardInfoProvider>
        <TopDomainsCard {...props} options={{ rows, role }} />
      </CardInfoProvider>
    </ExportProvider>
  );
  return renderWithProviders(cardInOverview({ type: 'sources.top_domains', Card, world, role: 'admin' }), {
    searchParams: 'cmp=off',
  });
}

const barList = (): Promise<HTMLElement> => screen.findByRole('table', { name: CAPTION });
const labelsOf = (list: HTMLElement): string[] =>
  within(list)
    .getAllByRole('row')
    .map((item) => item.querySelector('th a, th > span > span')?.textContent ?? '');

describe('the top cited domains card', () => {
  it('shows a skeleton at its height, then one line per domain with yours in chart-1', async () => {
    server.use(
      http.get(DOMAINS, async () => {
        await delay(60);
        return HttpResponse.json(page());
      }),
    );
    renderCard();
    const heading = await screen.findByRole('heading', { name: HEADING });
    const frame = heading.closest('section');
    expect(frame).toHaveAttribute('aria-busy', 'true');
    const list = await barList();
    expect(labelsOf(list)).toEqual(['g2.com', 'fynix.com', 'capterra.com', 'hubspot.com']);
    const fills = within(list)
      .getAllByRole('row')
      .map((item) => item.querySelector('[data-slot="domain-bar"]')?.className ?? '');
    expect(at(fills, 1)).toContain('bg-chart-1');
    for (const index of [0, 2, 3]) expect(at(fills, index)).not.toContain('bg-chart-1');
  });

  it('names the role of each domain in text, beside the domain', async () => {
    serve(page());
    renderCard();
    const items = within(await barList()).getAllByRole('row');
    expect(within(at(items, 0)).getByText('Third party')).toBeInTheDocument();
    expect(within(at(items, 1)).getByText('Your site')).toBeInTheDocument();
    expect(within(at(items, 3)).getByText('Competitor')).toBeInTheDocument();
  });

  it('writes the share of citation units with one decimal and the units of the scope in the meta line', async () => {
    serve(page());
    renderCard();
    const items = within(await barList()).getAllByRole('row');
    expect(within(at(items, 0)).getByText('10.4%')).toBeInTheDocument();
    expect(within(at(items, 1)).getByText('8.1%')).toBeInTheDocument();
    expect(await screen.findByText('of 18,420 citation units')).toBeInTheDocument();
  });

  it('has the preview info text behind its info button, and no By role or Ranked control', async () => {
    serve(page());
    renderCard();
    await barList();
    expect(screen.getByRole('button', { name: /about top cited domains/i })).toBeInTheDocument();
    expect(
      screen.getByText(
        /The domains AI answers cite most often\..*A page is counted once for each answer that cites it\. Each share is a part of all citations in scope\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'By role' })).toBeNull();
  });

  it('keeps its header and says the preview reason when no answer cited a page', async () => {
    serve(domainPage([], sourcesMeta({ units: 0, answers: 120, citing: 0, engines: ENGINES }), 0));
    renderCard();
    expect(await screen.findByRole('heading', { name: HEADING })).toBeInTheDocument();
    expect(await screen.findByText('No answers cited a page in this scope.')).toBeInTheDocument();
    expect(screen.getByText('No citations yet')).toBeInTheDocument();
  });

  it('shows a share over fewer than 4 answers as its answers, never as a percent', async () => {
    serve(page({ valid: 3 }));
    renderCard();
    const items = within(await barList()).getAllByRole('row');
    expect(within(at(items, 0)).queryByText(/%/)).toBeNull();
    expect(within(at(items, 0)).getByText(/3 answers/)).toBeInTheDocument();
  });

  it('registers the rows for the export with the role and the units by platform', async () => {
    serve(page());
    renderCard();
    await barList();
    const block = sink.read().blocks[0];
    expect(block?.header).toContain('Role');
    expect(block?.rows[0]?.[0]).toBe('g2.com');
  });

  it('passes axe', async () => {
    serve(page());
    const { container } = renderCard();
    await barList();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the idle state, and asks nothing, when no platform is on for the project', async () => {
    const asked = vi.fn();
    server.use(
      http.get(DOMAINS, () => {
        asked();
        return HttpResponse.json(page());
      }),
    );
    renderWithoutPlatform(
      <TopDomainsCard
        item={{ id: 'bare', type: 'sources.top_domains' }}
        options={{ rows: '8', role: 'all' }}
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
    server.use(http.get(DOMAINS, () => failing('req-1')));
    const { user } = renderCard();
    expect(await screen.findByText('Could not load top cited domains')).toBeInTheDocument();
    expect(screen.getByText('Error ID req-1')).toBeInTheDocument();
    serve(page());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await barList()).toBeInTheDocument();
  });
});
