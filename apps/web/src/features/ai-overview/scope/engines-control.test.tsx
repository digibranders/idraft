import { screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { EnginesControl, type EngineChoice } from './engines-control';
import { useOverviewScope } from './use-overview-scope';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const ON: readonly EngineChoice[] = [
  { code: 'chatgpt_web', label: 'ChatGPT' },
  { code: 'gemini_web', label: 'Gemini' },
  { code: 'google_ai_mode', label: 'AI Mode' },
];

/** The control as the page wires it: the engines of the scope from the URL, a choice written back. */
function Wired({ engines = ON }: { engines?: readonly EngineChoice[] }): ReactElement {
  const { scope, setScope } = useOverviewScope({ project: { timeZone: 'UTC' } });
  return <EnginesControl engines={engines} selected={scope.engines} onChange={(next) => setScope({ engines: next })} />;
}

const open = async (user: ReturnType<typeof renderWithProviders>['user'], name: string): Promise<HTMLElement> => {
  await user.click(await screen.findByRole('button', { name }));
  return screen.findByRole('dialog', { name: 'Engines' });
};

describe('EnginesControl', () => {
  it('lists the enabled engines with logos, and shows the count on the trigger', async () => {
    const { user } = renderWithProviders(<Wired />, { searchParams: '?engine=chatgpt_web,gemini_web' });
    const trigger = await screen.findByRole('button', { name: 'Engines: 2 of 3' });
    expect(within(trigger).getByText('2')).toBeInTheDocument();
    const dialog = await open(user, 'Engines: 2 of 3');
    expect(
      within(dialog)
        .getAllByRole('checkbox')
        .map((box) => box.getAttribute('aria-checked')),
    ).toEqual(['true', 'true', 'false']);
    expect(within(dialog).getByRole('checkbox', { name: 'ChatGPT' })).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'AI Mode' })).toBeInTheDocument();
    // The vendor mark sits left of each name (decorative: the name is the label)
    expect(dialog.querySelectorAll('img[alt=""]').length).toBeGreaterThanOrEqual(2);
  });

  it('shows every engine as chosen when the URL names none', async () => {
    const { user } = renderWithProviders(<Wired />);
    const dialog = await open(user, 'Engines: 3 of 3');
    expect(
      within(dialog)
        .getAllByRole('checkbox')
        .every((box) => box.getAttribute('aria-checked') === 'true'),
    ).toBe(true);
  });

  it('lists only the engines it is given, so an engine that is off is not there', async () => {
    const { user } = renderWithProviders(<Wired engines={ON.slice(0, 2)} />);
    const dialog = await open(user, 'Engines: 2 of 2');
    expect(within(dialog).queryByRole('checkbox', { name: 'AI Mode' })).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(2);
  });

  it('writes the engines chosen, in the project order, and clears the key when all are chosen again', async () => {
    const updates: string[] = [];
    const { user } = renderWithProviders(<Wired />, { onUrlUpdate: (event) => updates.push(event.queryString) });
    const dialog = await open(user, 'Engines: 3 of 3');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Gemini' }));
    await waitFor(() => {
      expect(updates.at(-1)).toBe('?engine=chatgpt_web,google_ai_mode');
    });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Gemini' }));
    await waitFor(() => {
      expect(updates.at(-1)).toBe('');
    });
    expect(screen.getByRole('button', { name: 'Engines: 3 of 3' })).toBeInTheDocument();
  });

  it('cannot turn off the last engine and says why', async () => {
    const { user } = renderWithProviders(<Wired />, { searchParams: '?engine=gemini_web' });
    const dialog = await open(user, 'Engines: 1 of 3');
    const last = within(dialog).getByRole('checkbox', { name: 'Gemini' });
    expect(last).toHaveAttribute('aria-disabled', 'true');
    expect(last).toHaveAccessibleDescription('At least one engine stays on');
    await user.click(last);
    expect(last).toHaveAttribute('aria-checked', 'true');
    // The others can still be turned on
    expect(within(dialog).getByRole('checkbox', { name: 'ChatGPT' })).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('returns focus to its trigger on Escape', async () => {
    const { user } = renderWithProviders(<Wired />);
    const dialog = await open(user, 'Engines: 3 of 3');
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Engines: 3 of 3' })).toHaveFocus();
  });

  it('has no accessibility violations open', async () => {
    const { user, container } = renderWithProviders(<Wired />);
    await open(user, 'Engines: 3 of 3');
    expect(await axe(container)).toHaveNoViolations();
  });
});
