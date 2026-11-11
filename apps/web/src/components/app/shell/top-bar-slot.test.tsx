import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TopBar } from './top-bar';
import { TopBarPortal, TopBarSlotProvider } from './top-bar-slot';
import { renderWithProviders } from '@/test/render';

describe('The top bar slot', () => {
  it('draws a page control in the top bar, before the fixed controls', () => {
    renderWithProviders(
      <TopBarSlotProvider>
        <TopBar breadcrumb={<span>Crumb</span>} controls={<button type="button">Help</button>} navigation={null} />
        <main>
          <p>Page</p>
          <TopBarPortal>
            <button type="button">Country</button>
          </TopBarPortal>
        </main>
      </TopBarSlotProvider>,
    );
    const bar = screen.getByRole('banner');
    const country = within(bar).getByRole('button', { name: 'Country' });
    const help = within(bar).getByRole('button', { name: 'Help' });
    expect(country.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(screen.getByRole('main')).queryByRole('button', { name: 'Country' })).toBeNull();
  });

  it('takes no room while nothing is drawn in it', () => {
    renderWithProviders(
      <TopBarSlotProvider>
        <TopBar breadcrumb={<span>Crumb</span>} controls={null} navigation={null} />
      </TopBarSlotProvider>,
    );
    const slot = screen.getByRole('banner').querySelector('div > div');
    expect(slot).toBeEmptyDOMElement();
    expect(slot).toHaveClass('empty:hidden');
  });

  it('draws nothing, and does not throw, where no top bar is above the page', () => {
    renderWithProviders(
      <main>
        <TopBarPortal>
          <button type="button">Country</button>
        </TopBarPortal>
      </main>,
    );
    expect(screen.queryByRole('button', { name: 'Country' })).toBeNull();
  });
});
