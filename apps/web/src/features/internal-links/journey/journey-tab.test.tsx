import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

const PAGE = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages/{url_id}');
const NEIGHBORS = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/neighbors');

beforeEach(() => {
  stubWideScreen();
});
afterEach(() => {
  restoreWideScreen();
  server.resetHandlers();
  server.events.removeAllListeners();
  document.documentElement.classList.remove('dark');
});

const canvas = (): Promise<HTMLElement> =>
  screen.findByRole('group', { name: 'Link journey canvas. The tree list shows the same journey as a table.' });
/** The address after each write of the tab, decoded. */
const addresses = (): {
  seen: string[];
  histories: string[];
  onUrlUpdate: (update: { queryString: string; options: { history: string } }) => void;
} => {
  const seen: string[] = [];
  const histories: string[] = [];
  return {
    seen,
    histories,
    onUrlUpdate: (update) => {
      seen.push(decodeURIComponent(update.queryString));
      histories.push(update.options.history);
    },
  };
};

describe('the Journey tab (spec 7.5)', () => {
  it('centers on the focus from the address: outlinks in step 1 out, in-links in step 1 in', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'tab=journey&focus=103' });
    const area = await canvas();
    expect(
      await within(area).findByRole('button', {
        name: /^\/services\/soc-as-a-service, T1 Money pages, .* focus page$/,
      }),
    ).toBeInTheDocument();
    expect(
      await within(area).findByRole('button', { name: /^\/pricing, T1 Money pages, .*linked as “See plans”/ }),
    ).toBeInTheDocument();
    expect(within(area).getByRole('heading', { name: 'Step 1 out' })).toBeInTheDocument();
    expect(within(area).getByRole('heading', { name: 'Step 1 in' })).toBeInTheDocument();
  });

  it('starts from the home page when the address names no focus', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'tab=journey' });
    const area = await canvas();
    expect(await within(area).findByRole('button', { name: /^\/, .* focus page$/ })).toBeInTheDocument();
  });

  it('writes an opened card to the address and shows its links in the next column', async () => {
    const { seen, onUrlUpdate } = addresses();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103',
      onUrlUpdate,
    });
    const area = await canvas();
    await user.click(await within(area).findByRole('button', { name: /^\/pricing, T1/ }));
    await waitFor(() => expect(seen.at(-1)).toContain('open=o:108'));
    expect(await within(area).findByRole('heading', { name: 'Step 2 out' })).toBeInTheDocument();
  });

  it('opens one journey at a time on a side: opening another first level card closes the first', async () => {
    const { seen, onUrlUpdate } = addresses();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103&open=o%3A108',
      onUrlUpdate,
    });
    const area = await canvas();
    await user.click(
      await within(area).findByRole('button', { name: /^\/services\/managed-detection-and-response, / }),
    );
    await waitFor(() => expect(seen.at(-1)).toContain('open=o:104'));
    expect(seen.at(-1)).not.toContain('o:108');
  });

  it('marks a page that links back to the focus with the back link marker once opened', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103&open=o%3A108',
    });
    const area = await canvas();
    expect(await within(area).findByRole('button', { name: 'Links back to 1 earlier page' })).toBeInTheDocument();
  });

  it('drops opened keys that no longer exist from the address', async () => {
    const { seen, onUrlUpdate } = addresses();
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103&open=o%3A108,o%3A999.998',
      onUrlUpdate,
    });
    await within(await canvas()).findByRole('heading', { name: 'Step 2 out' });
    await waitFor(() => expect(seen.at(-1)).not.toContain('999'));
    expect(seen.at(-1)).toContain('o:108');
  });

  it('refocuses from a card, pushing the new focus and clearing the opened cards', async () => {
    const { seen, histories, onUrlUpdate } = addresses();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103&open=o%3A108',
      onUrlUpdate,
    });
    const area = await canvas();
    // /contact is a first step link of the focus and also a link of the opened /pricing: the first is the first step
    const [card = area] = await within(area).findAllByRole('button', { name: /^\/contact, / });
    await user.click(
      within(card.closest('.group') as HTMLElement).getByRole('button', { name: 'Make /contact the focus' }),
    );
    await waitFor(() => expect(seen.at(-1)).toContain('focus=109'));
    expect(seen.at(-1)).not.toContain('open=');
    // A new focus is a history entry of its own: Back returns to the page before
    expect(histories.at(-1)).toBe('push');
  });

  it('opens the page inspector from a card and writes it to the address', async () => {
    const { seen, onUrlUpdate } = addresses();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103',
      onUrlUpdate,
    });
    const area = await canvas();
    const card = await within(area).findByRole('button', { name: /^\/pricing, / });
    await user.click(
      within(card.closest('.group') as HTMLElement).getByRole('button', { name: 'Details of /pricing' }),
    );
    await waitFor(() => expect(seen.at(-1)).toContain('inspect=page:108'));
  });

  it('closes the inspector when the person leaves the tab', async () => {
    const { seen, onUrlUpdate } = addresses();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103&inspect=page%3A108',
      onUrlUpdate,
    });
    await canvas();
    await user.click(screen.getByRole('tab', { name: 'Links' }));
    await waitFor(() => expect(seen.at(-1)).toContain('tab=links'));
    expect(seen.at(-1)).not.toContain('inspect=');
  });

  it('offers Set tier for the selected cards only to someone who can write', async () => {
    const editor = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103',
    });
    const area = await canvas();
    fireEvent.click(await within(area).findByRole('button', { name: /^\/pricing, / }), { shiftKey: true });
    const setTier = await screen.findByRole('button', { name: 'Set tier' });
    await editor.user.click(setTier);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    editor.unmount();

    renderWithProviders(internalLinksAs('viewer', EVENTUS_LINKS), { searchParams: 'tab=journey&focus=103' });
    fireEvent.click(await within(await canvas()).findByRole('button', { name: /^\/pricing, / }), { shiftKey: true });
    expect(await screen.findByRole('button', { name: 'Show their links' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set tier' })).toBeNull();
  });

  it('shows the same journey as a tree list with muted back link rows', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103&jv=tree',
    });
    const table = await screen.findByRole('table', { name: 'Link journey as a tree' });
    await user.click(await within(table).findByRole('button', { name: 'Expand /pricing' }));
    expect(await within(table).findByText('Links back to /services/soc-as-a-service (step 0)')).toBeInTheDocument();
  });

  it('opens and closes a tree row with the arrow keys and writes it to the address', async () => {
    const { seen, onUrlUpdate } = addresses();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103&jv=tree',
      onUrlUpdate,
    });
    const table = await screen.findByRole('table', { name: 'Link journey as a tree' });
    const toggle = await within(table).findByRole('button', { name: 'Expand /pricing' });
    toggle.focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(seen.at(-1)).toContain('topen='));
    expect(await within(table).findByRole('button', { name: 'Collapse /pricing' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('follows links in from the tree list', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103&jv=tree&dir=in',
    });
    const table = await screen.findByRole('table', { name: 'Link journey as a tree' });
    expect(await within(table).findByText('/services')).toBeInTheDocument();
  });

  it('switches between the canvas and the tree list through the address', async () => {
    const { seen, onUrlUpdate } = addresses();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103',
      onUrlUpdate,
    });
    await canvas();
    await user.click(screen.getByRole('radio', { name: 'Tree list' }));
    await waitFor(() => expect(seen.at(-1)).toContain('jv=tree'));
  });

  it('refocuses from the search of the focus picker', async () => {
    const { seen, histories, onUrlUpdate } = addresses();
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103',
      onUrlUpdate,
    });
    await canvas();
    await user.click(
      await screen.findByRole('combobox', { name: 'Focus page: /services/soc-as-a-service. Change it.' }),
    );
    await user.type(await screen.findByRole('combobox', { name: 'Search pages' }), 'pric');
    await user.click(await screen.findByRole('option', { name: /\/pricing/ }));
    await waitFor(() => expect(seen.at(-1)).toContain('focus=108'));
    expect(histories.at(-1)).toBe('push');
  });

  it('says so when no page matches the picker search', async () => {
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103',
    });
    await canvas();
    await user.click(
      await screen.findByRole('combobox', { name: 'Focus page: /services/soc-as-a-service. Change it.' }),
    );
    await user.type(await screen.findByRole('combobox', { name: 'Search pages' }), 'zzzz');
    expect(await screen.findByText(/No crawled page matches “zzzz”/)).toBeInTheDocument();
  });

  it('shows not found for a focus that is no page id, never the home page, and reads no page', async () => {
    const reads: string[] = [];
    server.events.on('request:start', ({ request }) => reads.push(new URL(request.url).pathname));
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=abc',
    });
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Link journey canvas/ })).toBeNull();
    expect(reads.some((path) => path.endsWith('/neighbors'))).toBe(false);
    // The picker's own list read is allowed; a read of one page (the focus) is not
    expect(reads.some((path) => /\/internal-links\/pages\/[^/]+$/.test(path))).toBe(false);
    expect(screen.getByRole('button', { name: 'Back to home' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(await canvas()).toBeInTheDocument();
  });

  it('says a valid focus that the crawl lacks is not in the crawl, with a way back', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'tab=journey&focus=99999' });
    expect(await screen.findByRole('heading', { name: 'This page is not in the latest crawl' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to home' })).toBeInTheDocument();
  });

  it('shows an empty state for a focus page with no links at all', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'tab=journey&focus=117' });
    expect(await screen.findByRole('heading', { name: 'This page has no links in this view' })).toBeInTheDocument();
    // The canvas stays: the focus card and its note are the page
    expect(await canvas()).toBeInTheDocument();
  });

  it('shows a failed page read with Try again, and reads again on the press', async () => {
    let calls = 0;
    server.use(
      http.get(PAGE, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ type: 'about:blank', title: 'Boom', status: 500 }, { status: 500 })
          : undefined;
      }),
    );
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103',
    });
    expect(await screen.findByText('The journey could not be loaded')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await canvas()).toBeInTheDocument();
  });

  it('shows a failed list inside the canvas with its own Try again', async () => {
    let calls = 0;
    server.use(
      http.get(NEIGHBORS, ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('direction') !== 'out') return undefined;
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ type: 'about:blank', title: 'Boom', status: 500 }, { status: 500 })
          : undefined;
      }),
    );
    const { user } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103',
    });
    const retry = await within(await canvas()).findByRole('button', { name: 'Try again' });
    await user.click(retry);
    expect(await within(await canvas()).findByRole('button', { name: /^\/pricing, / })).toBeInTheDocument();
  });

  it('never shows equity in any form: not in the text, the names or the labels', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103&open=o%3A108',
    });
    await within(await canvas()).findByRole('button', { name: 'Links back to 1 earlier page' });
    const everything = [
      document.body.textContent ?? '',
      ...[...document.querySelectorAll('[aria-label],[title]')].map(
        (element) => `${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''}`,
      ),
    ].join(' ');
    expect(everything.toLowerCase()).not.toContain('equity');
  });

  it('never shows equity in the tree list either', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: 'tab=journey&focus=103&jv=tree' });
    const table = await screen.findByRole('table', { name: 'Link journey as a tree' });
    await within(table).findByText('/pricing');
    expect(document.body.innerHTML.toLowerCase()).not.toContain('equity');
  });

  it.each(['light', 'dark'])('has no axe violations on the canvas in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103&open=o%3A108',
    });
    await within(await canvas()).findByRole('button', { name: 'Links back to 1 earlier page' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each(['light', 'dark'])('has no axe violations on the tree list in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: 'tab=journey&focus=103&jv=tree',
    });
    await within(await screen.findByRole('table', { name: 'Link journey as a tree' })).findByText('/pricing');
    expect(await axe(container)).toHaveNoViolations();
  });
});
