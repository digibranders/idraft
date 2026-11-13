import { screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CheckList, type CheckListProps } from './check-list';
import type { CheckReason, CheckRow } from './check-rows';
import { announce } from '@/lib/a11y/announcer';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

// The real announcer, watched: the list speaks through it and never through a live region of its own
vi.mock('@/lib/a11y/announcer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/a11y/announcer')>();
  return { ...actual, announce: vi.fn(actual.announce) };
});
beforeEach(() => {
  vi.mocked(announce).mockClear();
});

const row = (line: number, extra: Partial<CheckRow> = {}): CheckRow => ({
  line,
  text: `Question number ${String(line)} for the list?`,
  language: 'en',
  group: 'new',
  reasons: [],
  suggestedType: null,
  target: null,
  ...extra,
});
const note = (text: string): CheckReason => ({ tone: 'note', text });
const warn = (text: string): CheckReason => ({ tone: 'warning', text });
const problem = (text: string): CheckReason => ({ tone: 'error', text });

const props = (rows: readonly CheckRow[], extra: Partial<CheckListProps> = {}): CheckListProps => ({
  rows,
  checking: false,
  failed: false,
  needsCountry: false,
  restore: null,
  onShow: null,
  ...extra,
});
const show = (list: CheckListProps): ReactElement => <CheckList {...list} />;
const checkAnnouncements = (): string[] =>
  vi
    .mocked(announce)
    .mock.calls.filter(([, options]) => options?.key === 'add-prompts-checks')
    .map(([message]) => message);

describe('the check list', () => {
  it('stays closed when no line has a problem, says so, and opens on the disclosure button', async () => {
    const { user } = renderWithProviders(show(props([row(1), row(2)])));
    const toggle = screen.getByRole('button', { name: /Check the list/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('No problems found');
    expect(screen.queryByRole('list', { name: 'Checks of the list' })).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('list', { name: 'Checks of the list' })).toBeInTheDocument();
  });

  it('renders nothing for an empty list of rows', () => {
    renderWithProviders(show(props([])));
    expect(screen.queryByRole('button', { name: /Check the list/ })).not.toBeInTheDocument();
    expect(vi.mocked(announce)).not.toHaveBeenCalled();
  });

  it('opens by itself when a line cannot be added, and names the line before anything else', () => {
    renderWithProviders(
      show(
        props([
          row(1),
          row(2, { group: 'refused', reasons: [problem('Longer than 2,000 characters, so it cannot be added.')] }),
        ]),
      ),
    );
    expect(screen.getByRole('button', { name: /Check the list/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Check the list/ })).toHaveTextContent('1 line cannot be added');
    const headings = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual(['Cannot be added (1)', 'Will be added (1)']);
    // The tone is in words, the icon is not read
    const item = screen.getByText('Line 2').closest('li');
    if (item === null) throw new Error('The item is missing');
    expect(within(item).getByText('Cannot be added:')).toBeInTheDocument();
  });

  it('keeps a list the person closed closed, also while a line cannot be added', async () => {
    const { user } = renderWithProviders(show(props([row(1, { group: 'refused', reasons: [problem('No.')] })])));
    await user.click(screen.getByRole('button', { name: /Check the list/ }));
    expect(screen.getByRole('button', { name: /Check the list/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('gives each group a level 3 heading with its count, and each item starts with Line N and its text in its language', async () => {
    const { user } = renderWithProviders(
      show(
        props([
          row(1, { text: 'Welche CRM passt zu mir?', language: 'de' }),
          row(2, { group: 'tracked', reasons: [note('Already tracked, so it is left out.')] }),
          row(3, { group: 'repeat', reasons: [note('Repeats line 1 and is left out.')] }),
          row(4, { reasons: [warn('Asks more than one question. Answers to it will mix them.')] }),
        ]),
      ),
    );
    await user.click(screen.getByRole('button', { name: /Check the list/ }));
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Warnings (1)',
      'Will be added (2)',
      'Already tracked (1)',
      'Repeats in the list (1)',
    ]);
    const items = within(screen.getByRole('list', { name: 'Checks of the list' })).getAllByRole('listitem');
    const lineItems = items.filter((item) => /^Line \d/.test(item.textContent ?? ''));
    expect(lineItems.map((item) => /^Line \d+/.exec(item.textContent ?? '')?.[0])).toEqual([
      'Line 4',
      'Line 1',
      'Line 4',
      'Line 2',
      'Line 3',
    ]);
    expect(screen.getAllByText('Welche CRM passt zu mir?')[0]).toHaveAttribute('lang', 'de');
  });

  it('shows the most serious check of a line and counts the rest, which open in place', async () => {
    const { user } = renderWithProviders(
      show(
        props([
          row(1, {
            reasons: [
              warn('Asks more than one question. Answers to it will mix them.'),
              note('Differs from a tracked prompt only in case or spacing: “x”. Both will be asked.'),
              note('Names Acme, so it counts as branded.'),
            ],
          }),
        ]),
      ),
    );
    await user.click(screen.getByRole('button', { name: /Check the list/ }));
    const added = screen.getByRole('heading', { level: 3, name: 'Will be added (1)' }).closest('li');
    if (added === null) throw new Error('The group is missing');
    // The warning has its own group, so in this one the most serious check is the first note
    expect(within(added).getByText(/Differs from a tracked prompt/)).toBeInTheDocument();
    expect(within(added).queryByText(/Names Acme/)).not.toBeInTheDocument();
    const more = within(added).getByRole('button', { name: 'And 1 more check' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(within(added).getByText(/Names Acme/)).toBeInTheDocument();
    expect(within(added).getByRole('button', { name: 'Show fewer checks' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('offers Show it for a tracked line with a prompt, and calls it with that prompt', async () => {
    const shown: string[] = [];
    const { user } = renderWithProviders(
      show(
        props(
          [
            row(1, { group: 'tracked', target: 'prompt-1', reasons: [note('Already tracked, so it is left out.')] }),
            row(2, { group: 'tracked', target: null, reasons: [note('Already tracked, so it is left out.')] }),
          ],
          { onShow: (target) => shown.push(target) },
        ),
      ),
    );
    await user.click(screen.getByRole('button', { name: /Check the list/ }));
    expect(screen.getAllByRole('button', { name: /^Show it/ })).toHaveLength(1);
    // The name starts with the visible text (WCAG 2.5.3)
    await user.click(screen.getByRole('button', { name: 'Show it, line 1' }));
    expect(shown).toEqual(['prompt-1']);
  });

  it('offers no Show it when the caller cannot show a prompt', async () => {
    const { user } = renderWithProviders(
      show(props([row(1, { group: 'tracked', target: 'prompt-1', reasons: [note('Already tracked.')] })])),
    );
    await user.click(screen.getByRole('button', { name: /Check the list/ }));
    expect(screen.queryByRole('button', { name: /^Show it/ })).not.toBeInTheDocument();
  });

  it('puts the Restore checkbox in the Archived group with the count, and reports its change', async () => {
    const changes: boolean[] = [];
    const archived = (line: number): CheckRow =>
      row(line, { group: 'archived', target: `p${String(line)}`, reasons: [note('Archived.')] });
    const { user } = renderWithProviders(
      show(
        props([archived(1), archived(2)], {
          restore: { checked: true, onCheckedChange: (next) => changes.push(next) },
        }),
      ),
    );
    await user.click(screen.getByRole('button', { name: /Check the list/ }));
    const checkbox = screen.getByRole('checkbox', { name: 'Restore archived (2)' });
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    expect(changes).toEqual([false]);
  });

  it('shows no Restore checkbox without archived lines or without a restore', async () => {
    const { user } = renderWithProviders(show(props([row(1, { group: 'archived', reasons: [note('Archived.')] })])));
    await user.click(screen.getByRole('button', { name: /Check the list/ }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('keeps the last answer while the next is on its way, and says it is checking', async () => {
    const { user } = renderWithProviders(
      show(props([row(1, { group: 'tracked', reasons: [note('Already tracked.')] })], { checking: true })),
    );
    expect(screen.getByRole('button', { name: /Check the list/ })).toHaveTextContent('Checking the list');
    await user.click(screen.getByRole('button', { name: /Check the list/ }));
    expect(screen.getByRole('list', { name: 'Checks of the list' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('heading', { level: 3, name: 'Already tracked (1)' })).toBeInTheDocument();
  });

  it('asks for a country instead of saying nothing is tracked, and says when the list could not be checked', async () => {
    const view = renderWithProviders(show(props([row(1)], { needsCountry: true })));
    await view.user.click(screen.getByRole('button', { name: /Check the list/ }));
    expect(screen.getByText('Choose a country to check what is tracked.')).toBeInTheDocument();
    view.unmount();
    const failed = renderWithProviders(show(props([row(1)], { failed: true })));
    await failed.user.click(screen.getByRole('button', { name: /Check the list/ }));
    expect(
      screen.getByText('The list could not be checked. You can still add it; the server checks it.'),
    ).toBeInTheDocument();
  });

  it('shows five lines of a group and the rest on request, and never hides a line that cannot be added', async () => {
    const many = Array.from({ length: 8 }, (_, index) => row(index + 1));
    const refused = Array.from({ length: 7 }, (_, index) =>
      row(index + 20, { group: 'refused', reasons: [problem('Has a character that cannot be saved.')] }),
    );
    const { user } = renderWithProviders(show(props([...many, ...refused])));
    const added = screen.getByRole('heading', { level: 3, name: 'Will be added (8)' }).closest('li');
    const blocked = screen.getByRole('heading', { level: 3, name: 'Cannot be added (7)' }).closest('li');
    if (added === null || blocked === null) throw new Error('A group is missing');
    expect(within(added).getAllByText(/^Line \d/)).toHaveLength(5);
    expect(within(blocked).getAllByText(/^Line \d/)).toHaveLength(7);
    await user.click(within(added).getByRole('button', { name: 'Show 3 more' }));
    expect(within(added).getAllByText(/^Line \d/)).toHaveLength(8);
    expect(within(added).getByRole('button', { name: 'Show fewer' })).toBeInTheDocument();
  });

  it('speaks the counts once, a moment after they change, through the shared announcer', () => {
    const { rerender } = renderWithProviders(show(props([row(1), row(2)])));
    expect(vi.mocked(announce)).toHaveBeenCalledWith('2 lines: 2 new', {
      key: 'add-prompts-checks',
      debounceMs: 800,
    });
    // The same counts again are not spoken again
    rerender(show(props([row(1), row(2)])));
    expect(checkAnnouncements()).toEqual(['2 lines: 2 new']);
    rerender(show(props([row(1), row(2, { group: 'tracked' })])));
    expect(checkAnnouncements().at(-1)).toBe('2 lines: 1 new and 1 already tracked');
    // While the lint is out, the counts are not final, so nothing is said
    vi.mocked(announce).mockClear();
    rerender(show(props([row(1)], { checking: true })));
    expect(checkAnnouncements()).toEqual([]);
  });

  it('counts a new line that has a warning once, in the group count and in what is spoken', async () => {
    const { user } = renderWithProviders(
      show(props([row(1, { reasons: [warn('Has 3 words. Prompts of 5 to 60 words read like real questions.')] })])),
    );
    expect(checkAnnouncements()).toEqual(['1 line: 1 new']);
    await user.click(screen.getByRole('button', { name: /Check the list/ }));
    expect(screen.getByRole('heading', { level: 3, name: 'Warnings (1)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Will be added (1)' })).toBeInTheDocument();
  });

  it('has no accessibility violations with every group open', async () => {
    const { container, user } = renderWithProviders(
      show(
        props(
          [
            row(1, { group: 'refused', reasons: [problem('Has a character that cannot be saved.')] }),
            row(2, {
              reasons: [
                warn('Asks more than one question. Answers to it will mix them.'),
                note('Names Acme.'),
                note('Differs from a tracked prompt only in case or spacing.'),
              ],
            }),
            row(3, { suggestedType: 'Type: comparison (from wording)' }),
            row(4, { group: 'tracked', target: 'p4', reasons: [note('Already tracked.')] }),
            row(5, { group: 'archived', target: 'p5', reasons: [note('Archived.')] }),
            row(6, { group: 'repeat', reasons: [note('Repeats line 3 and is left out.')] }),
          ],
          { onShow: () => undefined, restore: { checked: true, onCheckedChange: () => undefined } },
        ),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'And 1 more check' }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
