/* eslint-disable jsx-a11y/aria-role -- `role` on DomainCell is the API's domain role (own, competitor), not an ARIA role */
import { fireEvent, screen } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it, vi } from 'vitest';

import { DomainCell, DomainRoleBadge, splitHost } from './domain-cell';
import { HOSTILE_HOSTS, MARKER } from './xss-fixtures';
import { visibleUrlText } from './visible-text';
import { FAVICON_MIN_WIDTH, faviconUrl } from '@/lib/favicon';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const HREF = '/x?inspect=domain:hubspot.com' as Route;

/** jsdom loads no images, so a test says how wide the one it "loaded" is. */
function loaded(image: HTMLElement, width: number): void {
  Object.defineProperty(image, 'naturalWidth', { value: width, configurable: true });
  fireEvent.load(image);
}

const BIDI = /[\u{61C}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/u;
const icon = (container: HTMLElement): HTMLImageElement | null => container.querySelector('img');
const placeholder = (container: HTMLElement): Element | null =>
  container.querySelector('[data-slot="favicon-placeholder"]');
const popups = (): Element[] => [...document.querySelectorAll('[data-slot="tooltip"]')];

/** What a hostile value must never do (plan section 2.9). */
function expectNoInjection(container: HTMLElement): void {
  expect(container.querySelector('script')).toBeNull();
  for (const element of container.querySelectorAll('*')) {
    expect(element.getAttributeNames().filter((name) => name.startsWith('on'))).toEqual([]);
  }
  for (const image of container.querySelectorAll('img')) {
    expect(image.getAttribute('src')).toMatch(/^https:\/\/www\.google\.com\/s2\/favicons/);
    expect(image).toHaveAttribute('alt', '');
  }
  expect(Reflect.get(window, MARKER)).toBeUndefined();
}

describe('splitHost', () => {
  it('splits a subdomain from the registrable domain', () => {
    expect(splitHost('docs.hubspot.com', 'hubspot.com')).toEqual({ prefix: 'docs.', registrable: 'hubspot.com' });
  });

  it('has no prefix where the host is the registrable domain', () => {
    expect(splitHost('hubspot.com', 'hubspot.com')).toEqual({ prefix: '', registrable: 'hubspot.com' });
  });

  it('drops www the way displayDomain does, so it is no prefix', () => {
    expect(splitHost('www.hubspot.com', 'hubspot.com')).toEqual({ prefix: '', registrable: 'hubspot.com' });
  });

  it('keeps the whole host as text when it does not end in its registrable domain', () => {
    expect(splitHost('docs.a.com', 'b.com')).toEqual({ prefix: '', registrable: 'docs.a.com' });
  });
});

describe('DomainRoleBadge', () => {
  it.each([
    ['own', 'Own'],
    ['competitor', 'Competitor'],
    ['third_party', 'Third party'],
  ] as const)('says %s in words, in the neutral look', (role, word) => {
    renderWithProviders(<DomainRoleBadge role={role} />);
    const badge = screen.getByText(word);
    expect(badge).toHaveClass('bg-neutral-subtle', 'text-neutral-text');
    expect(badge.className).not.toMatch(/positive|negative|warning|info/);
  });
});

describe('DomainCell text', () => {
  it('shows the registrable domain as text with the prefix in the tertiary color', () => {
    const { container } = renderWithProviders(<DomainCell host="docs.hubspot.com" registrable="hubspot.com" />);
    expect(screen.getByText('docs.')).toHaveClass('text-foreground-tertiary');
    expect(screen.getByText('hubspot.com')).toHaveClass('text-foreground');
    // One word for a screen reader
    expect(container.querySelector('.sr-only')).toHaveTextContent('docs.hubspot.com');
  });

  it('marks the own domain with the primary text color and the word Own', () => {
    renderWithProviders(<DomainCell host="hubspot.com" registrable="hubspot.com" role="own" />);
    expect(screen.getByText('hubspot.com')).toHaveClass('text-primary-text');
    expect(screen.getByText('Own')).toHaveClass('bg-neutral-subtle');
  });

  it('shows a competitor badge and no badge for a third party', () => {
    const { unmount } = renderWithProviders(
      <DomainCell host="zapier.com" registrable="zapier.com" role="competitor" />,
    );
    expect(screen.getByText('Competitor')).toBeInTheDocument();
    unmount();
    renderWithProviders(<DomainCell host="g2.com" registrable="g2.com" role="third_party" />);
    expect(screen.queryByText('Third party')).toBeNull();
    expect(screen.queryByText('Own')).toBeNull();
  });

  it('names the redirect flag in words', () => {
    renderWithProviders(<DomainCell host="a.com" registrable="a.com" unresolvedRedirect />);
    expect(screen.getByRole('img', { name: 'Redirect not resolved' })).toBeInTheDocument();
  });

  it('shows the full host and the category in the tooltip', async () => {
    const { user } = renderWithProviders(
      <DomainCell host="docs.hubspot.com" registrable="hubspot.com" category="Review site" />,
    );
    await user.hover(screen.getByText('hubspot.com'));
    const [popup] = popups();
    expect(popup).toHaveTextContent('docs.hubspot.com');
    expect(popup).toHaveTextContent('Review site');
  });

  it('has the category as text a keyboard and screen reader user reaches, with no hover', () => {
    renderWithProviders(<DomainCell host="g2.com" registrable="g2.com" category="Review site" />);
    expect(screen.getByText('Review site')).toHaveClass('sr-only');
  });

  it('keeps the category out of the name of the link', () => {
    renderWithProviders(<DomainCell host="g2.com" registrable="g2.com" href={HREF} category="Review site" />);
    expect(screen.getByRole('link', { name: 'g2.com' })).toBeInTheDocument();
  });
});

describe('DomainCell favicon', () => {
  it('has no icon slot without a favicon prop', () => {
    const { container } = renderWithProviders(<DomainCell host="a.com" registrable="a.com" />);
    expect(icon(container)).toBeNull();
    expect(placeholder(container)).toBeNull();
    expect(container.querySelector('[data-slot="favicon"]')).toBeNull();
  });

  it('asks the favicon service with no referrer, lazily, and shows the square until the icon loads', () => {
    const { container } = renderWithProviders(
      <DomainCell host="hubspot.com" registrable="hubspot.com" favicon="show" />,
    );
    const image = icon(container);
    expect(image).toHaveAttribute('src', faviconUrl('hubspot.com'));
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(image).toHaveAttribute('decoding', 'async');
    expect(placeholder(container)).not.toBeNull();
    expect(container).toHaveTextContent('hubspot.com');
  });

  it('shows the icon once a real one has loaded', () => {
    const { container } = renderWithProviders(
      <DomainCell host="hubspot.com" registrable="hubspot.com" favicon="show" />,
    );
    const image = icon(container);
    if (image === null) throw new Error('no icon requested');
    loaded(image, 64);
    expect(placeholder(container)).toBeNull();
    expect(image).not.toHaveClass('opacity-0');
  });

  it('keeps the square where the service sent its 16 px globe', () => {
    const { container } = renderWithProviders(
      <DomainCell host="hubspot.com" registrable="hubspot.com" favicon="show" />,
    );
    const image = icon(container);
    if (image === null) throw new Error('no icon requested');
    loaded(image, 16);
    expect(placeholder(container)).not.toBeNull();
    expect(image).toHaveClass('opacity-0');
  });

  it('keeps the square when the icon fails, and the host stays', () => {
    const { container } = renderWithProviders(
      <DomainCell host="hubspot.com" registrable="hubspot.com" favicon="show" />,
    );
    const image = icon(container);
    if (image === null) throw new Error('no icon requested');
    fireEvent.error(image);
    expect(placeholder(container)).not.toBeNull();
    expect(container).toHaveTextContent('hubspot.com');
  });

  it('shows only the square when the setting is off, and requests nothing', () => {
    const { container } = renderWithProviders(
      <DomainCell host="hubspot.com" registrable="hubspot.com" favicon="hide" />,
    );
    expect(icon(container)).toBeNull();
    expect(placeholder(container)).not.toBeNull();
  });

  it.each([
    'localhost',
    'evil.com"><img src=x onerror=alert(1)>',
    '10.0.0.1',
    'https://user:secret@a.com/',
    'https://google.com@evil.example/',
    'ftp://a.com/',
  ])('never requests an icon for %s', (host) => {
    const { container } = renderWithProviders(<DomainCell host={host} registrable={host} favicon="show" />);
    expect(icon(container)).toBeNull();
    expect(placeholder(container)).not.toBeNull();
  });

  it.each([
    ['https://a.com/secret?token=1#frag', 'a.com'],
    ['http://www.a.com:8080/a/b', 'a.com'],
    ['A.COM/private?x=1', 'a.com'],
  ])('sends only the bare domain of %s to the service', (host, domain) => {
    const { container } = renderWithProviders(<DomainCell host={host} registrable="a.com" favicon="show" />);
    const src = icon(container)?.getAttribute('src');
    expect(src).toBe(faviconUrl(domain));
    for (const leak of ['secret', 'token', 'frag', 'private', '8080', '%2F', '%3A']) {
      expect(src).not.toContain(leak);
    }
  });

  it('starts over with a new host: the icon of the last one is not kept', () => {
    const { container, rerender } = renderWithProviders(
      <DomainCell host="hubspot.com" registrable="hubspot.com" favicon="show" />,
    );
    const first = icon(container);
    if (first === null) throw new Error('no icon requested');
    loaded(first, 64);
    expect(placeholder(container)).toBeNull();
    rerender(<DomainCell host="zapier.com" registrable="zapier.com" favicon="show" />);
    expect(icon(container)).toHaveAttribute('src', faviconUrl('zapier.com'));
    expect(icon(container)).toHaveClass('opacity-0');
    expect(placeholder(container)).not.toBeNull();
  });

  it('accepts an icon of exactly the minimum width, and refuses one a pixel under it', () => {
    const { container } = renderWithProviders(
      <DomainCell host="hubspot.com" registrable="hubspot.com" favicon="show" />,
    );
    const image = icon(container);
    if (image === null) throw new Error('no icon requested');
    loaded(image, FAVICON_MIN_WIDTH - 1);
    expect(placeholder(container)).not.toBeNull();
    loaded(image, FAVICON_MIN_WIDTH);
    expect(placeholder(container)).toBeNull();
    expect(image).not.toHaveClass('opacity-0');
  });
});

describe('DomainCell link', () => {
  it('is text without an href', () => {
    renderWithProviders(<DomainCell host="hubspot.com" registrable="hubspot.com" />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('in a grid is one link the table reaches with F2, and it does not open the row', async () => {
    const onRow = vi.fn();
    const { user } = renderWithProviders(
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a stand-in for the row
      <div onClick={onRow}>
        <DomainCell host="docs.hubspot.com" registrable="hubspot.com" href={HREF} />
      </div>,
    );
    const link = screen.getByRole('link', { name: 'docs.hubspot.com' });
    expect(link).toHaveAttribute('href', HREF);
    expect(link).toHaveAttribute('data-cell-control');
    expect(link).toHaveAttribute('tabindex', '-1');
    link.addEventListener('click', (event) => event.preventDefault());
    await user.click(link);
    expect(onRow).not.toHaveBeenCalled();
  });

  it('in a list is an ordinary tab stop, with a focus ring, and the row hears the click', async () => {
    const onRow = vi.fn();
    const { user } = renderWithProviders(
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a stand-in for the list
      <div onClick={onRow}>
        <DomainCell host="hubspot.com" registrable="hubspot.com" href={HREF} context="list" />
      </div>,
    );
    const link = screen.getByRole('link', { name: 'hubspot.com' });
    expect(link).not.toHaveAttribute('data-cell-control');
    expect(link).not.toHaveAttribute('tabindex', '-1');
    expect(link).toHaveClass('focus-visible:focus-ring');
    await user.tab();
    expect(link).toHaveFocus();
    link.addEventListener('click', (event) => event.preventDefault());
    await user.click(link);
    expect(onRow).toHaveBeenCalledTimes(1);
  });
});

describe('DomainCell hostile and long hosts', () => {
  it.each(HOSTILE_HOSTS)('renders $host as text only', async ({ host, registrable }) => {
    const { container, user } = renderWithProviders(
      <DomainCell host={host} registrable={registrable} favicon="show" href={HREF} category="<b>x</b>" />,
    );
    expectNoInjection(container);
    // The whole host is in the text, also where it does not end in its registrable domain
    expect(container.textContent).toContain(visibleUrlText(host));
    expect(container.querySelector('b')).toBeNull();
    await user.hover(screen.getByRole('link'));
    expect(popups()[0]).toHaveTextContent(visibleUrlText(host));
    expectNoInjection(container);
  });

  it('shows a host with a right-to-left override as its percent encoding, in the text and the tooltip', async () => {
    const host = 'docs.\u{202E}moc.live.com';
    const { container, user } = renderWithProviders(<DomainCell host={host} registrable="live.com" href={HREF} />);
    expect(container.textContent).not.toMatch(BIDI);
    expect(container.textContent).toContain('docs.%E2%80%AEmoc.live.com');
    await user.hover(screen.getByRole('link'));
    expect(popups()[0]?.textContent).not.toMatch(BIDI);
    expect(popups()[0]).toHaveTextContent('docs.%E2%80%AEmoc.live.com');
  });

  it('truncates the prefix before the registrable domain, which always stays visible', () => {
    const { host, registrable } = HOSTILE_HOSTS[0] ?? { host: '', registrable: '' };
    renderWithProviders(<DomainCell host={host} registrable={registrable} />);
    const visible = screen.getByText(registrable);
    expect(visible).toHaveClass('truncate');
    expect(visible).not.toHaveClass('shrink-100');
    expect(screen.getByText(host.slice(0, host.length - registrable.length))).toHaveClass('shrink-100', 'truncate');
  });

  it('reads a right-to-left host in its own order', () => {
    const host = '\u{645}\u{62B}\u{627}\u{644}.\u{627}\u{62E}\u{62A}\u{628}\u{627}\u{631}';
    const { container } = renderWithProviders(<DomainCell host={host} registrable="x.test" />);
    expect(container.querySelector('[dir="ltr"]')).not.toBeNull();
    expect(container.textContent).toContain(host);
  });
});

describe('DomainCell axe', () => {
  it.each(['light', 'dark'])('has no violation in the %s theme', async (theme) => {
    document.documentElement.className = theme === 'dark' ? 'dark' : '';
    try {
      const { container } = renderWithProviders(
        <ul>
          <li>
            <DomainCell
              host="docs.hubspot.com"
              registrable="hubspot.com"
              role="own"
              favicon="show"
              href={HREF}
              unresolvedRedirect
              context="list"
            />
          </li>
          <li>
            <DomainCell host="zapier.com" registrable="zapier.com" role="competitor" favicon="hide" />
          </li>
        </ul>,
      );
      expect(await axe(container)).toHaveNoViolations();
    } finally {
      document.documentElement.className = '';
    }
  });
});
