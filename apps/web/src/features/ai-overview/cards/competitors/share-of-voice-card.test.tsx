import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { competitor, engine, entityCells, own, share, summaryOf, weighted } from './model/summary-fixtures';
import ShareOfVoiceCard from './share-of-voice-card';
import { OpenCompetitorContext, type OpenCompetitor } from '../../competitor-drawer/open-competitor';
import type { CardProps } from '@/features/layouts';
import type { EngineSummary, SummaryEntity } from '@/lib/api/types';
import { cardInOverview } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';
const THREE: SummaryEntity[] = [own(), competitor(2, 'HubSpot'), competitor(3, 'Zoho')];

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** One platform total: the share numerators of the three brands over `answers` that name a tracked brand. */
function totalOf(code: string, numerators: readonly number[], answers: number): EngineSummary {
  const cells = THREE.map((entity, index) =>
    entityCells(entity, weighted(numerators[index] ?? 0, 120, [0.3]), share(numerators[index] ?? 0, answers)),
  );
  return engine(code, {
    mentioned: weighted(numerators[0] ?? 0, 120, [0.3]),
    share: share(numerators[0] ?? 0, answers),
    entities: cells,
  });
}

function serve(...total: EngineSummary[]): void {
  server.use(http.get(SUMMARY, () => HttpResponse.json({ data: summaryOf({ entities: THREE, total }) })));
}

function renderCard(searchParams: string, options: Record<string, string> = {}, open?: OpenCompetitor) {
  const Card = (props: CardProps): ReactElement => (
    <OpenCompetitorContext value={open ?? (() => undefined)}>
      <ShareOfVoiceCard {...props} options={{ ...props.options, ...options }} />
    </OpenCompetitorContext>
  );
  return renderWithProviders(cardInOverview({ type: 'ai.share_of_voice', Card }), { searchParams });
}

const list = (): Promise<HTMLElement> => screen.findByRole('list', { name: 'Share of voice by brand' });

describe('the share of voice card follows the page scope', () => {
  it('draws one platform from the page scope, with no engine option, and the answers behind it', async () => {
    serve(totalOf('chatgpt_web', [25, 50, 25], 100), totalOf('gemini_web', [10, 10, 0], 20));
    renderCard('cmp=off&engine=chatgpt_web');
    const rows = within(await list()).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('HubSpot'),
      expect.stringContaining('Fynix (you)'),
      expect.stringContaining('Zoho'),
    ]);
    expect(screen.getByText('of 100 brand mentions')).toBeInTheDocument();
  });

  it('is the equal-weight average of the platforms for All platforms, labelled average of N, not a pooled ratio', async () => {
    serve(totalOf('chatgpt_web', [40, 30, 30], 100), totalOf('gemini_web', [10, 10, 0], 20));
    renderCard('cmp=off');
    await list();
    expect(screen.getByText('average of 2 platforms')).toBeInTheDocument();
    // (40% + 50%) / 2 = 45% for you; pooled it would be 50 of 120
    expect(within(await list()).getByText('45%')).toBeInTheDocument();
    expect(within(await list()).getByText('40%')).toBeInTheDocument();
  });

  it('does not read a leftover engine option of an older layout', async () => {
    serve(totalOf('chatgpt_web', [40, 40, 20], 100), totalOf('gemini_web', [10, 10, 0], 20));
    renderCard('cmp=off', { engine: 'gemini_web' });
    await list();
    expect(screen.getByText('average of 2 platforms')).toBeInTheDocument();
  });

  it('opens the competitor drawer from a competitor name, and offers no button on your own row', async () => {
    const open = vi.fn();
    serve(totalOf('chatgpt_web', [25, 50, 25], 100));
    const { user } = renderCard('cmp=off&engine=chatgpt_web', {}, open);
    await list();
    expect(screen.queryByRole('button', { name: /Open Fynix/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open HubSpot' }));
    expect(open).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000002', expect.any(HTMLElement));
  });

  it('says there is no rate yet, and draws no zero, when fewer than 4 answers name a tracked brand', async () => {
    serve(totalOf('chatgpt_web', [1, 1, 1], 3));
    renderCard('cmp=off&engine=chatgpt_web');
    expect(await screen.findByText('Too few answers on this platform.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Share of voice by brand' })).not.toBeInTheDocument();
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
  });

  it('says no competitor is tracked when only the own brand is', async () => {
    const only = [own()];
    server.use(
      http.get(SUMMARY, () =>
        HttpResponse.json({
          data: summaryOf({
            entities: only,
            total: [
              engine('chatgpt_web', {
                mentioned: weighted(30, 120, [0.3]),
                share: share(30, 30),
                entities: [entityCells(only[0] as SummaryEntity, weighted(30, 120, [0.3]), share(30, 30))],
              }),
            ],
          }),
        }),
      ),
    );
    renderCard('cmp=off&engine=chatgpt_web');
    expect(await screen.findByText('No competitor is tracked')).toBeInTheDocument();
  });
});
