import { screen, waitFor, within } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it } from 'vitest';

import { CitedDomains, NewBadge, TimesUsed } from './query-parts';
import { visibleUrlText } from '@/components/app/cells/visible-text';
import { HOSTILE_HOSTS, MARKER } from '@/components/app/cells/xss-fixtures';
import type { FanoutCitedDomain } from '@/lib/fanout';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

describe('TimesUsed', () => {
  it('reads In 6 of 12 ChatGPT answers from the count, the total and the engine label', () => {
    renderWithProviders(<TimesUsed count={6} total={12} engineLabel="ChatGPT" />);
    expect(screen.getByText('In 6 of 12 ChatGPT answers')).toBeInTheDocument();
  });

  it('reads In 1 of 1 ChatGPT answer in the singular', () => {
    renderWithProviders(<TimesUsed count={1} total={1} engineLabel="ChatGPT" />);
    expect(screen.getByText('In 1 of 1 ChatGPT answer')).toBeInTheDocument();
  });

  it('groups large counts', () => {
    renderWithProviders(<TimesUsed count={1204} total={4812} engineLabel="ChatGPT" />);
    expect(screen.getByText('In 1,204 of 4,812 ChatGPT answers')).toBeInTheDocument();
  });

  it('repeats the counts in a tip a keyboard reaches', async () => {
    const { user } = renderWithProviders(<TimesUsed count={6} total={12} engineLabel="ChatGPT" />);
    await user.tab();
    expect(screen.getByText('In 6 of 12 ChatGPT answers')).toHaveFocus();
    const tip = '6 answers issued this query, of 12 valid answers on ChatGPT in this window.';
    await waitFor(() => expect(document.querySelector('[data-slot="tooltip"]')).toHaveTextContent(tip));
  });

  it('reads n/a for a total of 0, never In 0 of 0, and says why in its tip', async () => {
    const { container, user } = renderWithProviders(<TimesUsed count={0} total={0} engineLabel="ChatGPT" />);
    expect(container).toHaveTextContent('n/a');
    expect(container).not.toHaveTextContent(/In 0 of 0/);
    await user.tab();
    await waitFor(() =>
      expect(document.querySelector('[data-slot="tooltip"]')).toHaveTextContent(
        'No valid ChatGPT answer in this window.',
      ),
    );
  });
});

describe('NewBadge', () => {
  it('is an outline badge with no tone', () => {
    renderWithProviders(<NewBadge firstSeen="2026-11-03T08:00:00Z" days={28} timeZone="UTC" />);
    const badge = screen.getByText('New in window');
    expect(badge).toHaveAttribute('data-slot', 'badge');
    // The neutral outline is the only look: no positive, negative, warning or info token
    expect(badge).toHaveClass('border-border', 'text-foreground-secondary');
    expect(badge.className).not.toMatch(/(positive|negative|warning|info|primary)/);
  });

  it('carries the first seen date and the days in its tip', async () => {
    renderWithProviders(<NewBadge firstSeen="2026-11-03T08:00:00Z" days={28} timeZone="UTC" />);
    screen.getByText('New in window').focus();
    await waitFor(() =>
      expect(document.querySelector('[data-slot="tooltip"]')).toHaveTextContent(
        /^First seen Nov 3(, 2026)?\. Not issued in the 28 days before this window\.$/,
      ),
    );
  });

  it('is a tab stop, so a keyboard reaches the tip', async () => {
    const { user } = renderWithProviders(<NewBadge firstSeen="2026-11-03T08:00:00Z" days={7} timeZone="UTC" />);
    await user.tab();
    expect(screen.getByText('New in window')).toHaveFocus();
  });
});

const cited = (registrable: string, units: number, over: Partial<FanoutCitedDomain> = {}): FanoutCitedDomain => ({
  registrable_domain: registrable,
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: units,
  ...over,
});

const FIVE: readonly FanoutCitedDomain[] = [
  cited('hubspot.com', 9, { domain_role: 'competitor', role_entity_id: 'entity-1' }),
  cited('zapier.com', 7),
  cited('g2.com', 5),
  cited('fynix.io', 3, { domain_role: 'own', role_entity_id: 'entity-2' }),
  cited('reddit.com', 1),
];

const trigger = (count: number): HTMLElement =>
  screen.getByRole('button', {
    name: `${String(count)} ${count === 1 ? 'domain' : 'domains'} cited in the same answers, show them`,
  });

describe('CitedDomains', () => {
  it('is a count that opens the popover, named with the count', async () => {
    const { user } = renderWithProviders(<CitedDomains domains={FIVE} context="list" />);
    expect(trigger(5)).toHaveTextContent('5');
    await user.click(trigger(5));
    const popup = await screen.findByRole('dialog', { name: 'Cited in the same answers' });
    expect(popup).toBeInTheDocument();
  });

  it('lists the domains with their units and the role badge of an own and a competitor domain', async () => {
    const { user } = renderWithProviders(<CitedDomains domains={FIVE} context="list" />);
    await user.click(trigger(5));
    const popup = await screen.findByRole('dialog');
    expect(within(popup).getAllByRole('listitem')).toHaveLength(5);
    expect(popup).toHaveTextContent('hubspot.com');
    expect(popup).toHaveTextContent('9 units');
    expect(popup).toHaveTextContent('1 unit');
    expect(within(popup).getByText('Own')).toBeInTheDocument();
    expect(within(popup).getByText('Competitor')).toBeInTheDocument();
    expect(within(popup).queryByText('Third party')).toBeNull();
  });

  it('is plain words for no cited domain and opens nothing', () => {
    renderWithProviders(<CitedDomains domains={[]} context="list" />);
    expect(screen.getByText('None cited')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is a plain domain name with no link on the prompt page', async () => {
    const { user } = renderWithProviders(<CitedDomains domains={FIVE} context="list" />);
    await user.click(trigger(5));
    const popup = await screen.findByRole('dialog');
    expect(within(popup).queryAllByRole('link')).toHaveLength(0);
  });

  it('links each domain to its inspector when hrefOf is given', async () => {
    const { user } = renderWithProviders(
      <CitedDomains
        domains={FIVE}
        context="list"
        hrefOf={(registrable) => `/ai/citations?inspect=domain:${registrable}` as Route}
      />,
    );
    await user.click(trigger(5));
    const popup = await screen.findByRole('dialog');
    const link = within(popup).getByRole('link', { name: 'zapier.com' });
    expect(link).toHaveAttribute('href', '/ai/citations?inspect=domain:zapier.com');
  });

  it('renders a domain name that looks like markup as text', async () => {
    const domains = HOSTILE_HOSTS.map(({ host }, index) => cited(host, index + 1));
    const { user } = renderWithProviders(<CitedDomains domains={domains.slice(0, 5)} context="list" />);
    await user.click(trigger(5));
    const popup = await screen.findByRole('dialog');
    expect(popup.querySelector('img, script')).toBeNull();
    expect(popup.textContent).not.toMatch(/[\u{202A}-\u{202E}]/u);
    expect(popup).toHaveTextContent(visibleUrlText(HOSTILE_HOSTS[1]?.host ?? ''));
    expect(Reflect.get(window, MARKER)).toBeUndefined();
  });

  it('is axe clean closed and open', async () => {
    const { container, user } = renderWithProviders(<CitedDomains domains={FIVE} context="list" />);
    expect(await axe(container)).toHaveNoViolations();
    await user.click(trigger(5));
    await screen.findByRole('dialog');
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
