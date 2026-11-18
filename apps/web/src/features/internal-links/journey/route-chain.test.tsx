import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RouteChain } from './route-chain';
import type { ChangePage, Route, RouteStep } from '@/lib/internal-links/types';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const page = (path: string, urlId: string): ChangePage => ({
  path,
  url: `https://example.com${path}`,
  url_id: urlId,
  tier: null,
});
const step = (path: string, urlId: string, over: Partial<RouteStep> = {}): RouteStep => ({
  page: page(path, urlId),
  status_code: 200,
  anchor: null,
  placement: null,
  scope: null,
  via_redirect: false,
  ...over,
});

const ROUTE: Route = {
  clicks: 3,
  steps: [
    step('/', '1'),
    step('/blog', '2', { anchor: 'Blog', placement: 'navigation', scope: 'template' }),
    step('/old-page', '3', { status_code: 301, anchor: 'Old page', placement: 'content', scope: 'auto_generated' }),
    step('/new-page', '4', {
      anchor: 'Moved to /new-page',
      via_redirect: true,
      placement: null,
      scope: 'editorial',
    }),
  ],
};

describe('RouteChain (spec 7.10)', () => {
  it('is an ordered list of step cards with the clicks in its heading', () => {
    renderWithProviders(<RouteChain title="Over any link" route={ROUTE} />);
    expect(screen.getByRole('heading', { name: 'Over any link 3 clicks' })).toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(list.tagName).toBe('OL');
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
  });

  it('labels the first card Home page and marks the last card as the current step', () => {
    renderWithProviders(<RouteChain title="Over any link" route={ROUTE} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(within(items[0] as HTMLElement).getByText('Home page')).toBeInTheDocument();
    expect(within(items[3] as HTMLElement).queryByText('Home page')).toBeNull();
    const current = document.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('/new-page');
  });

  it('names the link between two cards, with the scope word for menu and auto generated links', () => {
    renderWithProviders(<RouteChain title="Over any link" route={ROUTE} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items[0]).not.toHaveTextContent('linked as');
    expect(items[1]).toHaveTextContent('linked as “Blog”');
    expect(items[1]).toHaveTextContent('menu and footer');
    expect(items[2]).toHaveTextContent('linked as “Old page”');
    expect(items[2]).toHaveTextContent('auto-generated');
  });

  it('shows its own redirect label for a redirect step, never the backend anchor, and no scope word for editorial', () => {
    renderWithProviders(<RouteChain title="Over any link" route={ROUTE} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items[3]).toHaveTextContent('301 redirect');
    expect(items[3]).not.toHaveTextContent('Moved to');
    expect(items[3]).not.toHaveTextContent('menu and footer');
    expect(items[3]).not.toHaveTextContent('auto-generated');
  });

  it('shows a status badge only when the page does not answer 200', () => {
    renderWithProviders(<RouteChain title="Over any link" route={ROUTE} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items[2]).toHaveTextContent('301');
    expect(items[1]).not.toHaveTextContent('200');
    expect(items[0]).not.toHaveTextContent('200');
  });

  it('says 0 clicks for the home page itself, which is both the first and the last card', () => {
    renderWithProviders(<RouteChain title="Over any link" route={{ clicks: 0, steps: [step('/', '1')] }} />);
    expect(screen.getByRole('heading', { name: 'Over any link 0 clicks' })).toBeInTheDocument();
    expect(screen.getByText('Home page')).toBeInTheDocument();
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it('says so when a link has no words, and never shows an equity share', () => {
    renderWithProviders(
      <RouteChain
        title="Over any link"
        route={{ clicks: 1, steps: [step('/', '1'), step('/a', '2', { anchor: '', scope: 'editorial' })] }}
      />,
    );
    expect(screen.getByText('linked without text')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/equity/i);
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<RouteChain title="Over any link" route={ROUTE} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
