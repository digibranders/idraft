import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CitationList, citationItemId, type CitationListItem } from './citation-list';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const writeText = vi.fn<(text: string) => Promise<void>>();

const item = (overrides: Partial<CitationListItem> & Pick<CitationListItem, 'index'>): CitationListItem => ({
  title: `Title ${String(overrides.index)}`,
  url: `https://site${String(overrides.index)}.example/page`,
  rawUrl: `https://site${String(overrides.index)}.example/page?utm_source=chatgpt.com`,
  host: `site${String(overrides.index)}.example`,
  role: 'third_party',
  quote: null,
  flags: [],
  inAnswer: true,
  ...overrides,
});

const ITEMS: readonly CitationListItem[] = [
  item({ index: 1, role: 'own' }),
  item({ index: 2, role: 'competitor' }),
  item({ index: 3 }),
];

function renderList(
  props: Partial<Parameters<typeof CitationList>[0]> = {},
): ReturnType<typeof renderWithProviders> & { onShow: ReturnType<typeof vi.fn<(index: number) => void>> } {
  const onShow = vi.fn<(index: number) => void>();
  const view = renderWithProviders(<CitationList items={ITEMS} idPrefix="cit" onShowInAnswer={onShow} {...props} />);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return { ...view, onShow };
}

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
});
afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('CitationList', () => {
  it('is an ordered list named for what it holds, one item for each citation, with its number, title and host', async () => {
    const { container } = renderList();
    const list = screen.getByRole('list', { name: 'Sources cited in this answer' });
    expect(list.tagName).toBe('OL');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[1] as HTMLElement).getByText('2')).toHaveClass('num');
    expect(within(rows[1] as HTMLElement).getByRole('link', { name: 'Title 2' })).toHaveAttribute(
      'href',
      'https://site2.example/page',
    );
    expect(within(rows[1] as HTMLElement).getByText('site2.example')).toHaveClass('type-meta');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('opens a source by its canonical address in a new tab with noopener, and wraps long text', () => {
    renderList();
    const link = screen.getByRole('link', { name: 'Title 1' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.parentElement).toHaveClass('wrap-anywhere');
  });

  it('gives each source its role as a word, own, competitor or third party', () => {
    renderList();
    const list = screen.getByRole('list', { name: 'Sources cited in this answer' });
    expect(within(list).getByText('Own')).toBeInTheDocument();
    expect(within(list).getByText('Competitor')).toBeInTheDocument();
    expect(within(list).getByText('Third party')).toBeInTheDocument();
  });

  it('shows an address that is not a web address as text, and a title that holds markup as text', () => {
    renderList({
      items: [
        item({
          index: 1,
          url: 'javascript:alert(1)',
          rawUrl: 'javascript:alert(2)',
          title: '<img src=x onerror=alert(1)>',
        }),
      ],
    });
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('shows an address with a user name or a password as text: its host is the part after the at sign', () => {
    renderList({
      items: [
        item({ index: 1, url: 'https://user:pw@evil.example/', title: 'With a password' }),
        item({ index: 2, url: 'https://google.com@evil.example/', title: 'With a decoy' }),
      ],
    });
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('With a password')).toBeInTheDocument();
    expect(screen.getByText('With a decoy')).toBeInTheDocument();
  });

  it('marks the active item, and gives every item an id and a place for focus to land', () => {
    renderList({ activeIndex: 2 });
    const rows = screen.getAllByRole('listitem');
    expect(rows[1]).toHaveAttribute('aria-current', 'true');
    expect(rows[1]).toHaveAttribute('data-active');
    expect(rows[0]).not.toHaveAttribute('aria-current');
    expect(rows[1]).toHaveAttribute('id', citationItemId('cit', 2));
    expect(rows[1]).toHaveAttribute('tabindex', '-1');
  });

  it('copies the original address the provider sent, not the canonical one, and says so', async () => {
    const { user } = renderList();
    await user.click(screen.getByRole('button', { name: 'Copy the address of citation 1' }));
    await act(async () => Promise.resolve());
    expect(writeText).toHaveBeenCalledWith('https://site1.example/page?utm_source=chatgpt.com');
    expect(document.getElementById('live-region-polite')).toHaveTextContent('Address of citation 1 copied');
  });

  it('copies an address that is no web address as it is, since a copy is never a link', async () => {
    const { user } = renderList({
      items: [item({ index: 1, rawUrl: 'javascript:alert(2)', url: 'javascript:alert(1)' })],
    });
    await user.click(screen.getByRole('button', { name: 'Copy the address of citation 1' }));
    await act(async () => Promise.resolve());
    expect(writeText).toHaveBeenCalledWith('javascript:alert(2)');
  });

  it('reports "Show in answer" with the citation, by mouse and by keyboard, and offers it only where the text has a marker', async () => {
    const { user, onShow } = renderList({
      items: [item({ index: 1 }), item({ index: 2, inAnswer: false }), item({ index: 3 })],
    });
    expect(screen.queryByRole('button', { name: 'Show in answer, citation 2' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show in answer, citation 1' }));
    screen.getByRole('button', { name: 'Show in answer, citation 3' }).focus();
    await user.keyboard('{Enter}');
    expect(onShow.mock.calls).toEqual([[1], [3]]);
  });

  it('says in words why a flagged source is left out of the counts, and leaves an unknown flag silent', () => {
    renderList({
      items: [
        item({ index: 1, flags: ['unresolved_redirect'] }),
        item({ index: 2, flags: ['engine_internal'] }),
        item({ index: 3, flags: ['something_new'] }),
      ],
    });
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0] as HTMLElement).getByText('Redirect not resolved. Left out of the counts.')).toBeVisible();
    expect(
      within(rows[1] as HTMLElement).getByText('An address of the engine itself. Left out of the counts.'),
    ).toBeVisible();
    expect(within(rows[2] as HTMLElement).queryByText(/Left out of the counts/)).toBeNull();
  });

  it('shows the quoted passage as plain text, hostile markup included, in the language of the answer', () => {
    renderList({
      lang: 'de',
      items: [item({ index: 1, quote: '<script>window.__wp26_xss=1</script> "quoted" **not bold**' })],
    });
    const quote = screen.getByText(/<script>window.__wp26_xss=1<\/script>/);
    expect(quote.tagName).toBe('P');
    expect(quote).toHaveAttribute('lang', 'de');
    expect(quote.querySelector('script, strong')).toBeNull();
    expect(Reflect.get(window, '__wp26_xss')).toBeUndefined();
  });

  it('hands the quote to a slot when the screen has a better box for it, and renders no quote without one', () => {
    renderList({
      items: [item({ index: 1, quote: 'A passage' }), item({ index: 2 })],
      renderQuote: (quote, entry) => <blockquote data-testid="slot">{`${quote} from ${entry.host}`}</blockquote>,
    });
    expect(screen.getAllByTestId('slot')).toHaveLength(1);
    expect(screen.getByTestId('slot')).toHaveTextContent('A passage from site1.example');
  });

  it('passes the accessibility checks with a quote, a flag and an active item', async () => {
    const { container } = renderList({
      activeIndex: 1,
      items: [item({ index: 1, quote: 'A passage', flags: ['engine_internal'] }), item({ index: 2 })],
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
