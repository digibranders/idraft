import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DetectableEmpty } from './detectable-empty';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const render = (
  props: { compare: boolean; compared: number; previousAnswers?: number | null },
  handlers = { onTurnOn: vi.fn(), onClear: vi.fn() },
): ReturnType<typeof renderWithProviders> & typeof handlers =>
  Object.assign(renderWithProviders(<DetectableEmpty previousAnswers={null} {...props} {...handlers} />), handlers);

describe('DetectableEmpty', () => {
  it('says how many rows were compared and that none changed by more than normal variation', () => {
    render({ compare: true, compared: 12 });
    expect(screen.getByRole('heading', { name: 'No detectable change in these rows' })).toBeInTheDocument();
    expect(
      screen.getByText(
        '12 rows were compared with the previous period and none changed by more than normal variation.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Compare with previous period' })).toBeNull();
  });

  it('says one row in the singular', () => {
    render({ compare: true, compared: 1 });
    expect(screen.getByText(/^1 row was compared/)).toBeInTheDocument();
  });

  it('says the previous period has no answers when it has none', () => {
    render({ compare: true, compared: 0, previousAnswers: 0 });
    expect(screen.getByText('The previous period has no answers, so no change can be told.')).toBeInTheDocument();
  });

  it('says no row has enough answers in both periods when the previous period has answers', () => {
    render({ compare: true, compared: 0, previousAnswers: 40 });
    expect(screen.getByText('No row has enough answers in both periods to tell a change.')).toBeInTheDocument();
    expect(screen.queryByText(/previous period has no answers/)).toBeNull();
  });

  it('does not claim the previous period is empty when the response does not say', () => {
    render({ compare: true, compared: 0, previousAnswers: null });
    expect(screen.getByText('No row has enough answers in both periods to tell a change.')).toBeInTheDocument();
  });

  it('says comparison is off and turns it on', async () => {
    const { user, onTurnOn } = render({ compare: false, compared: 0 });
    expect(screen.getByRole('heading', { name: 'No comparison to read changes from' })).toBeInTheDocument();
    expect(
      screen.getByText('Comparison is off, so no change can be detected. Turn it on or clear the filter.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Compare with previous period' }));
    expect(onTurnOn).toHaveBeenCalledOnce();
  });

  it('clears the filters', async () => {
    const { user, onClear } = render({ compare: true, compared: 3 });
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('is axe clean in both states', async () => {
    const on = render({ compare: true, compared: 3 });
    expect(await axe(on.container)).toHaveNoViolations();
    on.unmount();
    const off = render({ compare: false, compared: 0 });
    expect(await axe(off.container)).toHaveNoViolations();
  });
});
