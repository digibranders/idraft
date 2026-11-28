import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { Route } from 'next';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DrawerOutlineTab } from './drawer-outline-tab';
import type { PageDrawerContext } from './page-drawer-context';
import type { PageRow } from '@/lib/internal-links/types';
import type { PageIssue, Seam } from '@/lib/pages/issue-source';
import { OUTLINE_OPEN_AT_START, type OutlineBlockId } from '@/lib/pages/outline-model';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { crawledPage, EVENTUS, MOCK_RUN_ID, pageRow } from '@/mocks/internal-links-world';
import {
  OUTLINE_LONG_PAGE,
  OUTLINE_NO_HTML_PAGE,
  OUTLINE_PROBLEM_PAGE,
  outlineOf,
} from '@/mocks/internal-links-outline';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/msw';

const OUTLINE = mswPath(
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages/{url_id}/outline',
);
const HEALTHY = '101';
const REDIRECT = '106';
const NOT_FOUND = '107';

const row = (id: string): PageRow => {
  const page = crawledPage(id);
  if (page === undefined) throw new Error(`The fixture has no page ${id}`);
  return pageRow(page, 'all');
};

function contextOf(
  overrides: { older?: boolean; issueCheck?: (checkId: string) => Route | null } = {},
): PageDrawerContext {
  const older = overrides.older ?? false;
  const route = (path: string): Route => path as Route;
  return {
    scope: { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: EVENTUS.project_id },
    workspaceSlug: 'acme',
    projectSlug: 'site',
    crawl: { crawl: null, run: older ? MOCK_RUN_ID : null, older, linksAvailable: true, unknown: false },
    linkScope: 'editorial',
    tiers: [],
    timeZone: 'UTC',
    canWrite: false,
    canNote: false,
    openPage: () => undefined,
    openPrompt: () => undefined,
    hrefs: {
      journey: () => route('/journey'),
      linksFrom: () => route('/from'),
      linksTo: () => route('/to'),
      issueCheck: overrides.issueCheck ?? (() => null),
      taxonomy: route('/taxonomy'),
      integrations: route('/integrations'),
    },
  };
}

const UNAVAILABLE: Seam<readonly PageIssue[]> = { state: 'unavailable' };

/** The drawer holds the open blocks; this does the same, so they can be seen to survive another page. */
function Harness({
  urlId,
  context = contextOf(),
  issues = UNAVAILABLE,
  opened = OUTLINE_OPEN_AT_START,
}: {
  urlId: string;
  context?: PageDrawerContext;
  issues?: Seam<readonly PageIssue[]>;
  opened?: readonly OutlineBlockId[];
}): ReactElement {
  const [open, setOpen] = useState<ReadonlySet<OutlineBlockId>>(() => new Set(opened));
  return (
    <DrawerOutlineTab
      context={context}
      urlId={urlId}
      page={row(urlId)}
      active
      issues={issues}
      openBlocks={open}
      onToggleBlock={(id) =>
        setOpen((current) => {
          const next = new Set(current);
          if (!next.delete(id)) next.add(id);
          return next;
        })
      }
    />
  );
}

/** The outline the mock gives a page, with parts changed. */
function outlineWith(
  id: string,
  change: (body: NonNullable<ReturnType<typeof outlineOf>['outline']>) => void,
): { data: ReturnType<typeof outlineOf> } {
  const answer = outlineOf(row(id), MOCK_RUN_ID);
  if (answer.outline === null) throw new Error(`Page ${id} has no outline`);
  change(answer.outline);
  return { data: answer };
}

const block = (name: string): HTMLElement => screen.getByRole('region', { name });

beforeEach(() => {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});
afterEach(() => {
  server.events.removeAllListeners();
});

describe('a healthy page', () => {
  it('shows the four numbers, then Search listing and Headings open', async () => {
    renderWithProviders(<Harness urlId={HEALTHY} />);
    const strip = await screen.findByRole('group', { name: 'Outline numbers' });
    for (const text of ['H1', 'Headings', 'Words', 'Images', 'as it should be', '3 min read', 'all described']) {
      expect(strip).toHaveTextContent(text);
    }
    for (const name of ['Search listing', 'Headings']) {
      const button = screen.getByRole('button', { name: new RegExp(`^${name}`) });
      expect(button).toHaveAttribute('aria-expanded', 'true');
      expect(document.getElementById(button.getAttribute('aria-controls') ?? '')).toBe(block(name));
    }
    // Languages has no chip with no pairs; the other five blocks have nothing to fix
    expect(screen.getAllByText('Fine')).toHaveLength(5);
    expect(
      screen.getByText('Read from the stored HTML of the latest crawl, so it shows the page as the crawler saw it.'),
    ).toBeInTheDocument();
  });

  it('folds with Enter and opens with Space, keeping the focus, and keeps the choice on another page', async () => {
    const { user, rerender } = renderWithProviders(<Harness urlId={HEALTHY} />);
    const button = await screen.findByRole('button', { name: /^Headings/ });
    button.focus();
    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    // A folded region is out of the accessibility tree, so it is found through the button's `aria-controls`
    expect(document.getElementById(button.getAttribute('aria-controls') ?? '')).not.toBeVisible();
    expect(button).toHaveFocus();
    rerender(<Harness urlId="102" />);
    const other = await screen.findByRole('button', { name: /^Headings/ });
    expect(other).toHaveAttribute('aria-expanded', 'false');
    // Another page is a new element, so the person tabs to it again
    other.focus();
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: /^Headings/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Headings/ })).toHaveFocus();
  });

  it('has no axe violations', async () => {
    const { container } = renderWithProviders(<Harness urlId={HEALTHY} />);
    await screen.findByRole('group', { name: 'Outline numbers' });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('the headings list', () => {
  it('is an ordered list that says each level, folded to 12 with Show all', async () => {
    const { user, rerender } = renderWithProviders(<Harness urlId={OUTLINE_LONG_PAGE} />);
    const list = await screen.findByRole('list', { name: 'Headings in page order' });
    expect(list.tagName).toBe('OL');
    expect(within(list).getAllByRole('listitem')).toHaveLength(12);
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(/^H1/);
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent(/^H2/);
    await user.click(screen.getByRole('button', { name: 'Show all 14 headings' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(14);
    const fewer = screen.getByRole('button', { name: 'Show fewer headings' });
    expect(fewer).toHaveFocus();
    rerender(<Harness urlId={HEALTHY} />);
    await screen.findByRole('list', { name: 'Headings in page order' });
    rerender(<Harness urlId={OUTLINE_LONG_PAGE} />);
    const again = await screen.findByRole('list', { name: 'Headings in page order' });
    expect(within(again).getAllByRole('listitem')).toHaveLength(12);
  });
});

describe('headings without text', () => {
  const serveHeadings = (listed: number, total: number): void =>
    server.use(
      http.get(OUTLINE, () =>
        HttpResponse.json(
          outlineWith(OUTLINE_LONG_PAGE, (body) => {
            body.headings = Array.from({ length: listed }, (_, index) => ({ level: 2, text: `Heading ${index}` }));
            body.headings_total = total;
            body.level_counts = [0, total, 0, 0, 0, 0];
          }),
        ),
      ),
    );

  it('13 headings with 1 empty list 12, offer no Show all and say one has no text', async () => {
    serveHeadings(12, 13);
    renderWithProviders(<Harness urlId={OUTLINE_LONG_PAGE} />);
    const list = await screen.findByRole('list', { name: 'Headings in page order' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(12);
    expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull();
    expect(screen.queryByText(/^The first /)).toBeNull();
    expect(screen.getByText('1 heading has no text, so no row')).toBeInTheDocument();
  });

  it('14 listed of 16 offers Show all 14, shows 14 and says 2 have no text', async () => {
    serveHeadings(14, 16);
    const { user } = renderWithProviders(<Harness urlId={OUTLINE_LONG_PAGE} />);
    await user.click(await screen.findByRole('button', { name: 'Show all 14 headings' }));
    expect(within(screen.getByRole('list', { name: 'Headings in page order' })).getAllByRole('listitem')).toHaveLength(
      14,
    );
    expect(screen.getByText('2 headings have no text, so no row')).toBeInTheDocument();
  });

  it('says the first 200 of 1,240 only when the list hit its cap', async () => {
    serveHeadings(200, 1240);
    renderWithProviders(<Harness urlId={OUTLINE_LONG_PAGE} />);
    expect(await screen.findByText('The first 200 of 1,240 headings')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show all 200 headings' })).toBeInTheDocument();
  });
});

describe('the title in the preview', () => {
  it('cuts at 60 characters, not 60 UTF-16 units, so an emoji is never split', async () => {
    const title = '\u{1F600}'.repeat(61);
    server.use(
      http.get(OUTLINE, () =>
        HttpResponse.json(outlineWith(HEALTHY, (body) => (body.title = { text: title, chars: 61, state: 'long' }))),
      ),
    );
    renderWithProviders(<Harness urlId={HEALTHY} />);
    expect(await screen.findByText(`${'\u{1F600}'.repeat(60)}...`)).toBeInTheDocument();
  });
});

describe('a page with problems', () => {
  it('says To fix, counts the findings and draws the meter as text', async () => {
    renderWithProviders(<Harness urlId={OUTLINE_PROBLEM_PAGE} />);
    const button = await screen.findByRole('button', { name: /^Search listing/ });
    expect(button).toHaveTextContent('2 things to fix');
    expect(button).toHaveTextContent('To fix');
    expect(screen.getByText('The title is short. Add the words people search for.')).toBeInTheDocument();
    expect(
      screen.getByText('There is no meta description, so Google writes its own text under the title.'),
    ).toBeInTheDocument();
    const meter = screen.getByText('22 characters, short of 30');
    expect(meter.previousElementSibling).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('No description. Google picks a sentence from the page.')).toBeInTheDocument();
  });

  it('has no See in Issues link while the host gives no route', async () => {
    renderWithProviders(<Harness urlId={OUTLINE_PROBLEM_PAGE} />);
    await screen.findByRole('button', { name: /^Search listing/ });
    expect(screen.queryByText('See in Issues')).toBeNull();
  });

  it('links a finding that has a check, and no finding that has none', async () => {
    server.use(
      http.get(OUTLINE, () =>
        HttpResponse.json(
          outlineWith(OUTLINE_PROBLEM_PAGE, (body) => {
            body.headings = [
              { level: 1, text: 'About' },
              { level: 4, text: 'Deep' },
            ];
            body.headings_total = 2;
            body.level_counts = [1, 0, 0, 1, 0, 0];
            body.skipped_at = 1;
          }),
        ),
      ),
    );
    renderWithProviders(
      <Harness
        urlId={OUTLINE_PROBLEM_PAGE}
        context={contextOf({ issueCheck: (checkId) => `/issues/${checkId}` as Route })}
      />,
    );
    const missing = (await screen.findByText(/^There is no meta description/)).closest('li') as HTMLElement;
    expect(within(missing).getByRole('link', { name: 'See in Issues' })).toHaveAttribute(
      'href',
      '/issues/description-missing',
    );
    const skipped = screen
      .getByText('“Deep” is an H4 straight after an H1. Do not skip a level.')
      .closest('li') as HTMLElement;
    expect(within(skipped).queryByRole('link')).toBeNull();
  });

  it('lists a duplicate description only when the page issues say so', async () => {
    const duplicate: Seam<readonly PageIssue[]> = {
      state: 'ready',
      data: [{ checkId: 'description-duplicate', severity: 'notice', detail: null }],
    };
    const { rerender } = renderWithProviders(<Harness urlId={HEALTHY} />);
    await screen.findByRole('button', { name: /^Search listing/ });
    expect(screen.queryByText('Other pages use this same description.')).toBeNull();
    rerender(<Harness urlId={HEALTHY} issues={duplicate} />);
    expect(await screen.findByText('Other pages use this same description.')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderWithProviders(<Harness urlId={OUTLINE_PROBLEM_PAGE} />);
    await screen.findByRole('button', { name: /^Search listing/ });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('the states', () => {
  it('shows a skeleton and no block while loading', () => {
    const { container } = renderWithProviders(<Harness urlId={HEALTHY} />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('[aria-expanded]')).toBeNull();
  });

  it('says where a redirect leads, from the row, and an error with its status', async () => {
    const first = renderWithProviders(<Harness urlId={REDIRECT} />);
    expect(
      await screen.findByText(
        'This address redirects to /services/vapt, so it has no content of its own. Open the page it leads to for its outline.',
      ),
    ).toBeInTheDocument();
    first.unmount();
    renderWithProviders(<Harness urlId={NOT_FOUND} />);
    expect(await screen.findByText('This address answers with 404, so there is no page to read.')).toBeInTheDocument();
  });

  it('says the HTML was not kept', async () => {
    renderWithProviders(<Harness urlId={OUTLINE_NO_HTML_PAGE} />);
    expect(await screen.findByText(/^The HTML of this page was not kept in the latest crawl/)).toBeInTheDocument();
  });

  it('says the page is not in the latest crawl when the read answers 404', async () => {
    server.use(
      http.get(OUTLINE, () =>
        HttpResponse.json({ type: 'about:blank', title: 'Not found', status: 404 }, { status: 404 }),
      ),
    );
    renderWithProviders(<Harness urlId={HEALTHY} />);
    expect(await screen.findByText('This page is not in the latest crawl.')).toBeInTheDocument();
  });

  it('shows an inline error with a Retry that works when the read fails', async () => {
    let fail = true;
    server.use(
      http.get(OUTLINE, () =>
        fail
          ? HttpResponse.json({ type: 'about:blank', title: 'Server error', status: 500 }, { status: 500 })
          : undefined,
      ),
    );
    const { user } = renderWithProviders(<Harness urlId={HEALTHY} />);
    expect(await screen.findByText('The outline of this page could not be loaded')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('group', { name: 'Outline numbers' })).toBeInTheDocument();
  });

  it('puts the line about an older crawl above the strip and the footer last', async () => {
    renderWithProviders(<Harness urlId={HEALTHY} context={contextOf({ older: true })} />);
    const strip = await screen.findByRole('group', { name: 'Outline numbers' });
    const older = screen.getByText('This is the outline from the latest crawl, not from the crawl you are viewing.');
    expect(older.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const footer = screen.getByText(/^Read from the stored HTML/);
    expect(block('Headings').compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('waits for the read when an older crawl is in view, so a row that redirected there but is live now shows its outline', async () => {
    server.use(http.get(OUTLINE, () => HttpResponse.json(outlineWith(HEALTHY, () => undefined))));
    renderWithProviders(<Harness urlId={REDIRECT} context={contextOf({ older: true })} />);
    expect(await screen.findByRole('group', { name: 'Outline numbers' })).toBeInTheDocument();
    expect(screen.queryByText(/redirects to/)).toBeNull();
  });
});

describe('text from the page is text', () => {
  it('renders markup in the title and a heading as characters', async () => {
    server.use(
      http.get(OUTLINE, () =>
        HttpResponse.json(
          outlineWith(HEALTHY, (body) => {
            body.title = { text: '<img src=x onerror=alert(1)>', chars: 28, state: 'short' };
            body.headings = [
              { level: 1, text: '<b>bold</b>' },
              { level: 2, text: 'Fine' },
            ];
            body.headings_total = 2;
            body.level_counts = [1, 1, 0, 0, 0, 0];
          }),
        ),
      ),
    );
    const { container } = renderWithProviders(<Harness urlId={HEALTHY} />);
    const preview = await screen.findByRole('group', { name: 'How the page can look in search results' });
    expect(within(preview).getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(screen.getAllByText('<b>bold</b>').length).toBeGreaterThan(0);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });
});

const ALL_BLOCKS: readonly OutlineBlockId[] = ['listing', 'headings', 'languages', 'sharing', 'structured', 'content'];
const issuesRoute = (checkId: string): Route => `/issues/${checkId}` as Route;

/** The mocked outline of a page with parts changed, served for the next read. */
function serve(id: string, change: (body: NonNullable<ReturnType<typeof outlineOf>['outline']>) => void): void {
  server.use(http.get(OUTLINE, () => HttpResponse.json(outlineWith(id, change))));
}

describe('the other four blocks', () => {
  it('follow Headings in order, closed, each with its summary', async () => {
    renderWithProviders(<Harness urlId={HEALTHY} />);
    await screen.findByRole('group', { name: 'Outline numbers' });
    const blockName = /^(Search listing|Headings|Languages|Social sharing|Structured data|Content)/;
    const names = screen
      .getAllByRole('button')
      .map((button) => blockName.exec(button.textContent ?? '')?.[0])
      .filter((name) => name !== undefined);
    expect(names).toEqual(['Search listing', 'Headings', 'Languages', 'Social sharing', 'Structured data', 'Content']);
    const languages = screen.getByRole('button', { name: /^Languages/ });
    expect(languages).toHaveAttribute('aria-expanded', 'false');
    expect(languages).toHaveTextContent('One language (en), no versions');
    expect(screen.getByRole('button', { name: /^Social sharing/ })).toHaveTextContent('Open Graph and X card set');
    expect(screen.getByRole('button', { name: /^Structured data/ })).toHaveTextContent('1 block: WebPage');
    expect(screen.getByRole('button', { name: /^Content/ })).toHaveTextContent('640 words, 4 images');
    expect(screen.getByRole('button', { name: /^Languages/ })).not.toHaveTextContent('Fine');
  });

  it('Languages lists a row per pair with its path, the wrong code and this page', async () => {
    serve(OUTLINE_PROBLEM_PAGE, (body) => {
      body.languages = {
        x_default: false,
        pairs: [
          { code: 'en', href: 'https://example.com/pricing', is_self: true, valid: true, suggestion: null },
          { code: 'en-UK', href: 'https://example.com/uk/pricing', is_self: false, valid: false, suggestion: 'en-GB' },
        ],
      };
    });
    renderWithProviders(<Harness urlId={OUTLINE_PROBLEM_PAGE} opened={['languages']} />);
    const list = await screen.findByRole('list', { name: 'Language versions' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('en');
    expect(rows[0]).toHaveTextContent('/pricing');
    expect(rows[0]).toHaveTextContent('This page');
    expect(rows[1]).toHaveTextContent('/uk/pricing');
    expect(rows[1]).toHaveTextContent('Wrong code');
    expect(screen.getByText('“en-UK” is not a language code Google reads: use en-GB.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Languages/ })).toHaveTextContent('To fix');
  });

  it('Languages with no pairs says it is fine for one language', async () => {
    renderWithProviders(<Harness urlId={HEALTHY} opened={['languages']} />);
    expect(
      await screen.findByText('The page names no other language versions. That is fine for a site in one language.'),
    ).toBeInTheDocument();
  });

  it('Social sharing says Missing five times without tags, and shows the image address as text', async () => {
    serve(HEALTHY, (body) => {
      body.social = { og_title: null, og_description: null, og_image: null, og_type: null, twitter_card: null };
    });
    const first = renderWithProviders(<Harness urlId={HEALTHY} opened={['sharing']} />);
    const region = await screen.findByRole('region', { name: 'Social sharing' });
    expect(within(region).getAllByText('Missing')).toHaveLength(5);
    expect(
      within(region).getByText('The page has no Open Graph tags, so a shared link has no title or image.'),
    ).toBeInTheDocument();
    first.unmount();
    server.resetHandlers();
    renderWithProviders(<Harness urlId={HEALTHY} opened={['sharing']} />);
    const healthy = await screen.findByRole('region', { name: 'Social sharing' });
    expect(within(healthy).getByText(/\/og\/default\.png$/)).toBeInTheDocument();
    expect(healthy.querySelector('img')).toBeNull();
    expect(within(healthy).queryByRole('link')).toBeNull();
  });

  it('Structured data has a row per block, and claims nothing about what is wrong inside one', async () => {
    serve(HEALTHY, (body) => {
      body.structured_data = [
        { types: ['Article', 'WebPage'], parses: true },
        { types: [], parses: false },
      ];
    });
    renderWithProviders(<Harness urlId={HEALTHY} opened={['structured']} />);
    const list = await screen.findByRole('list', { name: 'Structured data blocks' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Article, WebPage');
    expect(rows[0]).toHaveTextContent('Valid JSON');
    expect(rows[1]).toHaveTextContent('Unnamed block');
    expect(rows[1]).toHaveTextContent('Cannot be read');
    expect(screen.getByText('A structured data block cannot be read, so search engines skip it.')).toBeInTheDocument();
  });

  it('Content shows words with the read time, images, and the links out of the page row', async () => {
    renderWithProviders(<Harness urlId={HEALTHY} opened={['content']} />);
    const region = await screen.findByRole('region', { name: 'Content' });
    expect(region).toHaveTextContent('640');
    expect(region).toHaveTextContent('3 min read');
    expect(region).toHaveTextContent('All have alt text');
    const links = row(HEALTHY).outlinks;
    expect(region).toHaveTextContent(`${String(links)} internal link`);
    expect(region).toHaveTextContent('to other pages of the site');
  });

  it('Content says the count of images without alt text, and No images', async () => {
    serve(HEALTHY, (body) => {
      body.content = { ...body.content, images: 3, images_without_alt: 2 };
    });
    const first = renderWithProviders(<Harness urlId={HEALTHY} opened={['content']} />);
    // The strip says it too, so the block is read on its own
    expect(
      within(await screen.findByRole('region', { name: 'Content' })).getByText('2 without alt text'),
    ).toBeInTheDocument();
    first.unmount();
    serve(HEALTHY, (body) => {
      body.content = { ...body.content, images: 0, images_without_alt: 0 };
    });
    renderWithProviders(<Harness urlId={HEALTHY} opened={['content']} />);
    expect(await screen.findByText('No images')).toBeInTheDocument();
  });

  it('links each finding to its check, and renders no link when the host gives no route', async () => {
    serve(OUTLINE_PROBLEM_PAGE, (body) => {
      body.languages = {
        x_default: false,
        pairs: [{ code: 'xx', href: 'https://example.com/xx', is_self: false, valid: false, suggestion: null }],
      };
    });
    const first = renderWithProviders(
      <Harness urlId={OUTLINE_PROBLEM_PAGE} opened={ALL_BLOCKS} context={contextOf({ issueCheck: issuesRoute })} />,
    );
    await screen.findByRole('region', { name: 'Content' });
    const hrefs = screen.getAllByRole('link', { name: 'See in Issues' }).map((link) => link.getAttribute('href'));
    for (const check of ['hreflang', 'social-tags', 'schema-errors', 'thin-content', 'image-alt']) {
      expect(hrefs).toContain(`/issues/${check}`);
    }
    first.unmount();
    renderWithProviders(<Harness urlId={OUTLINE_PROBLEM_PAGE} opened={ALL_BLOCKS} />);
    await screen.findByRole('region', { name: 'Content' });
    expect(screen.queryByText('See in Issues')).toBeNull();
  });

  it('shows markup in an og:title and a type as characters', async () => {
    serve(HEALTHY, (body) => {
      body.social = { ...body.social, og_title: '<script>alert(1)</script>' };
      body.structured_data = [{ types: ['<i>x</i>'], parses: true }];
    });
    const { container } = renderWithProviders(<Harness urlId={HEALTHY} opened={ALL_BLOCKS} />);
    await screen.findByRole('region', { name: 'Social sharing' });
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(screen.getAllByText('<i>x</i>').length).toBeGreaterThan(0);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('i')).toBeNull();
  });

  it('has no axe violations with all six blocks open', async () => {
    const { container } = renderWithProviders(
      <Harness urlId={OUTLINE_PROBLEM_PAGE} opened={ALL_BLOCKS} context={contextOf({ issueCheck: issuesRoute })} />,
    );
    await screen.findByRole('region', { name: 'Content' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
