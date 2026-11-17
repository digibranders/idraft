import { render, screen } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { pageColumns, pageIdentity, type PageColumnsContext } from './page-columns';
import messages from '../../../../messages/en.json';
import { BoardTable } from '@/components/app/table/board-table';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { CitedPageRow } from '@/lib/citations/board-queries';

const t = createTranslator({ locale: 'en', messages, namespace: 'citations' });
const OWN: CitedPageRow = {
  url_id: 1,
  url: 'https://fynix.digital/pricing',
  host: 'fynix.digital',
  path: '/pricing',
  registrable_domain: 'fynix.digital',
  title: 'Pricing and plans',
  domain_role: 'own',
  entity_id: null,
  entity_name: null,
  color_index: null,
  citations: 76,
  previous_citations: 70,
  prompts: 31,
  top_prompts: [{ prompt_id: 'p1', text: 'What is the best CRM for a 20-person startup?', citations: 9 }],
  engines: [
    { engine_code: 'chatgpt_web', citation_units: 50 },
    { engine_code: 'gemini_web', citation_units: 0 },
  ],
  trend: [5, 6, 7, 8, 9, 9, 10, 11],
  last_cited_at: '2026-09-28T00:10:00.000Z',
};
const COMPETITOR: CitedPageRow = {
  ...OWN,
  url_id: 2,
  url: 'https://brightwave.co.uk/pricing',
  host: 'brightwave.co.uk',
  domain_role: 'competitor',
  entity_name: 'Brightwave Digital',
  color_index: 2,
  previous_citations: 0,
  prompts: 1,
};
const PREVIOUS = { full: 'the previous 4 runs (Aug 10 to Aug 31)', short: 'the previous 4 runs' };

function draw(context: Partial<PageColumnsContext> = {}, rows: readonly CitedPageRow[] = [OWN, COMPETITOR]) {
  const promptsPopover = vi.fn((_: CitedPageRow, chip: ReactElement) => chip);
  const full: PageColumnsContext = {
    t,
    owner: 'all',
    engines: [
      { code: 'chatgpt_web', label: 'ChatGPT' },
      { code: 'gemini_web', label: 'Gemini' },
    ],
    previous: PREVIOUS,
    trendSlots: 8,
    timeZone: 'Europe/Berlin',
    latest: '2026-09-28T00:15:00.000Z',
    promptsPopover,
    ...context,
  };
  const columns = pageColumns(full);
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <TooltipProvider delay={0}>
        <BoardTable<CitedPageRow>
          caption="Cited pages"
          columns={columns}
          rows={rows}
          rowId={(row) => String(row.url_id)}
          rowLabel={(row) => row.url}
          onOpen={() => undefined}
          activeId={null}
          sort={{ key: 'citations', dir: 'desc' }}
          onSortChange={() => undefined}
        />
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
  return { columns, promptsPopover };
}

describe('the Cited pages columns (C 459 to 543)', () => {
  it('has the preview widths with Domain type only when the owner is not Your site', () => {
    expect(draw().columns.map((column) => [column.header, column.width])).toEqual([
      ['Page', 280],
      ['Domain type', 140],
      ['Citations', 104],
      ['Change', 88],
      ['Prompts', null],
      ['Platforms', 196],
      ['Trend', 104],
      ['Last cited', 104],
    ]);
  });

  it('drops Domain type for Your site and narrows Platforms for one platform', () => {
    const { columns } = draw({ owner: 'own', engines: [{ code: 'chatgpt_web', label: 'ChatGPT' }] }, [OWN]);
    expect(columns.map((column) => column.header)).not.toContain('Domain type');
    expect(columns.find((column) => column.header === 'Platforms')?.width).toBe(112);
  });

  it('draws the cells: the own path, a competitor host and path, New, the change, the top prompt, the chip', () => {
    draw();
    // Both rows end in /pricing: the own one is the path alone, the competitor's has its host before it
    const [own, competitor] = screen.getAllByText('/pricing', { selector: 'span' });
    expect(own).toBeVisible();
    expect(own?.querySelector('span')).toBeNull();
    expect(competitor?.querySelector('span')).toHaveTextContent('brightwave.co.uk');
    expect(screen.getByText('brightwave.co.uk')).toHaveClass('text-foreground-tertiary');
    expect(screen.getAllByText('New')).toHaveLength(1);
    expect(screen.getByText('+6')).toBeVisible();
    expect(screen.getByText('Brightwave Digital')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Prompts that cite /pricing, 31 prompts' })).toHaveTextContent('+30');
    expect(screen.getAllByRole('button', { name: /^Prompts that cite/ })[1]).toHaveTextContent('Details');
    expect(screen.getAllByText('Sep 28')).toHaveLength(2);
  });

  it('keeps the engine name for screen readers beside a mark, and dims a platform with no citations', () => {
    draw();
    expect(screen.getAllByText('ChatGPT')[0]).toHaveClass('sr-only');
    expect(screen.getAllByText('Gemini')[0]?.closest('span.opacity-40')).not.toBeNull();
  });

  it('says the last N runs in the Trend tip when there are fewer than 8', () => {
    expect(draw({ trendSlots: 3 }).columns.find((column) => column.header === 'Trend')?.tip).toBe(
      'Citations in each of the last 3 runs',
    );
  });

  it('names the row button and gives its tooltip, with the New line only for a page not cited before', () => {
    expect(pageIdentity(OWN, t, PREVIOUS)).toEqual({
      label: 'Open fynix.digital/pricing',
      tip: { content: 'Pricing and plans (fynix.digital/pricing)' },
    });
    expect(pageIdentity(COMPETITOR, t, PREVIOUS).tip.detail).toBe(
      'Not cited in the previous 4 runs (Aug 10 to Aug 31)',
    );
  });
});
