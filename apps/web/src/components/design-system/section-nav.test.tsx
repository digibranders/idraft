import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SectionNav } from './section-nav';
import { renderWithProviders } from '@/test/render';

const navigation = vi.hoisted(() => ({ pathname: '/design-system/forms' }));
vi.mock('next/navigation', () => ({ usePathname: (): string => navigation.pathname }));

const SECTIONS = [
  { slug: 'tokens', title: 'Color tokens' },
  { slug: 'forms', title: 'Forms' },
  { slug: 'feedback', title: 'Feedback' },
];

describe('SectionNav', () => {
  beforeEach(() => {
    navigation.pathname = '/design-system/forms';
  });

  it('links every section to its page', () => {
    renderWithProviders(<SectionNav sections={SECTIONS} />);
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/design-system/tokens',
      '/design-system/forms',
      '/design-system/feedback',
    ]);
  });

  it('marks the section on screen as the current page, and only that one', () => {
    renderWithProviders(<SectionNav sections={SECTIONS} />);
    expect(screen.getByRole('link', { name: 'Forms' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Color tokens' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Feedback' })).not.toHaveAttribute('aria-current');
  });

  it('marks nothing on a path that is no section', () => {
    navigation.pathname = '/design-system';
    renderWithProviders(<SectionNav sections={SECTIONS} />);
    for (const link of screen.getAllByRole('link')) expect(link).not.toHaveAttribute('aria-current');
  });
});
