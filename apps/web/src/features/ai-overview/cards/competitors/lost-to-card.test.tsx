import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import LostToCard from './lost-to-card';
import { cell, competitor, engine, entityCells, own, promptRow, share, summaryOf } from './model/summary-fixtures';
import { OpenCompetitorContext, type OpenCompetitor } from '../../competitor-drawer/open-competitor';
import { CardInfoProvider } from '@/components/app/chart/card-info';
import type { CardProps } from '@/features/layouts';
import type { EngineSummary, PromptSummaryRow, SummaryEntity } from '@/lib/api/types';
import { cardInOverview } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';
const HUBSPOT = competitor(2, 'HubSpot');
const ENTITIES: SummaryEntity[] = [own(), HUBSPOT];

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** One prompt on one platform: `n` valid answers, you named in `you`, HubSpot in `rival`. */
function onPlatform(code: string, n: number, you: number, rival: number): EngineSummary {
  return engine(code, {
    mentioned: cell(you, n),
    entities: [entityCells(own(), cell(you, n), share(you, n)), entityCells(HUBSPOT, cell(rival, n), share(rival, n))],
  });
}

function serve(prompts: PromptSummaryRow[]): void {
  server.use(http.get(SUMMARY, () => HttpResponse.json({ data: summaryOf({ entities: ENTITIES, prompts }) })));
}

function renderCard(searchParams: string, open: OpenCompetitor = () => undefined) {
  const Card = (props: CardProps): ReactElement => (
    <CardInfoProvider>
      <OpenCompetitorContext value={open}>
        <LostToCard {...props} options={{ ...props.options, engine: 'gemini_web' }} />
      </OpenCompetitorContext>
    </CardInfoProvider>
  );
  return renderWithProviders(cardInOverview({ type: 'ai.lost_to_competitor', Card }), { searchParams });
}

/** Three prompts on ChatGPT: HubSpot leads one, you lead one, one is close. */
const PROMPTS = [
  promptRow(1, [onPlatform('chatgpt_web', 8, 1, 5)]),
  promptRow(2, [onPlatform('chatgpt_web', 8, 5, 1)]),
  promptRow(3, [onPlatform('chatgpt_web', 8, 3, 4)]),
];

describe('the competitor gap card follows the page scope', () => {
  it('counts the prompts each side leads, over the prompts that could be compared, with no engine option', async () => {
    serve(PROMPTS);
    renderCard('cmp=off&engine=chatgpt_web');
    const table = await screen.findByRole('table', { name: /Prompts where each competitor leads/ });
    const row = within(table).getByRole('row', { name: /HubSpot/ });
    expect(within(row).getByRole('button', { name: 'Prompts where HubSpot leads: 1 of 3' })).toHaveTextContent(
      '1 of 3',
    );
    expect(within(row).getByRole('button', { name: 'Prompts where you lead: 1 of 3' })).toHaveTextContent('1 of 3');
  });

  it('opens the drawer from the name, and on the prompts of a lead from a count', async () => {
    const open = vi.fn();
    serve(PROMPTS);
    const { user } = renderCard('cmp=off&engine=chatgpt_web', open);
    await user.click(await screen.findByRole('button', { name: 'Open HubSpot' }));
    expect(open).toHaveBeenLastCalledWith('00000000-0000-4000-8000-000000000002', expect.any(HTMLElement));
    await user.click(screen.getByRole('button', { name: 'Prompts where you lead: 1 of 3' }));
    expect(open).toHaveBeenLastCalledWith('00000000-0000-4000-8000-000000000002', expect.any(HTMLElement), {
      lead: 'you',
    });
  });

  it('counts a prompt once for All platforms, decided on each platform without pooling the answers', async () => {
    serve([promptRow(1, [onPlatform('chatgpt_web', 8, 1, 5), onPlatform('gemini_web', 8, 4, 4)])]);
    renderCard('cmp=off');
    expect(await screen.findByRole('button', { name: 'Prompts where HubSpot leads: 1 of 1' })).toBeInTheDocument();
  });

  it('says there is no rate yet when no prompt has 4 valid answers, and shows no zero', async () => {
    serve([promptRow(1, [onPlatform('chatgpt_web', 3, 0, 3)])]);
    renderCard('cmp=off&engine=chatgpt_web');
    expect(await screen.findByText('Too few answers on this platform.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Prompts where/ })).not.toBeInTheDocument();
  });

  it('states the rule in its info text, so a person can read what a count means', async () => {
    serve(PROMPTS);
    renderCard('cmp=off&engine=chatgpt_web');
    await screen.findByRole('table', { name: /Prompts where each competitor leads/ });
    expect(screen.getByText(/at least 2 more answers than the other/, { selector: 'span' })).toBeInTheDocument();
  });
});
