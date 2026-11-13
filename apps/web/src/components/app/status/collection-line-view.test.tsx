import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CollectionLineView } from './collection-line-view';
import type { LineDescription } from '@/lib/runs/ai-health-model';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const popup = (): Element | null => document.querySelector('[data-slot="tooltip"]');

const finished = (over: Partial<Extract<LineDescription, { kind: 'finished' }>> = {}): LineDescription => ({
  kind: 'finished',
  status: 'completed',
  when: '06:12',
  counts: { done: 141, total: 150, noun: 'answers' },
  ...over,
});

describe('CollectionLineView', () => {
  it('reads each line in its own words, with a thousands separator and the noun in the singular for one', () => {
    const cases: readonly [LineDescription, string][] = [
      [finished(), 'Last run 06:12, 141 of 150 answers'],
      [
        finished({ when: 'Nov 12', counts: { done: 998, total: 1200, noun: 'checks' } }),
        'Last run Nov 12, 998 of 1,200 checks',
      ],
      [finished({ counts: { done: 1, total: 1, noun: 'keywords' } }), 'Last run 06:12, 1 of 1 keyword'],
      [finished({ counts: { done: 3, total: 4, noun: 'tasks' } }), 'Last run 06:12, 3 of 4 tasks'],
      [finished({ counts: null }), 'Last run 06:12'],
      [{ kind: 'running', status: 'running' }, 'Running now'],
      [{ kind: 'none' }, 'No runs yet'],
      [{ kind: 'unavailable' }, 'Run status unavailable'],
    ];
    for (const [line, words] of cases) {
      const view = renderWithProviders(<CollectionLineView line={line} />);
      expect(screen.getByText(words)).toBeVisible();
      view.unmount();
    }
  });

  it('shows a skeleton and says Loading run status while the newest run is read', async () => {
    const { container } = renderWithProviders(<CollectionLineView line={null} />);
    expect(screen.getByText('Loading run status')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the words and no tooltip outside the rail', async () => {
    const { user, container } = renderWithProviders(<CollectionLineView line={finished()} />);
    const words = screen.getByText('Last run 06:12, 141 of 150 answers');
    await user.hover(words);
    expect(popup()).toBeNull();
    expect(screen.queryByRole('region', { name: /Last run/ })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows only the icon in the rail, named by the words, with the words in a tooltip on focus', async () => {
    const { user, container } = renderWithProviders(<CollectionLineView line={finished()} rail />);
    const region = screen.getByRole('region', { name: 'Last run 06:12, 141 of 150 answers' });
    expect(screen.queryByText('Last run 06:12, 141 of 150 answers')).toBeNull();
    await user.tab();
    expect(region).toHaveFocus();
    expect(
      await screen.findByText('Last run 06:12, 141 of 150 answers', { selector: '[data-slot="tooltip"] *' }),
    ).toBeVisible();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('tints the icon by what happened, so a failed run and a warning are not read as success', () => {
    const tones: readonly [LineDescription, string][] = [
      [finished({ status: 'completed' }), 'text-positive-text'],
      [finished({ status: 'completed_with_errors' }), 'text-warning-text'],
      [finished({ status: 'failed' }), 'text-negative-text'],
      [{ kind: 'unavailable' }, 'text-warning-text'],
      [{ kind: 'none' }, 'text-foreground-tertiary'],
    ];
    for (const [line, tone] of tones) {
      const view = renderWithProviders(<CollectionLineView line={line} />);
      expect(view.container.querySelector('[data-slot="collection-line"] [data-slot="icon"]')).toHaveClass(tone);
      view.unmount();
    }
  });
});
