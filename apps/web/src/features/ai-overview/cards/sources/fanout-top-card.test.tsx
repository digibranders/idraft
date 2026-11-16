import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useEffect, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FanoutTopCard from './fanout-top-card';
import { failing, renderWithoutPlatform } from './test-harness';
import { fanoutMeta, fanoutPage, fanoutRow } from './model/fanout-fixtures';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import { CardInfoProvider } from '@/components/app/chart/card-info';
import type { CardProps } from '@/features/layouts';
import type { Schemas } from '@/lib/api/types';
import { clearPreferences } from '@/lib/preferences/storage';
import { axe } from '@/test/axe';
import { cardInOverview, type OverviewWorld } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const FANOUT = '*/api/v1/workspaces/:w/projects/:p/ai/fanout-queries';
const HEADING = 'Top fan-out queries';
const CAPTION = 'Fan-out queries by the answers that ran them';

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  clearPreferences();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const FIVE_DOMAINS = [
  ['g2.com', 'third_party', 31],
  ['fynix.com', 'own', 9],
  ['capterra.com', 'third_party', 8],
  ['hubspot.com', 'competitor', 6],
  ['forbes.com', 'third_party', 4],
] as const;

/** Five queries over 96 valid answers, 80 of which ran a search; ChatGPT is the only engine that shows them. */
function page(over: Parameters<typeof fanoutMeta>[0] = {}): Schemas['FanoutQueryPage'] {
  return fanoutPage(
    [
      fanoutRow({ text: 'best crm for startups', observations: 14, prompts: 3, cited: FIVE_DOMAINS }),
      fanoutRow({
        text: 'crm pricing comparison',
        observations: 11,
        cited: [
          ['g2.com', 'third_party', 20],
          ['capterra.com', 'third_party', 12],
        ],
      }),
      fanoutRow({ text: 'hubspot alternatives', observations: 9, cited: [['hubspot.com', 'competitor', 14]] }),
      fanoutRow({ text: 'crm for small teams reviews', observations: 6, prompts: 1 }),
      fanoutRow({ text: 'zoho vs pipedrive', observations: 3 }),
    ],
    fanoutMeta(over),
  );
}

const serve = (body: Schemas['FanoutQueryPage']): void => {
  server.use(http.get(FANOUT, () => HttpResponse.json(body)));
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
  { rows = '5', world = 'fynix' }: RenderOptions = {},
): ReturnType<typeof renderWithProviders> {
  const Card = (props: CardProps): ReactElement => (
    <ExportProvider>
      <Reader />
      <CardInfoProvider>
        <FanoutTopCard {...props} options={{ rows }} />
      </CardInfoProvider>
    </ExportProvider>
  );
  return renderWithProviders(cardInOverview({ type: 'ai.fanout_top', Card, world }), { searchParams });
}

const table = (): Promise<HTMLElement> => screen.findByRole('table', { name: CAPTION });

describe('the top fan-out queries card', () => {
  it('shows a table of the queries with the answers that ran them, their prompts and the domain cited most', async () => {
    serve(page());
    renderCard();
    const rows = within(await table()).getAllByRole('row');
    expect(
      within(rows[0] as HTMLElement)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Fan-out query', 'Answers', 'Prompts', 'Top cited']);
    const first = within(rows[1] as HTMLElement);
    expect(first.getByText('best crm for startups')).toBeInTheDocument();
    expect(first.getByText('14')).toBeInTheDocument();
    expect(first.getByText('3')).toBeInTheDocument();
    expect(first.getByText('g2.com')).toBeInTheDocument();
    expect(rows).toHaveLength(6);
  });

  it('says which platforms show their searches and how many answers ran one, as counts', async () => {
    serve(page());
    renderCard();
    await table();
    expect(await screen.findByText(/ChatGPT only · 80 of 96 answers ran a search/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: HEADING })).toBeInTheDocument();
  });

  it('has the preview info text behind its info button', async () => {
    serve(page());
    renderCard();
    await table();
    expect(screen.getByRole('button', { name: /about top fan-out queries/i })).toBeInTheDocument();
    expect(screen.getByText(/The extra searches ChatGPT runs to build its answers\./)).toBeInTheDocument();
  });

  it('keeps its place and says it is not measured when no platform in scope shows its searches', async () => {
    serve(page({ engines: ['gemini_web'], without: ['gemini_web'] }));
    renderCard('cmp=off&engine=gemini_web');
    expect(await screen.findByRole('heading', { name: HEADING })).toBeInTheDocument();
    expect(
      (
        await screen.findAllByText(
          /Top fan-out queries is not measured on .*Choose All platforms or another platform\./,
        )
      ).length,
    ).toBeGreaterThan(0);
  });

  it('lists the same queries with their shares and counts in the Table view, and registers them for the export', async () => {
    serve(page());
    renderCard();
    await table();
    const block = sink.read().blocks[0];
    expect(block?.rows).toHaveLength(5);
    expect(block?.rows[0]?.[0]).toBe('best crm for startups');
  });

  it('passes axe', async () => {
    serve(page());
    const { container } = renderCard();
    await table();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the idle state, and asks nothing, when no platform is on for the project', async () => {
    const asked = vi.fn();
    server.use(
      http.get(FANOUT, () => {
        asked();
        return HttpResponse.json(page());
      }),
    );
    renderWithoutPlatform(
      <FanoutTopCard
        item={{ id: 'bare', type: 'ai.fanout_top' }}
        options={{ rows: '5' }}
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
    server.use(http.get(FANOUT, () => failing('req-1')));
    const { user } = renderCard();
    expect(await screen.findByText(/Could not load /)).toBeInTheDocument();
    expect(screen.getByText('Error ID req-1')).toBeInTheDocument();
    serve(page());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await table()).toBeInTheDocument();
  });

  it('says no answer ran a search, with the answers collected, and no zero', async () => {
    serve(fanoutPage([], fanoutMeta({ answers: 40, withFanout: 0 })));
    renderCard();
    expect(await screen.findByText('No answer ran a search in this period')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: CAPTION })).not.toBeInTheDocument();
  });

  it('draws the text of a query as text: markup in it is no markup', async () => {
    serve(
      fanoutPage(
        [
          fanoutRow({
            text: '<img src=x onerror=alert(1)>best crm',
            observations: 14,
            cited: [['<b>g2</b>.com', 'third_party', 3]],
          }),
        ],
        fanoutMeta(),
      ),
    );
    renderCard();
    await table();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
  });
});
