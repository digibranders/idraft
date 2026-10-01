import { HttpResponse, type HttpHandler } from 'msw';

import { signedIn } from './access';
import { cursorPage, pageRequest, queryError, unknownQuery } from './rules';
import { MOCK_DOMAIN_CATEGORIES, MOCK_LOCATIONS } from '../entity-fixtures';
import { invalid, mock, problem } from '../respond';

/**
 * The registries every signed-in user may read (19 section 3.2.5): the locations collection can target, from
 * DataForSEO's list, and the domain categories of 14-citation-intelligence.md section 4.
 */

const SURFACES = ['serp', 'ai_mode', 'llm_scraper'] as const;
const MAX_QUERY_TEXT = 200;
const MAX_LOCATION_TYPE = 64;
const LOCATION_QUERY = [
  'cursor',
  'limit',
  'filter[q]',
  'filter[country_iso]',
  'filter[location_type]',
  'filter[supports]',
];

/** Locations by name, as the API sorts them, so `filter[location_type]=Country` alone lists the countries. */
const BY_NAME = [...MOCK_LOCATIONS].sort((a, b) => a.name.localeCompare(b.name) || a.location_id - b.location_id);

export const registryHandlers: HttpHandler[] = [
  mock('get', '/api/v1/locations', ({ request, cookies }) => {
    if (!signedIn(cookies)) return problem(request, 'unauthenticated');
    const url = new URL(request.url);
    const unknown = unknownQuery(url, LOCATION_QUERY);
    if (unknown.length > 0) return invalid(request, unknown);
    const paging = pageRequest(url);
    const text = url.searchParams.get('filter[q]');
    const country = url.searchParams.get('filter[country_iso]');
    const type = url.searchParams.get('filter[location_type]');
    const supports = url.searchParams.get('filter[supports]');
    const errors = [
      ...(Array.isArray(paging) ? paging : []),
      ...(text !== null && text.length > MAX_QUERY_TEXT
        ? [queryError('filter[q]', 'string_too_long', `At most ${String(MAX_QUERY_TEXT)} characters.`)]
        : []),
      ...(country === null || /^[A-Za-z]{2}$/.test(country)
        ? []
        : [queryError('filter[country_iso]', 'string_pattern_mismatch', 'A two-letter country code such as US.')]),
      ...(type !== null && type.length > MAX_LOCATION_TYPE
        ? [queryError('filter[location_type]', 'string_too_long', `At most ${String(MAX_LOCATION_TYPE)} characters.`)]
        : []),
      ...(supports === null || SURFACES.some((surface) => surface === supports)
        ? []
        : [queryError('filter[supports]', 'enum', `Allowed: ${SURFACES.join(', ')}.`)]),
    ];
    if (errors.length > 0 || Array.isArray(paging)) return invalid(request, errors);
    const needle = text?.trim().toLowerCase() ?? '';
    const rows = BY_NAME.filter(
      (location) =>
        (needle === '' || location.name.toLowerCase().includes(needle)) &&
        (country === null || location.country_iso === country.toUpperCase()) &&
        (type === null || location.location_type === type) &&
        (supports === null || location.supports.includes(supports)),
    );
    const page = cursorPage(rows, paging, JSON.stringify([needle, country?.toUpperCase() ?? null, type, supports]));
    if (page === null) return problem(request, 'invalid_cursor');
    return HttpResponse.json(page);
  }),

  mock('get', '/api/v1/domain-categories', ({ request, cookies }) => {
    if (!signedIn(cookies)) return problem(request, 'unauthenticated');
    const unknown = unknownQuery(new URL(request.url), []);
    if (unknown.length > 0) return invalid(request, unknown);
    return HttpResponse.json({ data: [...MOCK_DOMAIN_CATEGORIES] });
  }),
];
