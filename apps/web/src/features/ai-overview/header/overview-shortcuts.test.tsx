import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PageShortcutsProvider, usePageShortcutEntries } from '@/components/app/shell/page-shortcuts';
import { SingleKeysContext } from '@/lib/a11y/use-shortcut';
import { overviewAs } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
vi.mock('../cards/registry', async () => (await import('@/test/fake-overview-cards')).fakeRegistryModule());

const NOW = new Date('2026-11-12T12:00:00Z');

let viewport: ReturnType<typeof stubViewport>;
beforeEach(() => {
  vi.setSystemTime(NOW);
  viewport = stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** What the shortcuts dialog would list from this page. */
function Listing(): ReactElement {
  const entries = usePageShortcutEntries();
  return <p data-testid="listing">{entries.map((entry) => `${entry.keys.join('')}:${entry.label}`).join('|')}</p>;
}

function page(singleKeys = true): ReactElement {
  return (
    <SingleKeysContext value={singleKeys}>
      <PageShortcutsProvider>
        <Listing />
        {overviewAs('admin')}
      </PageShortcutsProvider>
    </SingleKeysContext>
  );
}

const customize = (): Promise<HTMLElement> => screen.findByRole('button', { name: 'Customize' });
const press = (key: string, target: Element = document.body): void => {
  fireEvent.keyDown(target, { key });
};

describe('the shortcuts of the AI visibility page', () => {
  it('c turns Customize on and off, and e opens the Export menu', async () => {
    renderWithProviders(page());
    const button = await customize();
    await waitFor(() => {
      expect(button).toBeEnabled();
    });
    press('c');
    await waitFor(() => {
      expect(button).toHaveAttribute('aria-pressed', 'true');
    });
    press('c');
    await waitFor(() => {
      expect(button).toHaveAttribute('aria-pressed', 'false');
    });
    press('e');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Numbers (CSV)' })).toBeInTheDocument();
  });

  it('lists both keys in the shortcuts dialog with their words', async () => {
    renderWithProviders(page());
    await waitFor(() => {
      expect(screen.getByTestId('listing')).toHaveTextContent('c:Turn Customize on or off|e:Open the Export menu');
    });
  });

  it('leaves c out of the dialog and does nothing with it below 768 px, where there is no Customize', async () => {
    viewport.setWidth(30);
    renderWithProviders(page());
    await screen.findByRole('button', { name: 'Export' });
    expect(screen.getByTestId('listing')).toHaveTextContent('e:Open the Export menu');
    expect(screen.getByTestId('listing')).not.toHaveTextContent('Customize');
    press('c');
    expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument();
    press('e');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });

  it('does not fire while a field or the country combobox has focus', async () => {
    renderWithProviders(page());
    const button = await customize();
    await waitFor(() => {
      expect(button).toBeEnabled();
    });
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    press('c', input);
    press('e', input);
    const combobox = document.createElement('div');
    combobox.setAttribute('role', 'combobox');
    combobox.tabIndex = 0;
    document.body.append(combobox);
    combobox.focus();
    press('c', combobox);
    press('e', combobox);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    input.remove();
    combobox.remove();
  });

  it('does nothing when single key shortcuts are turned off', async () => {
    renderWithProviders(page(false));
    const button = await customize();
    await waitFor(() => {
      expect(button).toBeEnabled();
    });
    press('c');
    press('e');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
