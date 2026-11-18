import { HttpResponse } from 'msw';

import { queryError } from './rules';
import { runViewOf, type RunView } from '../internal-links-world';
import { invalid, problem } from '../respond';
import type { Problem, ValidationItem } from '@/lib/api/types';

/**
 * The crawl a read of the internal links is about, as every read of the API resolves it (backend `crawl_scope`):
 * the `run` query parameter is `latest` (or left out) or a crawl id; a project with no finished crawl answers
 * `404 no_crawl`, a crawl the project does not have or one that has not finished `404 not_found`, and a link level
 * read of a crawl whose links were dropped `410 links_dropped`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `run` parameter as the API reads it: null for the latest, the id of a crawl, or its error. */
export function runParam(url: URL): string | null | ValidationItem {
  const raw = url.searchParams.get('run');
  if (raw === null || raw === 'latest') return null;
  return UUID.test(raw)
    ? raw.toLowerCase()
    : queryError('run', 'uuid_parsing', 'Input should be `latest` or a crawl id.');
}

/** The crawl in view, or the problem to answer. */
export function readRun(request: Request, url: URL, projectId: string): RunView | HttpResponse<Problem> {
  const run = runParam(url);
  if (typeof run === 'object' && run !== null) return invalid(request, [run]);
  const view = runViewOf(projectId, run);
  if (view !== null) return view;
  return problem(request, run === null ? 'no_crawl' : 'not_found');
}

/** `410 links_dropped` for a crawl without its links, else null. */
export const requireLinks = (request: Request, view: RunView): HttpResponse<Problem> | null =>
  view.run.links_available ? null : problem(request, 'links_dropped');

/** One of `allowed`, `fallback` when the parameter is left out (a `null` fallback makes it required), or its error. */
export function enumQuery<T extends string>(
  url: URL,
  name: string,
  allowed: readonly T[],
  fallback: T | null,
): T | ValidationItem {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback ?? queryError(name, 'missing', 'Field required');
  const found = allowed.find((option) => option === raw);
  return found ?? queryError(name, 'enum', `Allowed: ${allowed.join(', ')}.`);
}

/** Whether a checked parameter came back as its error. */
export const isIssue = (value: unknown): value is ValidationItem => typeof value === 'object' && value !== null;
