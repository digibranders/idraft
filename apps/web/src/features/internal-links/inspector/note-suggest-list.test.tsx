import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NoteSuggestList, suggestOptionId } from './note-suggest-list';
import type { Suggestion } from '@/lib/pages/note-mentions';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const SUGGESTIONS: readonly Suggestion[] = [
  {
    kind: 'mention',
    mention: { type: 'user', label: '@Priya Natarajan', target: 'u1' },
    hint: 'Priya Natarajan',
    detail: null,
  },
  {
    kind: 'mention',
    mention: { type: 'page', label: '@/pricing', target: '108' },
    hint: '/pricing',
    detail: 'Pricing',
  },
  {
    kind: 'mention',
    mention: { type: 'keyword', label: '@"vapt services"', target: 'vapt services' },
    hint: 'x',
    detail: null,
  },
  { kind: 'command', name: 'date' },
];

function show(activeIndex: number, onPick = vi.fn()): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <NoteSuggestList
      id="list"
      suggestions={SUGGESTIONS}
      activeIndex={activeIndex}
      onPick={onPick}
      label="Suggestions"
    />,
  );
}

describe('NoteSuggestList', () => {
  it('is a named listbox of options, one of them selected, each with an id built from the list id', () => {
    show(1);
    const options = within(screen.getByRole('listbox', { name: 'Suggestions' })).getAllByRole('option');
    expect(options).toHaveLength(4);
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'false']);
    expect(options.map((option) => option.id)).toEqual([0, 1, 2, 3].map((index) => suggestOptionId('list', index)));
  });

  it('writes the label, the second line and the kind in each row, and the name and words of a command', () => {
    show(0);
    const [teammate, page, keyword, command] = screen.getAllByRole('option');
    expect(teammate).toHaveTextContent('@Priya Natarajan');
    expect(teammate).toHaveTextContent('Teammate');
    expect(page).toHaveTextContent('@/pricing');
    expect(page).toHaveTextContent('Pricing');
    expect(page).toHaveTextContent('Page');
    expect(keyword).toHaveTextContent('Tracked keyword');
    expect(command).toHaveTextContent('/date');
    expect(command).toHaveTextContent("Put in today's date");
  });

  it('picks on mousedown and stops the default, so the text area keeps its focus', () => {
    const onPick = vi.fn();
    show(0, onPick);
    const notPrevented = fireEvent.mouseDown(screen.getAllByRole('option')[1] as HTMLElement);
    expect(notPrevented).toBe(false);
    expect(onPick).toHaveBeenCalledWith(SUGGESTIONS[1]);
  });

  it('has no violations', async () => {
    const { container } = show(0);
    expect(await axe(container)).toHaveNoViolations();
  });
});
