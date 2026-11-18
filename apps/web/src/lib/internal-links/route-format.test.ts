import { describe, expect, it } from 'vitest';

import { closerNote, routeSteps } from './route-format';
import type { Route } from './types';

const page = (path: string): Route['steps'][number]['page'] => ({
  path,
  tier: null,
  url: `https://x.test${path}`,
  url_id: path,
});

describe('route format', () => {
  it('notes when menus make the page closer, and when there is no route', () => {
    expect(closerNote({ any: 2, editorial: 4 })).toEqual({ kind: 'menus', difference: 2 });
    expect(closerNote({ any: 3, editorial: 3 })).toBeNull();
    expect(closerNote({ any: 3, editorial: null })).toEqual({ kind: 'noEditorial' });
    expect(closerNote({ any: null, editorial: null })).toEqual({ kind: 'unreachable' });
    expect(closerNote({ any: null, editorial: 2 })).toEqual({ kind: 'unreachable' });
    expect(closerNote({ any: 0, editorial: 0 })).toBeNull();
  });

  it('lists the steps with the first and last marked and the redirect step flagged', () => {
    const route: Route = {
      clicks: 2,
      steps: [
        { page: page('/'), anchor: null, placement: null, scope: null, status_code: 200, via_redirect: false },
        {
          page: page('/old'),
          anchor: 'Read <more>',
          placement: 'content',
          scope: 'editorial',
          status_code: 301,
          via_redirect: true,
        },
        { page: page('/new'), anchor: null, placement: null, scope: null, status_code: 200, via_redirect: false },
      ],
    };
    expect(routeSteps(route)).toEqual([
      {
        path: '/',
        url_id: '/',
        anchor: null,
        placement: null,
        scope: null,
        statusCode: 200,
        viaRedirect: false,
        first: true,
        last: false,
      },
      {
        path: '/old',
        url_id: '/old',
        anchor: 'Read <more>',
        placement: 'content',
        scope: 'editorial',
        statusCode: 301,
        viaRedirect: true,
        first: false,
        last: false,
      },
      {
        path: '/new',
        url_id: '/new',
        anchor: null,
        placement: null,
        scope: null,
        statusCode: 200,
        viaRedirect: false,
        first: false,
        last: true,
      },
    ]);
  });

  it('handles no steps and one step', () => {
    expect(routeSteps({ clicks: 0, steps: [] })).toEqual([]);
    const one = routeSteps({
      clicks: 0,
      steps: [{ page: page('/'), anchor: null, placement: null, scope: null, status_code: null, via_redirect: false }],
    });
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ first: true, last: true });
  });
});
