import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AnswerComparePanel, type AnswerCompareState } from './answer-compare-panel';
import { HOSTILE_TITLES, MARKER as WP08_MARKER } from '@/components/app/cells/xss-fixtures';
import type { Schemas } from '@/lib/api/types';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const COMPARE: Schemas['AnswerCompare'] = {
  prompt_id: '00000000-0000-0000-0000-00000000001a',
  engine_code: 'chatgpt_web',
  latest: {
    observation_id: '84120007',
    observed_at: '2026-11-12T09:30:00Z',
    own_mentioned: true,
    own_domain_cited: true,
  },
  baseline: {
    observation_id: '83001115',
    observed_at: '2026-11-05T09:30:00Z',
    own_mentioned: true,
    own_domain_cited: false,
  },
  entities: {
    gained: [{ entity_id: '00000000-0000-0000-0000-000000000007', name: 'Rival One', role: 'competitor' }],
    lost: [
      { entity_id: '00000000-0000-0000-0000-000000000009', name: 'Rival Two', role: 'competitor' },
      { entity_id: '00000000-0000-0000-0000-00000000000a', name: 'Rival Three', role: 'watch' },
    ],
    kept: [{ entity_id: '00000000-0000-0000-0000-000000000001', name: 'Acme', role: 'own' }],
  },
  sources: {
    gained: [
      { registrable_domain: 'acme.example', host: 'www.acme.example', domain_role: 'own', title: 'Acme pricing' },
    ],
    lost: [{ registrable_domain: 'news.example', host: 'news.example', domain_role: 'third_party', title: null }],
    kept_count: 4,
  },
};

function show(
  state: AnswerCompareState,
  onOpenBaseline: (observationId: string, observedAt: string) => void = () => undefined,
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(<AnswerComparePanel state={state} timeZone="UTC" onOpenBaseline={onOpenBaseline} />);
}

const section = (): HTMLElement =>
  screen
    .getByRole('heading', { name: 'Change since the last answer that named the brand' })
    .closest('section') as HTMLElement;

describe('AnswerComparePanel', () => {
  it('shows a skeleton while the comparison is on its way', async () => {
    const { container } = show({ status: 'loading' });
    expect(section()).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says what was gained, lost and kept, in words and with counts, for brands and for sources', async () => {
    const { container } = show({ status: 'ready', compare: COMPARE });
    const view = within(section());
    expect(view.getByText('1 brand gained')).toBeInTheDocument();
    expect(view.getByText('2 brands lost')).toBeInTheDocument();
    expect(view.getByText('1 brand kept')).toBeInTheDocument();
    expect(view.getByText('1 source gained')).toBeInTheDocument();
    expect(view.getByText('1 source lost')).toBeInTheDocument();
    expect(view.getByText('4 sources in both answers')).toBeInTheDocument();
    // The names sit under their heading, a gained one is told by its words and not by a colour
    const gained = view.getByText('1 brand gained').parentElement as HTMLElement;
    expect(within(gained).getByText('Rival One')).toBeInTheDocument();
    expect(within(gained).queryByText('Rival Two')).toBeNull();
    const lost = view.getByText('2 brands lost').parentElement as HTMLElement;
    expect(within(lost).getByText('Rival Two')).toBeInTheDocument();
    expect(within(lost).getByText('Rival Three')).toBeInTheDocument();
    expect(within(lost).getByText('Watched')).toBeInTheDocument();
    const sourcesGained = view.getByText('1 source gained').parentElement as HTMLElement;
    expect(within(sourcesGained).getByText('Acme pricing')).toBeInTheDocument();
    expect(within(sourcesGained).getByText('www.acme.example')).toBeInTheDocument();
    // A source with no title is named by its host
    const sourcesLost = view.getByText('1 source lost').parentElement as HTMLElement;
    expect(within(sourcesLost).getAllByText('news.example').length).toBeGreaterThan(0);
    // No colour class chooses a tone for gained or lost
    expect(container.innerHTML).not.toMatch(/positive|negative|text-(green|red)/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says no brand or source changed, as words, when a group is empty', () => {
    show({
      status: 'ready',
      compare: {
        ...COMPARE,
        entities: { gained: [], lost: [], kept: [] },
        sources: { gained: [], lost: [], kept_count: 0 },
      },
    });
    const view = within(section());
    expect(view.getByText('No brand gained')).toBeInTheDocument();
    expect(view.getByText('No brand lost')).toBeInTheDocument();
    expect(view.getByText('No source in both answers')).toBeInTheDocument();
    expect(view.queryAllByRole('list')).toHaveLength(0);
  });

  it('names both answers by date and number, and opens the baseline from its Open button', async () => {
    const onOpen = vi.fn<(observationId: string, observedAt: string) => void>();
    const { user } = show({ status: 'ready', compare: COMPARE }, onOpen);
    const view = within(section());
    expect(view.getByText(/84120007/)).toBeInTheDocument();
    expect(view.getByText(/83001115/)).toBeInTheDocument();
    expect(view.queryByRole('button', { name: /Open the answer of Nov 12/ })).toBeNull();
    await user.click(view.getByRole('button', { name: /^Open the answer of Nov 5/ }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('83001115', '2026-11-05T09:30:00Z');
  });

  it('says in words whether each answer names the brand and cites its domain', () => {
    show({ status: 'ready', compare: COMPARE });
    const view = within(section());
    expect(view.getByText('Names the brand, cites its domain')).toBeInTheDocument();
    expect(view.getByText('Names the brand, does not cite its domain')).toBeInTheDocument();
  });

  it('says there is no earlier answer to compare, as a reason and not as a failure', async () => {
    const { container } = show({ status: 'empty' });
    expect(screen.getByText('No earlier answer to compare')).toBeInTheDocument();
    expect(screen.getByText(/No earlier answer of this engine named the brand/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(container.querySelector('[data-slot="inline-error"]')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says the comparison failed, with Try again', async () => {
    const onRetry = vi.fn<() => void>();
    const { user, container } = show({ status: 'error', errorId: null, onRetry, retrying: false });
    expect(screen.getByText('The comparison could not be loaded')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keeps the previous comparison at full opacity, with the static bar, while it reads again', () => {
    const { container, rerender } = show({ status: 'ready', compare: COMPARE });
    expect(container.querySelector('[data-slot="compare-refetch-bar"]')).toBeNull();
    rerender(
      <AnswerComparePanel
        state={{ status: 'refetching', compare: COMPARE }}
        timeZone="UTC"
        onOpenBaseline={() => undefined}
      />,
    );
    const bar = container.querySelector('[data-slot="compare-refetch-bar"]');
    expect(bar).toHaveClass('absolute', 'inset-x-0', 'top-0', 'h-0.5', 'bg-primary');
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Rival One')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('shows a hostile name or title as inert text', () => {
    for (const hostile of HOSTILE_TITLES) {
      const { container, unmount } = show({
        status: 'ready',
        compare: {
          ...COMPARE,
          entities: { ...COMPARE.entities, gained: [{ entity_id: 'x', name: hostile, role: 'competitor' }] },
          sources: {
            ...COMPARE.sources,
            gained: [
              { registrable_domain: 'x.example', host: 'x.example', domain_role: 'third_party', title: hostile },
            ],
          },
        },
      });
      // The section's own glyph is the one svg
      expect(container.querySelectorAll('script, img, iframe, style, a')).toHaveLength(0);
      expect(container.querySelectorAll('svg')).toHaveLength(1);
      expect(container.textContent).toContain(hostile);
      expect(Reflect.get(window, WP08_MARKER)).toBeUndefined();
      unmount();
    }
  });
});
