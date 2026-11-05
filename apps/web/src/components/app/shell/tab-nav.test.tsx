import { screen, waitFor } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it } from 'vitest';

import { TabNav, type TabNavItem } from './tab-nav';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const items: readonly TabNavItem[] = [
  { href: '/acme/site/integrations/google' as Route, label: 'Google', current: true },
  { href: '/acme/site/integrations/bing' as Route, label: 'Bing', current: false, unavailable: 'Not available yet' },
];

describe('TabNav', () => {
  it('is a navigation landmark of links, and the current one says so', () => {
    renderWithProviders(<TabNav label="Data sources" items={items} />);
    const nav = screen.getByRole('navigation', { name: 'Data sources' });
    expect(nav).toBeInTheDocument();
    const current = screen.getByRole('link', { name: 'Google' });
    expect(current).toHaveAttribute('href', '/acme/site/integrations/google');
    expect(current).toHaveAttribute('aria-current', 'page');
  });

  it('lists a source that is not built as a disabled link that can be focused and says why', async () => {
    const { user } = renderWithProviders(<TabNav label="Data sources" items={items} />);
    const bing = screen.getByRole('link', { name: 'Bing' });
    expect(bing).toHaveAttribute('aria-disabled', 'true');
    expect(bing).not.toHaveAttribute('href');
    await user.tab();
    await user.tab();
    expect(bing).toHaveFocus();
    await waitFor(() => expect(document.querySelector('[data-slot="tooltip"]')).toHaveTextContent('Not available yet'));
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<TabNav label="Data sources" items={items} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
