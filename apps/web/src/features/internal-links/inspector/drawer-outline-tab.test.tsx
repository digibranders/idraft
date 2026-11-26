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
    crawl: { crawl: null, run: older ? MOCK_RUN_ID : null, older, linksAvailable: true, unknown: false },
    linkScope: 'editorial',
    tiers: [],
    timeZone: 'UTC',
    canWrite: false,
    canNote: false,
    openPage: () => undefined,
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
}: {
  urlId: string;
  context?: PageDrawerContext;
  issues?: Seam<readonly PageIssue[]>;
}): ReactElement {
  const [open, setOpen] = useState<ReadonlySet<OutlineBlockId>>(() => new Set(OUTLINE_OPEN_AT_START));
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
    expect(screen.getAllByText('Fine')).toHaveLength(2);
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
