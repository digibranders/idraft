import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { QuotedPassage, type QuotedPassageItem } from './quoted-passage';
import { HOSTILE_TITLES, MARKER as WP08_MARKER } from '@/components/app/cells/xss-fixtures';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

afterEach(() => {
  Reflect.deleteProperty(window, WP08_MARKER);
});

const item = (index: number, overrides: Partial<QuotedPassageItem> = {}): QuotedPassageItem => ({
  index,
  host: `site${String(index)}.example`,
  url: `https://site${String(index)}.example/page`,
  quote: `Passage ${String(index)}`,
  ...overrides,
});

describe('QuotedPassage', () => {
  it('shows nothing when no citation has a passage', () => {
    const { container } = renderWithProviders(
      <QuotedPassage items={[item(1, { quote: null }), item(2, { quote: '' })]} />,
    );
    expect(container.querySelector('[data-slot="quoted-passage"], blockquote, ul')).toBeNull();
  });

  it('lists a box for each citation that has a passage, with its host beside it, and none for the others', async () => {
    const { container } = renderWithProviders(
      <QuotedPassage items={[item(1), item(2, { quote: null }), item(3, { quote: 'Third passage' })]} lang="en" />,
    );
    const list = screen.getByRole('list', { name: 'Passages the engine quoted from its sources' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('site1.example');
    expect(rows[0]).toHaveTextContent('“Passage 1”');
    expect(rows[1]).toHaveTextContent('site3.example');
    expect(rows[1]?.querySelector('blockquote')).toHaveAttribute('lang', 'en');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('opens the source only through an http or https address', () => {
    renderWithProviders(
      <QuotedPassage
        items={[item(1), item(2, { url: 'javascript:alert(1)' }), item(3, { url: 'https://user:pw@evil.example/' })]}
      />,
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'site1.example' })).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows a hostile passage as inert text', () => {
    for (const hostile of HOSTILE_TITLES) {
      const { container, unmount } = renderWithProviders(<QuotedPassage items={[item(1, { quote: hostile })]} />);
      expect(container.querySelectorAll('script, img, svg, iframe, style')).toHaveLength(0);
      expect(container.querySelector('blockquote')?.textContent).toContain(hostile);
      expect(Reflect.get(window, WP08_MARKER)).toBeUndefined();
      unmount();
    }
  });
});
