import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { QuoteBox } from './quote-box';
import { HOSTILE_TITLES, MARKER as WP08_MARKER } from '@/components/app/cells/xss-fixtures';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

afterEach(() => {
  Reflect.deleteProperty(window, WP08_MARKER);
});

describe('QuoteBox', () => {
  it('is a blockquote with the passage in typographic quotes and the language of the content', async () => {
    const { container } = renderWithProviders(<QuoteBox text="Der Preis ist fair." lang="de" />);
    const quote = container.querySelector('blockquote');
    expect(quote).not.toBeNull();
    expect(quote).toHaveAttribute('lang', 'de');
    expect(quote).toHaveTextContent('“Der Preis ist fair.”');
    expect(quote).toHaveClass('bg-surface-subtle', 'border', 'border-border-subtle', 'rounded-md', 'p-3');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('names its source in a cite line below the passage, as text when it has no address', () => {
    const { container } = renderWithProviders(<QuoteBox text="A passage." source={{ label: 'news.example' }} />);
    const cite = container.querySelector('cite');
    expect(cite).toHaveTextContent('news.example');
    expect(cite).toHaveClass('type-meta');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('links its source only for an http or https address, in a new tab that cannot reach back', () => {
    renderWithProviders(
      <QuoteBox text="A passage." source={{ label: 'news.example', href: 'https://news.example/a' }} />,
    );
    const link = screen.getByRole('link', { name: 'news.example' });
    expect(link).toHaveAttribute('href', 'https://news.example/a');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows a source with a hostile address as text, never as a link', () => {
    renderWithProviders(<QuoteBox text="A passage." source={{ label: 'bad.example', href: 'javascript:alert(1)' }} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('bad.example')).toBeInTheDocument();
  });

  it('keeps every hostile text as inert text: no element, no handler, nothing run', () => {
    for (const hostile of HOSTILE_TITLES) {
      const { container, unmount } = renderWithProviders(<QuoteBox text={hostile} source={{ label: hostile }} />);
      expect(container.querySelectorAll('script, img, svg, iframe, style, a')).toHaveLength(0);
      expect(container.querySelector('blockquote')?.textContent).toContain(hostile);
      for (const element of container.querySelectorAll('*')) {
        expect(element.getAttributeNames().filter((name) => name.toLowerCase().startsWith('on'))).toEqual([]);
      }
      expect(Reflect.get(window, WP08_MARKER)).toBeUndefined();
      unmount();
    }
  });

  it('keeps entity-encoded markup as the characters it was sent as', () => {
    // An expression, not an attribute string: JSX would decode the entities of an attribute itself
    const sent = '&lt;script&gt;alert(1)&lt;/script&gt; &amp; more';
    const { container } = renderWithProviders(<QuoteBox text={sent} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('blockquote')).toHaveTextContent(sent);
  });

  it('wraps a long unbroken passage and keeps its line breaks, with no clamp', () => {
    const { container } = renderWithProviders(<QuoteBox text={'x'.repeat(2000)} />);
    const quote = container.querySelector('blockquote');
    expect(quote).toHaveClass('wrap-anywhere', 'whitespace-pre-wrap');
    expect(quote?.className).not.toMatch(/line-clamp|truncate/);
  });
});
