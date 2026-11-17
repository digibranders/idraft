import type { Route } from 'next';

import { formatInspectTarget } from './placement';
import { withQuery } from '@/lib/routes/paths';

/**
 * A link to the prompt inspector over a page: `base` with `inspect=prompt:<id>`. For a place that has no scope of its
 * own to carry (the competitor drawer of the Overview when the page scope cannot be written on the Prompts page);
 * where the scope can be written, `drillHref('prompt', ...)` of the Overview is the better link.
 */
export function promptInspectHref(base: Route, promptId: string): Route {
  const query = new URLSearchParams({ inspect: formatInspectTarget({ type: 'prompt', id: promptId }) });
  return withQuery(base, query.toString());
}
