import { render, screen } from '@testing-library/react';
import { useMemo, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { PageShortcutsProvider, usePageShortcutEntries, usePageShortcuts } from './page-shortcuts';
import type { ShortcutEntry } from './keyboard-shortcuts-dialog';

function Page({ id, label }: { id: string; label: string }): null {
  const entries = useMemo((): ShortcutEntry[] => [{ id, label, keys: [id] }], [id, label]);
  usePageShortcuts(entries);
  return null;
}

function Listing(): ReactElement {
  const entries = usePageShortcutEntries();
  return <p data-testid="listing">{entries.map((entry) => `${entry.keys.join('')}:${entry.label}`).join('|')}</p>;
}

describe('the shortcuts a page adds to the dialog', () => {
  it('lists what each mounted page registered, in the order they registered', () => {
    render(
      <PageShortcutsProvider>
        <Page id="c" label="Customize" />
        <Page id="e" label="Export" />
        <Listing />
      </PageShortcutsProvider>,
    );
    expect(screen.getByTestId('listing')).toHaveTextContent('c:Customize|e:Export');
  });

  it('takes a page back out when it unmounts and follows a change of its words', () => {
    const tree = (pages: ReactElement[]): ReactElement => (
      <PageShortcutsProvider>
        {pages}
        <Listing />
      </PageShortcutsProvider>
    );
    const view = render(tree([<Page key="c" id="c" label="Customize" />, <Page key="e" id="e" label="Export" />]));
    view.rerender(tree([<Page key="e" id="e" label="Export the numbers" />]));
    expect(screen.getByTestId('listing')).toHaveTextContent('e:Export the numbers');
    expect(screen.getByTestId('listing')).not.toHaveTextContent('Customize');
  });

  it('does nothing outside a provider, so a page renders on its own', () => {
    render(
      <>
        <Page id="c" label="Customize" />
        <Listing />
      </>,
    );
    expect(screen.getByTestId('listing')).toBeEmptyDOMElement();
  });
});
