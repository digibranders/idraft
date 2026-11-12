import { screen, waitFor, within } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it, vi } from 'vitest';

import { COUNT_POPOVER_MAX, CountPopover, type CountPopoverDomain, type CountPopoverProps } from './count-popover';
import { visibleUrlText } from './visible-text';
import { HOSTILE_HOSTS, MARKER } from './xss-fixtures';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const NAMES = ['hubspot.com', 'zapier.com', 'g2.com', 'capterra.com', 'reddit.com', 'quora.com', 'forbes.com'];

const domain = (host: string, index: number, extra: Partial<CountPopoverDomain> = {}): CountPopoverDomain => ({
  id: host,
  host,
  registrable: host,
  countText: String(40 - index * 5),
  href: `/x?inspect=domain:${host}` as Route,
  ...extra,
});

const SEVEN = NAMES.map((host, index) => domain(host, index));
const NO_LINKS = NAMES.map((host, index) => domain(host, index, { href: undefined }));

const props = (extra: Partial<CountPopoverProps> = {}): CountPopoverProps => ({
  countText: '7',
  label: '7 domains cited instead, show them',
  title: 'Cited instead',
  domains: SEVEN,
  total: 7,
  ...extra,
});

const trigger = (): HTMLElement => screen.getByRole('button', { name: '7 domains cited instead, show them' });

describe('CountPopover trigger', () => {
  it('shows the count as a button named with the count and what it counts', () => {
    renderWithProviders(<CountPopover {...props()} />);
    expect(trigger()).toHaveTextContent('7');
    expect(trigger()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveClass('num', 'text-link', 'focus-visible:focus-ring');
  });

  it('opens with a click, with Enter and with Space', async () => {
    // Without links, focus lands on the popup, so one Escape closes it (with a link, see the focus tests)
    const { user } = renderWithProviders(<CountPopover {...props({ domains: NO_LINKS })} />);
    await user.click(trigger());
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    trigger().focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    trigger().focus();
    await user.keyboard(' ');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('is a target of at least 24 px (WCAG 2.5.8) whose content is centred', () => {
    renderWithProviders(<CountPopover {...props()} />);
    expect(trigger()).toHaveClass('inline-flex', 'min-h-6', 'min-w-6', 'items-center', 'justify-center');
  });

  it('is plain text, with no button, for a negative total', () => {
    renderWithProviders(<CountPopover {...props({ countText: '3', total: -1 })} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is plain text, with no button, for a real zero', () => {
    renderWithProviders(<CountPopover {...props({ countText: '0', total: 0, domains: [] })} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('0')).toHaveClass('num');
  });

  it('is plain text, with no button, for an unknown count, and does not show it as 0', () => {
    const { container } = renderWithProviders(<CountPopover {...props({ countText: 'n/a', total: null })} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(container).toHaveTextContent('n/a');
    expect(container).not.toHaveTextContent('0');
  });

  it('is plain text when there is a count but nothing to list', () => {
    renderWithProviders(<CountPopover {...props({ domains: [] })} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('in a grid is a cell control and its click does not reach the row', async () => {
    const row = vi.fn();
    const { user } = renderWithProviders(
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stands in for the grid row
      <div onClick={row}>
        <CountPopover {...props()} />
      </div>,
    );
    expect(trigger()).toHaveAttribute('data-cell-control');
    expect(trigger()).toHaveAttribute('tabindex', '-1');
    await user.click(trigger());
    const popup = await screen.findByRole('dialog');
    await user.click(within(popup).getByText('Cited instead'));
    expect(row).not.toHaveBeenCalled();
  });

  it('in a list is an ordinary tab stop', () => {
    renderWithProviders(<CountPopover {...props({ context: 'list' })} />);
    expect(trigger()).not.toHaveAttribute('data-cell-control');
    expect(trigger()).not.toHaveAttribute('tabindex', '-1');
  });
});

describe('CountPopover popup', () => {
  it('is named by its title and lists at most five domains, each with its own count', async () => {
    const { user } = renderWithProviders(<CountPopover {...props()} />);
    await user.click(trigger());
    const popup = await screen.findByRole('dialog', { name: 'Cited instead' });
    const items = within(popup).getAllByRole('listitem');
    expect(COUNT_POPOVER_MAX).toBe(5);
    expect(items).toHaveLength(5);
    NAMES.slice(0, 5).forEach((name, index) => {
      expect(items[index]).toHaveTextContent(name);
      expect(items[index]).toHaveTextContent(String(40 - index * 5));
    });
    expect(popup).not.toHaveTextContent('quora.com');
    expect(popup.querySelectorAll('[data-slot="domain-cell"]')).toHaveLength(5);
  });

  it('shows a share only after its count', async () => {
    const domains = SEVEN.map((entry, index) => ({ ...entry, shareText: `${String(30 - index)}.1%` }));
    const { user } = renderWithProviders(<CountPopover {...props({ domains })} />);
    await user.click(trigger());
    const popup = await screen.findByRole('dialog');
    const first = within(popup).getAllByRole('listitem')[0];
    const text = first?.textContent ?? '';
    expect(text.indexOf('40')).toBeGreaterThan(-1);
    expect(text.indexOf('30.1%')).toBeGreaterThan(text.indexOf('40'));
  });

  it('shows the count and the share of a single row together', async () => {
    const domains = [domain('a.com', 0, { shareText: '9.0%', countText: '4' })];
    const { user } = renderWithProviders(<CountPopover {...props({ domains, total: 1 })} />);
    await user.click(trigger());
    const item = within(await screen.findByRole('dialog')).getByRole('listitem');
    expect(item).toHaveTextContent('4');
    expect(item).toHaveTextContent('9.0%');
  });

  it('says "and 2 more" as text for a total of 7, and as a link with moreHref', async () => {
    const first = renderWithProviders(<CountPopover {...props()} />);
    await first.user.click(trigger());
    const popup = await screen.findByRole('dialog');
    expect(within(popup).getByText('and 2 more')).toBeInTheDocument();
    expect(within(popup).queryByRole('link', { name: 'and 2 more' })).toBeNull();
    first.unmount();

    const second = renderWithProviders(<CountPopover {...props({ moreHref: '/citations?view=domains' as Route })} />);
    await second.user.click(trigger());
    expect(await screen.findByRole('link', { name: 'and 2 more' })).toHaveAttribute('href', '/citations?view=domains');
  });

  it('formats the remainder with the shared number format', async () => {
    const { user } = renderWithProviders(<CountPopover {...props({ total: 1503, countText: '1,503' })} />);
    await user.click(screen.getByRole('button'));
    expect(await screen.findByText('and 1,498 more')).toBeInTheDocument();
  });

  it('has no "more" line when the total is what is listed', async () => {
    const { user } = renderWithProviders(<CountPopover {...props({ domains: SEVEN.slice(0, 5), total: 5 })} />);
    await user.click(screen.getByRole('button'));
    const popup = await screen.findByRole('dialog');
    expect(within(popup).getAllByRole('listitem')).toHaveLength(5);
    expect(popup).not.toHaveTextContent('more');
  });

  it('has no "more" line for a total below what is listed', async () => {
    const { user } = renderWithProviders(<CountPopover {...props({ domains: SEVEN.slice(0, 2), total: 1 })} />);
    await user.click(screen.getByRole('button'));
    expect(await screen.findByRole('dialog')).not.toHaveTextContent('more');
  });

  it('keeps the content bounded in width and the count column fixed', async () => {
    const { user } = renderWithProviders(<CountPopover {...props()} />);
    await user.click(trigger());
    const popup = await screen.findByRole('dialog');
    expect(popup).toHaveClass('min-w-popover-min');
    expect(popup.className).toMatch(/(^|\s)max-w-/);
    const item = within(popup).getAllByRole('listitem')[0];
    const count = within(item ?? popup).getByText('40');
    expect(count).toHaveClass('w-16', 'shrink-0', 'text-right');
    expect(count.parentElement).toHaveClass('shrink-0', 'num', 'type-meta');
    expect(item?.querySelector('[data-slot="domain-cell"]')?.parentElement).toHaveClass('min-w-0', 'flex-1');
  });

  it('reserves the share column on every row once one row has a share', async () => {
    const domains = [domain('a.com', 0, { shareText: '9.0%' }), domain('b.com', 1)];
    const { user } = renderWithProviders(<CountPopover {...props({ domains, total: 2 })} />);
    await user.click(trigger());
    const rows = within(await screen.findByRole('dialog')).getAllByRole('listitem');
    expect(rows[0]?.querySelectorAll('.w-14')).toHaveLength(1);
    expect(rows[1]?.querySelectorAll('.w-14')).toHaveLength(1);
  });

  it('draws the domains as links with the focus ring that are ordinary tab stops', async () => {
    const { user } = renderWithProviders(<CountPopover {...props()} />);
    await user.click(trigger());
    const link = await screen.findByRole('link', { name: 'hubspot.com' });
    expect(link).toHaveAttribute('href', '/x?inspect=domain:hubspot.com');
    expect(link).toHaveClass('focus-visible:focus-ring');
    expect(link).not.toHaveAttribute('data-cell-control');
  });
});

describe('CountPopover focus', () => {
  it('focuses the popup, not the first link, so no tooltip opens and one Escape returns to the trigger', async () => {
    const { user } = renderWithProviders(<CountPopover {...props()} />);
    await user.click(trigger());
    const popup = await screen.findByRole('dialog');
    await waitFor(() => expect(popup).toHaveFocus());
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('reaches the first link with the first Tab and steps through the links', async () => {
    const { user } = renderWithProviders(<CountPopover {...props()} />);
    await user.click(trigger());
    const popup = await screen.findByRole('dialog');
    await waitFor(() => expect(popup).toHaveFocus());
    const first = within(popup).getByRole('link', { name: 'hubspot.com' });
    await user.tab();
    expect(first).toHaveFocus();
    await user.tab();
    expect(within(popup).getByRole('link', { name: 'zapier.com' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(first).toHaveFocus();
  });

  it('puts focus on the popup itself when there is no link to reach, and Escape returns it', async () => {
    const { user } = renderWithProviders(<CountPopover {...props({ domains: NO_LINKS })} />);
    await user.click(trigger());
    const popup = await screen.findByRole('dialog');
    await waitFor(() => expect(popup).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('closes on a click outside', async () => {
    const { user } = renderWithProviders(
      <div>
        <button type="button">elsewhere</button>
        <CountPopover {...props()} />
      </div>,
    );
    await user.click(trigger());
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('CountPopover hostile input', () => {
  it('renders hostile hosts as text, in the popup', async () => {
    const domains = HOSTILE_HOSTS.map(({ host, registrable }, index) => ({
      id: String(index),
      host,
      registrable,
      countText: String(index + 1),
    }));
    const { user } = renderWithProviders(<CountPopover {...props({ domains, total: domains.length })} />);
    await user.click(trigger());
    const popup = await screen.findByRole('dialog');
    expect(popup.querySelector('img, script')).toBeNull();
    expect(popup.textContent).not.toMatch(/[\u{202A}-\u{202E}]/u);
    const hostile = HOSTILE_HOSTS[1];
    expect(hostile).toBeDefined();
    expect(popup).toHaveTextContent(visibleUrlText(hostile?.host ?? ''));
    expect(Reflect.get(window, MARKER)).toBeUndefined();
  });

  it('puts a hostile count text into text only', () => {
    const { container } = renderWithProviders(
      <CountPopover {...props({ countText: '<img src=x>', total: 0, domains: [] })} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('<img src=x>');
  });
});

describe('CountPopover accessibility', () => {
  it.each(['light', 'dark'])('has no violation closed and open in the %s theme', async (theme) => {
    document.documentElement.className = theme === 'dark' ? 'dark' : '';
    try {
      const domains = SEVEN.map((entry, index) => ({ ...entry, shareText: `${String(20 - index)}.0%` }));
      const { container, user } = renderWithProviders(<CountPopover {...props({ domains })} />);
      expect(await axe(container)).toHaveNoViolations();
      await user.click(trigger());
      await screen.findByRole('dialog');
      expect(await axe(document.body)).toHaveNoViolations();
    } finally {
      document.documentElement.className = '';
    }
  });
});
