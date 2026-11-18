import type { Route, RouteStep } from './types';

export type CloserNote =
  { kind: 'menus'; difference: number } | { kind: 'noEditorial' } | { kind: 'unreachable' } | null;

/** The sentence under the two routes: menus make the page closer than the editorial links do (spec 7.10). */
export function closerNote(clicks: { any: number | null; editorial: number | null }): CloserNote {
  if (clicks.any === null) return { kind: 'unreachable' };
  if (clicks.editorial === null) return { kind: 'noEditorial' };
  return clicks.editorial > clicks.any ? { kind: 'menus', difference: clicks.editorial - clicks.any } : null;
}

export interface RouteStepView {
  path: string;
  url_id: string;
  /** The words of the link that reached this page; `null` for the first step. */
  anchor: string | null;
  placement: RouteStep['placement'];
  scope: RouteStep['scope'];
  statusCode: number | null;
  /** The page is reached through a redirect: the step is marked. */
  viaRedirect: boolean;
  first: boolean;
  last: boolean;
}

/** A route as the steps the screen draws, in order, with the ends marked. */
export const routeSteps = (route: Route): RouteStepView[] =>
  route.steps.map((step, index, all) => ({
    path: step.page.path,
    url_id: step.page.url_id,
    anchor: step.anchor,
    placement: step.placement,
    scope: step.scope,
    statusCode: step.status_code,
    viaRedirect: step.via_redirect,
    first: index === 0,
    last: index === all.length - 1,
  }));
