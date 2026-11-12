import { screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DomainChip, DomainChipList } from './domain-chip';
import { visibleUrlText } from './visible-text';
import { HOSTILE_HOSTS, MARKER } from './xss-fixtures';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const BIDI = /[\u{61C}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/u;
const popups = (): Element[] => [...document.querySelectorAll('[data-slot="tooltip"]')];

/** jsdom does not lay out: every value is measured as wider than its box, so its tooltip may open. */
function clipped(): void {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(120);
}

afterEach(() => {
  vi.restoreAllMocks();
});

const FIVE = ['hubspot.com', 'zapier.com', 'g2.com', 'capterra.com', 'reddit.com'].map((domain) => ({
  domain,
  href: `/x?inspect=domain:${domain}` as Route,
}));

describe('DomainChip', () => {
  it('is a static neutral chip without an href', () => {
    renderWithProviders(<DomainChip domain="hubspot.com" />);
    const chip = screen.getByText('hubspot.com').closest('span[class*="bg-neutral-subtle"]');
    expect(chip).toHaveClass('h-badge', 'rounded-sm', 'border-neutral-border', 'text-neutral-text', 'type-micro');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('is a link to the domain inspector with an href', () => {
    renderWithProviders(<DomainChip domain="hubspot.com" href={FIVE[0]?.href} />);
    expect(screen.getByRole('link', { name: 'hubspot.com' })).toHaveAttribute('href', FIVE[0]?.href);
  });

  it('keeps a long domain to one line and shows the whole name in a tooltip on hover, with no native title', async () => {
    clipped();
    const long = HOSTILE_HOSTS[0]?.host ?? '';
    const { container, user } = renderWithProviders(<DomainChip domain={long} />);
    const value = container.querySelector('[data-truncate]');
    expect(value).toHaveClass('truncate');
    expect(container.querySelector('[title]')).toBeNull();
    await user.hover(value ?? container);
    expect(popups()[0]).toHaveTextContent(long);
  });

  it('shows the whole name of a long linked domain when the link takes keyboard focus', async () => {
    clipped();
    const long = HOSTILE_HOSTS[0]?.host ?? '';
    const { user } = renderWithProviders(<DomainChip domain={long} href={FIVE[0]?.href} />);
    await user.tab();
    expect(screen.getByRole('link')).toHaveFocus();
    expect(popups()[0]).toHaveTextContent(long);
  });

  it.each(HOSTILE_HOSTS)('renders $host as text', ({ host }) => {
    const { container } = renderWithProviders(<DomainChip domain={host} href={FIVE[0]?.href} />);
    expect(container.querySelector('img, script')).toBeNull();
    expect(container.textContent).toBe(visibleUrlText(host));
    expect(Reflect.get(window, MARKER)).toBeUndefined();
  });

  it('shows a right-to-left override as its percent encoding, in the chip and in the tooltip', async () => {
    clipped();
    const domain = 'docs.\u{202E}moc.live.com';
    const { container, user } = renderWithProviders(<DomainChip domain={domain} />);
    expect(container.textContent).not.toMatch(BIDI);
    expect(container.textContent).toBe('docs.%E2%80%AEmoc.live.com');
    await user.hover(screen.getByText('docs.%E2%80%AEmoc.live.com'));
    expect(popups()[0]?.textContent).not.toMatch(BIDI);
    expect(popups()[0]).toHaveTextContent('docs.%E2%80%AEmoc.live.com');
  });
});

describe('DomainChipList', () => {
  it('names the list and shows three chips then +2 for five domains', () => {
    renderWithProviders(<DomainChipList label="Cited sources" domains={FIVE} />);
    const list = screen.getByRole('list', { name: 'Cited sources' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    expect(within(list).getByRole('link', { name: 'hubspot.com' })).toBeInTheDocument();
    expect(within(list).queryByRole('link', { name: 'capterra.com' })).toBeNull();
    expect(screen.getByRole('button', { name: '2 more cited domains' })).toHaveTextContent('+2');
  });

  it('has no overflow button for three or fewer', () => {
    renderWithProviders(<DomainChipList label="Cited sources" domains={FIVE.slice(0, 3)} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('honours max', () => {
    renderWithProviders(<DomainChipList label="Cited sources" domains={FIVE} max={4} />);
    expect(screen.getByRole('button', { name: '1 more cited domains' })).toHaveTextContent('+1');
  });

  it('formats a count over a thousand with the shared number format', () => {
    const many = Array.from({ length: 1503 }, (_, index) => ({ domain: `d${String(index)}.example.com` }));
    renderWithProviders(<DomainChipList label="Cited sources" domains={many} />);
    expect(screen.getByRole('button', { name: '1,500 more cited domains' })).toHaveTextContent('+1,500');
  });

  it('renders nothing for an empty list', () => {
    renderWithProviders(<DomainChipList label="Cited sources" domains={[]} />);
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens a popover titled by the label with the other domains as links, and Escape returns focus', async () => {
    const { user } = renderWithProviders(<DomainChipList label="Cited sources" domains={FIVE} />);
    const button = screen.getByRole('button', { name: '2 more cited domains' });
    await user.click(button);
    const popup = await screen.findByRole('dialog');
    expect(within(popup).getByText('Cited sources')).toBeInTheDocument();
    expect(within(popup).getByRole('link', { name: 'capterra.com' })).toHaveAttribute(
      'href',
      '/x?inspect=domain:capterra.com',
    );
    expect(within(popup).getByRole('link', { name: 'reddit.com' })).toBeInTheDocument();
    expect(within(popup).queryByRole('link', { name: 'hubspot.com' })).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('renders hostile domains as text, in the list and in the popover', async () => {
    const domains = HOSTILE_HOSTS.map(({ host }) => ({ domain: host }));
    const { container, user } = renderWithProviders(<DomainChipList label="Cited sources" domains={domains} max={1} />);
    await user.click(screen.getByRole('button', { name: `${String(HOSTILE_HOSTS.length - 1)} more cited domains` }));
    const popup = await screen.findByRole('dialog');
    for (const root of [container, popup]) {
      expect(root.querySelector('img, script')).toBeNull();
    }
    expect(popup).toHaveTextContent(HOSTILE_HOSTS[1]?.host ?? '');
    expect(Reflect.get(window, MARKER)).toBeUndefined();
  });

  it('shows a bidi control in the popover as its percent encoding too', async () => {
    const domains = [{ domain: 'a.com' }, { domain: 'docs.\u{202E}moc.live.com' }];
    const { user } = renderWithProviders(<DomainChipList label="Cited sources" domains={domains} max={1} />);
    await user.click(screen.getByRole('button', { name: '1 more cited domains' }));
    const popup = await screen.findByRole('dialog');
    expect(popup.textContent).not.toMatch(BIDI);
    expect(popup).toHaveTextContent('docs.%E2%80%AEmoc.live.com');
  });

  it.each(['light', 'dark'])('has no violation in the %s theme', async (theme) => {
    document.documentElement.className = theme === 'dark' ? 'dark' : '';
    try {
      const { container, user } = renderWithProviders(<DomainChipList label="Cited sources" domains={FIVE} />);
      expect(await axe(container)).toHaveNoViolations();
      await user.click(screen.getByRole('button', { name: '2 more cited domains' }));
      await screen.findByRole('dialog');
      expect(await axe(document.body)).toHaveNoViolations();
    } finally {
      document.documentElement.className = '';
    }
  });
});
