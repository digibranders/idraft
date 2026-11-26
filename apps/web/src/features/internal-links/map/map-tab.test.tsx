import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useImperativeHandle, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findDrawerTitle } from '@/components/app/inspector/drawer-title';
import type { LinkMapChartHandle, LinkMapChartProps } from '@/components/app/link-map/link-map-chart';
import { readChartTokens } from '@/lib/design/read-tokens';
import { setLinksScenario } from '@/mocks/internal-links-world';
import { linkGraphFixture } from '@/mocks/fixtures/link-graph';
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

// The canvas is its own module with its own tests: here it is a stand-in that shows what the tab hands it
const canvas = vi.hoisted(() => ({
  props: null as unknown,
  handle: { zoomBy: vi.fn(), fit: vi.fn(), show: vi.fn() },
}));
vi.mock('@/components/app/link-map/link-map-chart', () => ({
  LinkMapChart: (props: LinkMapChartProps): ReactElement => {
    canvas.props = props;
    useImperativeHandle(props.ref, () => canvas.handle as LinkMapChartHandle, []);
    return <div role="img" aria-label={props.label} />;
  },
}));
const current = (): LinkMapChartProps => {
  if (canvas.props === null) throw new Error('the canvas was not drawn');
  return canvas.props as LinkMapChartProps;
};
/** The pages the tab hands the canvas, by id, for a frame as large as the canvas of a laptop. */
const drawn = (): string[] => {
  const option = current().build({
    tokens: readChartTokens(),
    width: 1200,
    height: 700,
    view: { zoom: 1, center: null },
  });
  const series = (option.series as { data: { name: string }[] }[])[0];
  return (series?.data ?? []).map((item) => item.name).filter((name) => !name.startsWith('h:'));
};

const GRAPH = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/graph');

beforeEach(() => {
  canvas.props = null;
  canvas.handle.zoomBy.mockClear();
  canvas.handle.fit.mockClear();
  canvas.handle.show.mockClear();
  stubWideScreen();
});
afterEach(() => restoreWideScreen());

const open = (query = '?tab=map', urls?: string[]): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
    searchParams: query,
    onUrlUpdate: ({ queryString }) => urls?.push(queryString),
  });
const map = (): Promise<HTMLElement> => screen.findByRole('region', { name: 'Link map' });
const FOUND = /^Map of internal links\./;

describe('the Link map tab', () => {
  it('shows the summary of the crawl, a legend button for each tier it has and the canvas', async () => {
    open();

    const canvasNode = await screen.findByRole('img', { name: FOUND });
    expect(canvasNode).toHaveAccessibleName(/15 pages and 13 editorial links\./);
    const region = await map();
    expect(within(region).getByText(/15 pages and 13 editorial links\./)).toBeInTheDocument();
    expect(within(region).getByText(/11 pages hang together in the largest group\./)).toBeInTheDocument();
    expect(
      within(region).getByText(/4 pages have no editorial link in or out: the block on the right\./),
    ).toBeInTheDocument();
    const legend = within(region).getByRole('group', { name: 'Tiers shown' });
    const buttons = within(legend).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      expect.stringMatching(/^T1 .*3$/),
      expect.stringMatching(/^T2 .*3$/),
      expect.stringMatching(/^T3 .*7$/),
      expect.stringMatching(/^T4 .*1$/),
      expect.stringMatching(/^Untiered.*1$/),
    ]);
  });

  it('draws every page of the crawl', async () => {
    open();
    await screen.findByRole('img', { name: FOUND });

    expect(drawn()).toHaveLength(15);
  });

  it('asks for the auto-generated links when Links is changed, and writes it to the address', async () => {
    const urls: string[] = [];
    const { user } = open('?tab=map', urls);
    await screen.findByRole('img', { name: FOUND });

    await user.click(screen.getByRole('button', { name: 'Links, Editorial' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Editorial and auto-generated' }));

    await waitFor(() => expect(urls.at(-1)).toContain('mauto=1'));
    expect(await screen.findByText(/15 pages and 15 editorial or auto-generated links\./)).toBeInTheDocument();
  });

  it('counts the pages a search lights and zooms to them on Enter', async () => {
    const urls: string[] = [];
    const { user } = open('?tab=map&mq=case-study', urls);
    await screen.findByRole('img', { name: FOUND });

    expect(await screen.findByText('2 of 15 pages')).toBeInTheDocument();

    const box = screen.getByRole('searchbox', { name: 'Find a page on the map' });
    await user.clear(box);
    await user.type(box, 'siem');
    await waitFor(() => expect(urls.at(-1)).toMatch(/mq=siem/));
    expect(urls.at(-1)).not.toContain('mpage');
    expect(await screen.findByText('1 of 15 pages')).toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(canvas.handle.show).toHaveBeenCalledTimes(1);
    // The one page found is selected too, and the box keeps focus
    await waitFor(() => expect(urls.at(-1)).toContain('mpage=10'));
    expect(box).toHaveFocus();
  });

  it('opens the card of the selected page with its links by direction', async () => {
    open('?tab=map&mpage=8');

    const card = await screen.findByRole('complementary', { name: 'Selected page' });
    expect(card).toHaveTextContent('/india/bfsi/case-study/digital-bank');
    expect(card).toHaveTextContent('Digital bank case study');
    expect(card).toHaveTextContent('0 pages link to it');
    expect(card).toHaveTextContent('3 pages it links to');
  });

  it('opens the inspector and the Journey from the card', async () => {
    const urls: string[] = [];
    const { user } = open('?tab=map&mpage=8', urls);
    const card = await screen.findByRole('complementary', { name: 'Selected page' });

    await user.click(within(card).getByRole('button', { name: 'Page details' }));
    await waitFor(() => expect(urls.at(-1)).toMatch(/inspect=page(:|%3A)8/));
  });

  it('opens the Journey on the page from the card', async () => {
    const urls: string[] = [];
    const { user } = open('?tab=map&mpage=8', urls);
    const card = await screen.findByRole('complementary', { name: 'Selected page' });

    await user.click(within(card).getByRole('button', { name: 'Open in Journey' }));
    await waitFor(() => expect(urls.at(-1)).toContain('tab=journey'));
    expect(urls.at(-1)).toContain('focus=8');
  });

  it('lets go of the selected page on Escape, on a click on the background and on a second click', async () => {
    const urls: string[] = [];
    const { user } = open('?tab=map&mpage=8', urls);
    await screen.findByRole('complementary', { name: 'Selected page' });

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Selected page' })).not.toBeInTheDocument());

    act(() => current().onSelect('8'));
    expect(await screen.findByRole('complementary', { name: 'Selected page' })).toBeInTheDocument();
    act(() => current().onSelect(null));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Selected page' })).not.toBeInTheDocument());

    act(() => current().onSelect('8'));
    await screen.findByRole('complementary', { name: 'Selected page' });
    act(() => current().onSelect('8'));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Selected page' })).not.toBeInTheDocument());
  });

  it('takes a tier off the map when its legend button is switched off, and lets go of a selected page in it', async () => {
    const { user } = open('?tab=map&mpage=10');
    await screen.findByRole('complementary', { name: 'Selected page' });
    const t3 = screen.getByRole('button', { name: /^T3/ });

    await user.click(t3);

    expect(t3).toHaveAttribute('aria-pressed', 'false');
    expect(drawn()).toHaveLength(8);
    expect(drawn()).not.toContain('10');
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Selected page' })).not.toBeInTheDocument());
    await user.click(t3);
    expect(drawn()).toHaveLength(15);
  });

  it('keeps the view controls apart from the address: zoom, fit, minimap and the help', async () => {
    const { user } = open();
    await screen.findByRole('img', { name: FOUND });

    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.click(screen.getByRole('button', { name: 'Fit everything' }));
    expect(canvas.handle.zoomBy).toHaveBeenCalledWith(1.4);
    expect(canvas.handle.zoomBy).toHaveBeenCalledWith(1 / 1.4);
    expect(canvas.handle.fit).toHaveBeenCalledTimes(1);

    const help = screen.getByRole('button', { name: 'Reading the map' });
    expect(help).toHaveAttribute('aria-expanded', 'false');
    await user.click(help);
    expect(await screen.findByRole('region', { name: 'Reading the map' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Reading the map' })).not.toBeInTheDocument());
  });

  it('says when the map is cut to the most linked pages', async () => {
    server.use(
      http.get(GRAPH, () =>
        HttpResponse.json({
          data: {
            ...linkGraphFixture('11111111-1111-4111-8111-111111111111', [], false),
            truncated: true,
            pages_total: 4200,
          },
        }),
      ),
    );
    open();

    expect(await screen.findByText('The map shows the 15 pages with the most links, of 4,200.')).toBeInTheDocument();
  });

  it('shows the links dropped state for a crawl without links, and reads no graph', async () => {
    setLinksScenario({ latestLinksDropped: true });
    const seen: string[] = [];
    server.events.on('request:start', ({ request }) => seen.push(new URL(request.url).pathname));
    open();

    expect(await screen.findByText(/This crawl’s links are no longer stored\./)).toBeInTheDocument();
    expect(seen.some((path) => path.endsWith('/internal-links/graph'))).toBe(false);
    server.events.removeAllListeners();
  });

  it('shows an error with a retry when the read fails', async () => {
    let fail = true;
    server.use(
      http.get(GRAPH, () =>
        fail
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json({ data: linkGraphFixture('11111111-1111-4111-8111-111111111111', [], false) }),
      ),
    );
    const { user } = open();

    expect(await screen.findByText('The link map could not be loaded')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('img', { name: FOUND })).toBeInTheDocument();
  });

  it('says there is nothing to map for a crawl with no live page', async () => {
    server.use(
      http.get(GRAPH, () =>
        HttpResponse.json({
          data: {
            ...linkGraphFixture('11111111-1111-4111-8111-111111111111', [], false),
            nodes: [],
            edges: [],
            pages_total: 0,
            home_url_id: null,
          },
        }),
      ),
    );
    open();

    expect(await screen.findByText('Nothing to map')).toBeInTheDocument();
    expect(screen.getByText('This crawl found no live page, so there is nothing to map yet.')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = open('?tab=map&mpage=8');
    await screen.findByRole('complementary', { name: 'Selected page' });

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('the drawer opened from the map', () => {
  it('stays above the maximised map', async () => {
    const { user } = open('?tab=map&inspect=page:8');
    await screen.findByRole('img', { name: FOUND });
    await waitFor(() => expect(findDrawerTitle()).not.toBeNull());
    const drawer = findDrawerTitle()?.closest('aside') as HTMLElement;
    await user.click(screen.getByRole('button', { name: 'Full screen' }));
    const region = await map();
    expect(region.className).toContain('z-(--z-inspector)');
    expect(drawer.className).toContain('z-(--z-drawer)');
  });

  it('returns focus to the Page details button of the card when Escape closes the drawer', async () => {
    // Another page is open already: the test URL cannot go "back", so Close replaces the URL, as for a shared link
    const { user } = open('?tab=map&mpage=8&inspect=page:3');
    const card = await screen.findByRole('complementary', { name: 'Selected page' });
    const details = within(card).getByRole('button', { name: 'Page details' });
    await user.click(details);
    await waitFor(() => expect(findDrawerTitle()).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(findDrawerTitle()).toBeNull());
    await waitFor(() => expect(details).toHaveFocus());
  });
});
