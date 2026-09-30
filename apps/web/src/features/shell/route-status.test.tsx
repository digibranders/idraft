import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RouteError, RouteNotFound } from './route-status';
import { ApiProblem } from '@/lib/api/problem';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({ useParams: () => ({ workspace: 'digibranders', project: 'fynix' }) }));

const problem = new ApiProblem({
  status: 503,
  code: 'service_unavailable',
  title: 'Unavailable',
  detail: null,
  requestId: 'req_01ABCDEF',
  errors: [],
  retryAfterSeconds: null,
  body: {},
});

describe('RouteError', () => {
  it('shows the request id of an API problem, with Try again and the way to the project', async () => {
    const reset = vi.fn();
    const { user, container } = renderWithProviders(<RouteError error={problem} reset={reset} />);
    expect(screen.getByText('Error ID req_01ABCDEF')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the project' })).toHaveAttribute('href', '/digibranders/fynix');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the digest of a server error, and nothing when there is neither', () => {
    const { unmount } = renderWithProviders(
      <RouteError error={Object.assign(new Error('x'), { digest: '4099' })} reset={vi.fn()} />,
    );
    expect(screen.getByText('Error ID 4099')).toBeInTheDocument();
    unmount();
    renderWithProviders(<RouteError error={new Error('x')} reset={vi.fn()} />);
    expect(screen.queryByText(/Error ID/)).toBeNull();
  });
});

describe('RouteNotFound', () => {
  it('never says whether the page exists', () => {
    renderWithProviders(<RouteNotFound />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'This page does not exist or you do not have access to it' }),
    ).toBeInTheDocument();
  });
});
