import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { axe } from '@/test/axe';
import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => stubWideScreen());
afterEach(() => {
  restoreWideScreen();
  document.documentElement.classList.remove('dark');
});

/** Page 108 of the fixture crawl is /pricing: tiered by hand. */
const OPEN = { searchParams: 'inspect=page:108' };
const panelOf = (name: string): Promise<HTMLElement> => screen.findByRole('complementary', { name });

describe('the page inspector (spec 7.4)', () => {
  it('shows the tier with its source, the strip, the linking pages and the flags, and no equity', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), OPEN);
    const panel = await panelOf('/pricing');
    expect(await within(panel).findByText(/^Manual, set by .+ on /)).toBeInTheDocument();
    expect(within(panel).getByRole('group', { name: 'Page summary' })).toHaveTextContent(/Depth\s*1/);
    expect(await within(panel).findByRole('heading', { name: /^Linking pages \(\d+\)$/ })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: /^Outlinks \(\d+\)$/ })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Open in journey' })).toBeInTheDocument();
    expect(panel.textContent ?? '').not.toMatch(/equity/i);
  });

  it('lists the linking pages from the neighbors read', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), OPEN);
    const panel = await panelOf('/pricing');
    const heading = await within(panel).findByRole('heading', { name: /^Linking pages \(\d+\)$/ });
    const list = heading.closest('section');
    expect(list).not.toBeNull();
    expect(await within(list as HTMLElement).findAllByRole('button', { name: /^\// })).not.toHaveLength(0);
  });

  it('resets a manual tier to its rule', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), OPEN);
    const panel = await panelOf('/pricing');
    await user.click(await within(panel).findByRole('button', { name: 'Reset to rule' }));
    expect(
      (await screen.findAllByText(/went back to the tier their rule gives|No pages changed/)).length,
    ).toBeGreaterThan(0);
  });

  it('sets the tier from the select', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), OPEN);
    const panel = await panelOf('/pricing');
    await user.click(await within(panel).findByRole('combobox', { name: 'Tier of this page' }));
    await user.click(await screen.findByRole('option', { name: /^T2/ }));
    expect((await screen.findAllByText('Tier set')).length).toBeGreaterThan(0);
  });

  it('is read only for a viewer', async () => {
    renderWithProviders(internalLinksAs('viewer', EVENTUS_LINKS), OPEN);
    const panel = await panelOf('/pricing');
    await within(panel).findByText(/^Manual, set by/);
    expect(within(panel).getByRole('combobox', { name: 'Tier of this page' })).toBeDisabled();
    expect(within(panel).queryByRole('button', { name: 'Reset to rule' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Add tag' })).toBeNull();
  });

  it('opens the journey on the page', async () => {
    const onUrlUpdate = vi.fn();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { ...OPEN, onUrlUpdate });
    const panel = await panelOf('/pricing');
    await user.click(await within(panel).findByRole('button', { name: 'Open in journey' }));
    await waitFor(() => {
      const last = onUrlUpdate.mock.calls.at(-1)?.[0] as { queryString: string } | undefined;
      expect(last?.queryString).toContain('tab=journey');
      expect(last?.queryString).toContain('focus=108');
    });
  });

  it('steps to the next page in the order of the Pages tab', async () => {
    const onUrlUpdate = vi.fn();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { ...OPEN, onUrlUpdate });
    const panel = await panelOf('/pricing');
    await waitFor(() => expect(within(panel).getByText(/^\d+ of \d+$/)).toBeInTheDocument());
    await user.click(within(panel).getByRole('button', { name: 'Next page' }));
    await waitFor(() => {
      const last = onUrlUpdate.mock.calls.at(-1)?.[0] as { queryString: string } | undefined;
      expect(last?.queryString).toMatch(/inspect=page:(?!108\b)\d+/);
    });
  });

  it('says a hand-edited id is not a page, without throwing', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'inspect=page:abc' });
    const panel = await panelOf('Page');
    expect(await within(panel).findByText('Page not found')).toBeInTheDocument();
  });

  it('says a page that is not in the crawl is not in it', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'inspect=page:999999' });
    const panel = await panelOf('Page');
    expect(await within(panel).findByText('This page is not in the latest crawl.')).toBeInTheDocument();
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), OPEN);
    const panel = await panelOf('/pricing');
    await within(panel).findByText(/^Manual, set by/);
    await within(panel).findAllByRole('button', { name: /^\// });
    expect(await axe(container)).toHaveNoViolations();
  });
});
