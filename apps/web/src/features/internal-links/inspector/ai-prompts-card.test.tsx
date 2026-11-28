import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AiPromptsCard } from './ai-prompts-card';
import { promptIdsOf } from '@/lib/pages/ai-model';
import { AI_CITED_PAGE, AI_QUIET_PAGE, pageAiOf } from '@/mocks/internal-links-page-ai';
import { axe } from '@/test/axe';
import { expectNoPixelWidth } from '@/test/drawer-width-scan';
import { renderWithProviders } from '@/test/render';

describe('AiPromptsCard', () => {
  it('lists every citing prompt with canonical citing platforms and cited counts', async () => {
    const ai = pageAiOf(AI_CITED_PAGE);
    const onOpenPrompt = vi.fn();
    const { container } = renderWithProviders(<AiPromptsCard ai={ai} onOpenPrompt={onOpenPrompt} />);

    expect(screen.getByRole('heading', { name: 'Prompts that cite this page' })).toBeInTheDocument();
    expect(screen.getByText('6 prompts · cited in 14 answers')).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Prompts that cite this page' });
    for (const header of within(table).getAllByRole('columnheader')) {
      expect(header).toHaveClass('type-table-header');
    }

    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(6);

    const firstRow = rows[0];
    const firstPrompt = ai.prompts[0];
    if (firstRow === undefined || firstPrompt === undefined) throw new Error('Expected first prompt row');
    expect(within(firstRow).getByRole('button', { name: firstPrompt.text })).toBeInTheDocument();
    expect(within(firstRow).getByText('ChatGPT')).toBeInTheDocument();
    expect(within(firstRow).getByText('Gemini')).toBeInTheDocument();
    expect(within(firstRow).getByText('Google AI Mode')).toBeInTheDocument();
    expect(firstRow).toHaveTextContent('4/9');

    expectNoPixelWidth(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('calls onOpenPrompt with prompt id and full row order, including for branded prompts', async () => {
    const ai = pageAiOf(AI_CITED_PAGE);
    const onOpenPrompt = vi.fn();
    const { user } = renderWithProviders(<AiPromptsCard ai={ai} onOpenPrompt={onOpenPrompt} />);

    const expectedOrder = promptIdsOf(ai);
    const branded = ai.prompts[2];
    if (branded === undefined) throw new Error('Expected branded prompt at index 2');

    await user.click(screen.getByRole('button', { name: branded.text }));
    expect(onOpenPrompt).toHaveBeenCalledWith(branded.prompt_id, expectedOrder);
  });

  it('shows only the platforms that cited the page for each prompt', () => {
    const ai = pageAiOf(AI_CITED_PAGE);
    renderWithProviders(<AiPromptsCard ai={ai} onOpenPrompt={vi.fn()} />);

    const table = screen.getByRole('table', { name: 'Prompts that cite this page' });
    const rows = within(table).getAllByRole('row').slice(1);
    const sixthRow = rows[5];
    if (sixthRow === undefined) throw new Error('Expected 6th prompt row');

    expect(within(sixthRow).queryByText('ChatGPT')).toBeNull();
    expect(within(sixthRow).getByText('Gemini')).toBeInTheDocument();
    expect(within(sixthRow).queryByText('Google AI Mode')).toBeNull();
    expect(sixthRow).toHaveTextContent('1/5');
  });

  it('shows an empty card when no tracked prompt cited this page', async () => {
    const ai = pageAiOf(AI_QUIET_PAGE);
    const { container } = renderWithProviders(<AiPromptsCard ai={ai} onOpenPrompt={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'No prompt cited this page' })).toBeInTheDocument();
    expect(screen.getByText("None of this page's tracked prompts cited it in this period.")).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('notes the cap when prompts_total exceeds the rows shown', () => {
    const ai = { ...pageAiOf(AI_CITED_PAGE), prompts_total: 120 };
    renderWithProviders(<AiPromptsCard ai={ai} onOpenPrompt={vi.fn()} />);

    expect(screen.getByText('120 prompts · cited in 14 answers')).toBeInTheDocument();
    expect(screen.getByText('Showing the 6 most cited prompts of 120.')).toBeInTheDocument();
  });
});
