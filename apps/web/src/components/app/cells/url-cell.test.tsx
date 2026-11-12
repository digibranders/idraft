import { screen } from '@testing-library/react';
import type { Route } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { URLCell, type URLCellProps } from './url-cell';
import { HOSTILE_TITLES, HOSTILE_URLS, MARKER } from './xss-fixtures';
import { copyText } from '@/lib/dom/clipboard';
import { faviconUrl } from '@/lib/favicon';
import { webHref } from '@/lib/format';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

vi.mock('@/lib/dom/clipboard', () => ({ copyText: vi.fn<(text: string) => Promise<boolean>>() }));

const HREF = '/x?inspect=source:abc' as Route;
const URL_TEXT = 'https://www.hubspot.com/pricing?utm_source=x';

function cell(props: Partial<URLCellProps> = {}): URLCellProps {
  return { url: URL_TEXT, hostDisplay: 'show', label: 'cited page', ...props };
}

const popups = (): Element[] => [...document.querySelectorAll('[data-slot="tooltip"]')];
const line = (container: HTMLElement): Element | null => container.querySelector('[data-slot="url-cell"] [dir="ltr"]');

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
  for (const anchor of container.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href') ?? '';
    expect(webHref(href) !== null || /^[/?#]/.test(href)).toBe(true);
  }
  expect(Reflect.get(window, MARKER)).toBeUndefined();
}

beforeEach(() => {
  vi.mocked(copyText).mockReset();
  vi.mocked(copyText).mockResolvedValue(true);
});

describe('URLCell valid address', () => {
  it('shows the host in the tertiary color and the path, without the tracking parameter', () => {
    const { container } = renderWithProviders(<URLCell {...cell()} />);
    expect(screen.getByText('hubspot.com')).toHaveClass('text-foreground-tertiary');
    expect(container).toHaveTextContent('/pricing');
    expect(container).not.toHaveTextContent('utm_source');
  });

  it('hides the host in a single-domain table', () => {
    renderWithProviders(<URLCell {...cell({ hostDisplay: 'hide' })} />);
    expect(screen.queryByText('hubspot.com')).toBeNull();
    expect(screen.getByText('/pricing')).toBeInTheDocument();
  });

  it('reads left to right in every locale', () => {
    const { container } = renderWithProviders(<URLCell {...cell()} />);
    expect(line(container)).toHaveAttribute('dir', 'ltr');
  });

  it('keeps the last 16 characters of a long path in view and gives a screen reader the whole path', () => {
    const url = 'https://example.com/a/very/long/path/segment/that/goes/on/and/on/how-to-choose-a-crm-for-startups';
    const { container } = renderWithProviders(<URLCell {...cell({ url })} />);
    const tail = 'crm-for-startups';
    expect(screen.getByText(tail)).toHaveClass('shrink-0');
    expect(container.querySelector('.sr-only')).toHaveTextContent(
      '/a/very/long/path/segment/that/goes/on/and/on/how-to-choose-a-crm-for-startups',
    );
    expect(container.querySelector('[data-truncate]')).toHaveClass('truncate');
  });

  it('shows the whole display URL in the tooltip', async () => {
    const { user } = renderWithProviders(<URLCell {...cell()} />);
    await user.hover(screen.getByText('hubspot.com'));
    expect(popups()[0]).toHaveTextContent('hubspot.com/pricing');
  });

  it('shows the site icon beside the host where the table is domain-first', () => {
    const { container } = renderWithProviders(<URLCell {...cell({ favicon: 'show' })} />);
    expect(container.querySelector('img')).toHaveAttribute('src', faviconUrl('hubspot.com'));
    expect(container).toHaveTextContent('hubspot.com');
  });

  it('draws no icon slot without a favicon prop', () => {
    const { container } = renderWithProviders(<URLCell {...cell()} />);
    expect(container.querySelector('[data-slot="favicon"]')).toBeNull();
  });

  it('puts a title on a second line, isolated in bdi', () => {
    const { container } = renderWithProviders(<URLCell {...cell({ title: 'Pricing | HubSpot' })} />);
    const title = screen.getByText('Pricing | HubSpot');
    expect(title.tagName).toBe('BDI');
    expect(title).toHaveAttribute('title', 'Pricing | HubSpot');
    expect(line(container)).not.toContainElement(title);
  });

  it.each([null, undefined, ''])('draws no second line for the title %j', (title) => {
    const { container } = renderWithProviders(<URLCell {...cell({ title })} />);
    expect(container.querySelector('bdi')).toBeNull();
  });
});

describe('URLCell links and actions', () => {
  it('without an inspector the path is the outbound link, in a new tab', () => {
    renderWithProviders(<URLCell {...cell()} />);
    const link = screen.getByRole('link', { name: 'Open hubspot.com/pricing in a new tab' });
    expect(link).toHaveAttribute('href', URL_TEXT);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(link).toHaveAttribute('data-cell-control');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('with an inspector the path opens it and an Open button goes out in a new tab', () => {
    renderWithProviders(<URLCell {...cell({ inspectorHref: HREF })} />);
    const inspector = screen.getByRole('link', { name: 'hubspot.com/pricing' });
    expect(inspector).toHaveAttribute('href', HREF);
    expect(inspector).not.toHaveAttribute('target');
    const open = screen.getByRole('link', { name: 'Open hubspot.com/pricing in a new tab' });
    expect(open).toHaveAttribute('href', URL_TEXT);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  });

  it('names the host in every link, so two rows with one path on two hosts sound different', () => {
    const { unmount } = renderWithProviders(<URLCell {...cell({ url: 'https://a.com/pricing' })} />);
    const first = screen.getByRole('link').getAttribute('aria-label');
    unmount();
    renderWithProviders(<URLCell {...cell({ url: 'https://b.com/pricing' })} />);
    expect(screen.getByRole('link').getAttribute('aria-label')).not.toBe(first);
  });

  it('names a bare host by the host alone, with no trailing slash', () => {
    renderWithProviders(<URLCell {...cell({ url: 'https://hubspot.com/', inspectorHref: HREF })} />);
    expect(screen.getByRole('link', { name: 'hubspot.com' })).toHaveAttribute('href', HREF);
    expect(screen.getByRole('link', { name: 'Open hubspot.com in a new tab' })).toBeInTheDocument();
  });

  it('does not open the row when the Open button beside an inspector link is clicked', async () => {
    const onRow = vi.fn();
    const { user } = renderWithProviders(
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a stand-in for the row
      <div onClick={onRow}>
        <URLCell {...cell({ inspectorHref: HREF })} />
      </div>,
    );
    const open = screen.getByRole('link', { name: 'Open hubspot.com/pricing in a new tab' });
    open.addEventListener('click', (event) => event.preventDefault());
    await user.click(open);
    expect(onRow).not.toHaveBeenCalled();
  });

  it('does not open the row around it on a click', async () => {
    const onRow = vi.fn();
    const { user } = renderWithProviders(
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a stand-in for the row
      <div onClick={onRow}>
        <URLCell {...cell()} />
      </div>,
    );
    const link = screen.getByRole('link');
    link.addEventListener('click', (event) => event.preventDefault());
    await user.click(link);
    expect(onRow).not.toHaveBeenCalled();
  });

  it('in a list has links that are ordinary tab stops with a focus ring', async () => {
    const { user } = renderWithProviders(<URLCell {...cell({ context: 'list' })} />);
    const link = screen.getByRole('link');
    expect(link).not.toHaveAttribute('data-cell-control');
    expect(link).toHaveClass('focus-visible:focus-ring');
    await user.tab();
    expect(link).toHaveFocus();
  });

  it('in a list reaches Copy by Tab after the link, and Open after Copy', async () => {
    const { user } = renderWithProviders(<URLCell {...cell({ context: 'list', inspectorHref: HREF })} />);
    const copy = screen.getByRole('button', { name: 'Copy cited page' });
    expect(copy).not.toHaveAttribute('tabindex', '-1');
    expect(copy).not.toHaveAttribute('data-cell-control');
    await user.tab();
    expect(screen.getByRole('link', { name: 'hubspot.com/pricing' })).toHaveFocus();
    await user.tab();
    expect(copy).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Open hubspot.com/pricing in a new tab' })).toHaveFocus();
  });

  it('in a list without an inspector reaches Copy by Tab after the outbound link', async () => {
    const { user } = renderWithProviders(<URLCell {...cell({ context: 'list' })} />);
    await user.tab();
    expect(screen.getByRole('link')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Copy cited page' })).toHaveFocus();
  });

  it('in a grid keeps Copy out of the tab order, a cell control the table reaches with F2', () => {
    renderWithProviders(<URLCell {...cell()} />);
    const copy = screen.getByRole('button', { name: 'Copy cited page' });
    expect(copy).toHaveAttribute('tabindex', '-1');
    expect(copy).toHaveAttribute('data-cell-control');
  });

  it('copies the original address, not what the cell shows', async () => {
    const { user } = renderWithProviders(<URLCell {...cell()} />);
    await user.click(screen.getByRole('button', { name: 'Copy cited page' }));
    expect(copyText).toHaveBeenCalledWith(URL_TEXT);
  });
});

describe('URLCell empty and invalid', () => {
  it('says No URL for null, or the caller words', () => {
    const { unmount } = renderWithProviders(<URLCell {...cell({ url: null })} />);
    expect(screen.getByText('No URL')).toHaveClass('text-foreground-tertiary');
    expect(screen.queryByRole('button')).toBeNull();
    unmount();
    renderWithProviders(<URLCell {...cell({ url: null, emptyText: 'Not cited' })} />);
    expect(screen.getByText('Not cited')).toBeInTheDocument();
    expect(screen.queryByText('No URL')).toBeNull();
  });

  it.each(HOSTILE_URLS.filter((entry) => !entry.linkable))(
    'shows $name as text, with no link, and says Invalid URL',
    async ({ url }) => {
      const { container, user } = renderWithProviders(<URLCell {...cell({ url, favicon: 'show' })} />);
      expect(container.textContent).toContain(url);
      expect(container.querySelector('a')).toBeNull();
      expect(container.querySelector('img')).toBeNull();
      expect(screen.getByRole('img', { name: 'Invalid URL' })).toBeInTheDocument();
      await user.hover(container.querySelector('[data-slot="url-cell"] [dir="ltr"]') ?? container);
      expect(popups()[0]).toHaveTextContent('Invalid URL');
      // Copy still copies what the API sent
      await user.click(screen.getByRole('button', { name: 'Copy cited page' }));
      expect(copyText).toHaveBeenCalledWith(url);
      expectNoInjection(container);
    },
  );

  it.each(HOSTILE_URLS.filter((entry) => entry.linkable))(
    'links $name only to the address webHref accepts',
    async ({ url }) => {
      const { container, user } = renderWithProviders(<URLCell {...cell({ url, inspectorHref: HREF })} />);
      const hrefs = [...container.querySelectorAll('a[href]')].map((anchor) => anchor.getAttribute('href'));
      expect(hrefs).toEqual([HREF, webHref(url)]);
      for (const anchor of container.querySelectorAll('a')) {
        anchor.addEventListener('click', (event) => event.preventDefault());
        await user.click(anchor);
      }
      // A bidi control never reaches the screen: it shows as its percent encoding
      expect(container.textContent).not.toMatch(/[\u{202A}-\u{202E}\u{2066}-\u{2069}]/u);
      expectNoInjection(container);
    },
  );

  it('shows the encoded override and the punycode of a look-alike host', () => {
    const rlo = HOSTILE_URLS.find((entry) => entry.name.includes('override'))?.url ?? '';
    const { container, unmount } = renderWithProviders(<URLCell {...cell({ url: rlo })} />);
    expect(container.textContent).toContain('%E2%80%AEgnp.exe');
    unmount();
    renderWithProviders(<URLCell {...cell({ url: 'https://xn--80ak6aa92e.com/' })} />);
    expect(screen.getByText('xn--80ak6aa92e.com')).toBeInTheDocument();
  });
});

describe('URLCell hostile titles', () => {
  it.each(HOSTILE_TITLES)('renders title %#  as text in bdi', (title) => {
    const { container } = renderWithProviders(<URLCell {...cell({ title, inspectorHref: HREF })} />);
    expectNoInjection(container);
    const isolated = container.querySelector('bdi');
    expect(isolated?.textContent).toBe(title);
    expect(isolated).toHaveClass('truncate');
    expect(isolated).toHaveAttribute('title', title);
    expect(line(container)).toHaveAttribute('dir', 'ltr');
    // The destination stays visible whatever the title says
    expect(container).toHaveTextContent('hubspot.com');
  });
});

describe('URLCell axe', () => {
  it.each(['light', 'dark'])('has no violation in the %s theme', async (theme) => {
    document.documentElement.className = theme === 'dark' ? 'dark' : '';
    try {
      const { container } = renderWithProviders(
        <ul>
          <li>
            <URLCell {...cell({ inspectorHref: HREF, title: 'Pricing', favicon: 'show' })} />
          </li>
          <li>
            <URLCell {...cell({ url: 'javascript:alert(1)' })} />
          </li>
          <li>
            <URLCell {...cell({ url: null })} />
          </li>
        </ul>,
      );
      expect(await axe(container)).toHaveNoViolations();
    } finally {
      document.documentElement.className = '';
    }
  });
});
