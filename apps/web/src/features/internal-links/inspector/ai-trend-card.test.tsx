import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiTrendCard } from './ai-trend-card';
import { formatBusinessDate } from '@/lib/format';
import { AI_CITED_PAGE, AI_QUIET_PAGE, pageAiOf } from '@/mocks/internal-links-page-ai';
import { axe } from '@/test/axe';
import { expectNoPixelWidth } from '@/test/drawer-width-scan';
import { renderWithProviders } from '@/test/render';

beforeEach(() => {
  // jsdom has no 2D canvas context; ECharts mounts cleanly when getContext returns null.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AiTrendCard', () => {
  it('renders the chart title, cited line, positive compare change, summary sentence and passes a11y/width', async () => {
    const ai = pageAiOf(AI_CITED_PAGE, { compare: 'previous_period' });
    const { container } = renderWithProviders(<AiTrendCard ai={ai} />);

    expect(screen.getByRole('heading', { name: 'Citations over time' })).toBeInTheDocument();
    expect(screen.getByText('Cited in 14 answers')).toBeInTheDocument();
    const change = screen.getByText('up +3 against the 28 days before (11)');
    expect(change).toHaveClass('text-positive-text');

    const start = formatBusinessDate(ai.window.from);
    const end = formatBusinessDate(ai.window.to);
    expect(screen.getByText(`Cited in 14 of 42 answers, ${start} to ${end}`)).toBeInTheDocument();

    expectNoPixelWidth(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows a negative change when citations decreased against the compared period', () => {
    const ai = { ...pageAiOf(AI_CITED_PAGE, { compare: 'previous_period' }), previous_answers_citing: 16 };
    renderWithProviders(<AiTrendCard ai={ai} />);

    const change = screen.getByText('down −2 against the 28 days before (16)');
    expect(change).toHaveClass('text-negative-text');
  });

  it('omits the compare change when uncompared or when previous period had zero answers', () => {
    const uncompared = pageAiOf(AI_CITED_PAGE, { compare: 'none' });
    const first = renderWithProviders(<AiTrendCard ai={uncompared} />);
    expect(screen.getByText('Cited in 14 answers')).toBeInTheDocument();
    expect(screen.queryByText(/days before/)).toBeNull();
    first.unmount();

    const noPrevAnswers = { ...pageAiOf(AI_CITED_PAGE, { compare: 'previous_period' }), previous_answers: 0 };
    renderWithProviders(<AiTrendCard ai={noPrevAnswers} />);
    expect(screen.queryByText(/days before/)).toBeNull();
  });

  it('says Not cited in this period while keeping the chart mounted at zero for quiet pages', () => {
    const quiet = pageAiOf(AI_QUIET_PAGE, { compare: 'previous_period' });
    renderWithProviders(<AiTrendCard ai={quiet} />);

    expect(screen.getByText('Not cited in this period')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Table' })).toBeInTheDocument();
  });

  it('switches to a Table view with the same daily counts and No answers on zero-answer days', async () => {
    const ai = pageAiOf(AI_CITED_PAGE, { compare: 'previous_period' });
    const { user, container } = renderWithProviders(<AiTrendCard ai={ai} />);

    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: 'Citations over time' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(28);
    expect(rows[2]).toHaveTextContent('1 of 2 answers');
    expect(rows[3]).toHaveTextContent('No answers');

    expectNoPixelWidth(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
