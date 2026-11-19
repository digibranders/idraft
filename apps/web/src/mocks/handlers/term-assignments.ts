import { HttpResponse, type HttpHandler } from 'msw';

import {
  idListError,
  keywordProjectCaller,
  savedKeywords,
  selectedRows,
  selectionErrors,
  termErrors,
} from './keyword-rules';
import { booleanError, bodyError, enumError, extraMembers, isOneOf, isRecord, notAnObject } from './rules';
import { entityConfigVersion } from '../entities-state';
import { changeSettings, settingsOf } from '../internal-links-world';
import { withSettings, withTermLinks, DEPTH_PROFILES, type StoredSeoSettings } from '../keywords-state';
import { invalid, mock } from '../respond';
import { internalLinksSettingsScheduleValues } from '@/lib/api/schema';
import type { ValidationItem } from '@/lib/api/types';
import type { AlertSettingsPatch, InternalLinksSettingsPatch } from '@/lib/internal-links/types';

/**
 * Terms given to tracked keywords in bulk (19 section 3.5, as built in step 5): `add` (a term of a
 * single-valued vocabulary takes the place of the keyword's other term of it), `remove`, or `replace` (the
 * subjects' terms in the vocabularies of `term_ids` give way to them; other vocabularies are kept), over a
 * list of ids or a filter. And a project's keyword defaults, `settings.seo`.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const OPS = ['add', 'remove', 'replace'] as const;

/** Every keyword default with a value. */
type SeoValues = { [K in keyof StoredSeoSettings]-?: Exclude<StoredSeoSettings[K], undefined> };

const SEO_DEFAULTS: SeoValues = {
  default_device: 'desktop',
  default_depth_profile: 'full',
  default_frequency: 'daily',
  visibility_weight_scheme: 'uniform',
  visibility_volume_mode: 'annual_average',
};
/** The project's keyword defaults, each member set here or the API default. */
const seoOf = (settings: StoredSeoSettings | undefined): SeoValues => ({
  default_device: settings?.default_device ?? SEO_DEFAULTS.default_device,
  default_depth_profile: settings?.default_depth_profile ?? SEO_DEFAULTS.default_depth_profile,
  default_frequency: settings?.default_frequency ?? SEO_DEFAULTS.default_frequency,
  visibility_weight_scheme: settings?.visibility_weight_scheme ?? SEO_DEFAULTS.visibility_weight_scheme,
  visibility_volume_mode: settings?.visibility_volume_mode ?? SEO_DEFAULTS.visibility_volume_mode,
});

const SEO_FIELDS = {
  default_device: ['desktop', 'mobile', 'both'],
  default_depth_profile: DEPTH_PROFILES,
  default_frequency: ['daily', 'weekly'],
  visibility_weight_scheme: ['uniform', 'priority', 'business_value'],
  visibility_volume_mode: ['annual_average', 'seasonal'],
} as const;

const LINK_FIELDS = ['schedule', 'render_javascript', 'allowed_subdomains', 'alerts'];
const ALERT_FIELDS = ['enabled', 'max_position', 'threshold', 'channel'];
const ALERT_CHANNELS = ['app', 'email', 'slack'] as const;
const MAX_SUBDOMAINS = 10;

/** A whole number within its bounds, or its error (`null` and a member left out pass: the caller checks those). */
function wholeError(value: unknown, path: string, min: number, max: number): ValidationItem[] {
  if (value === undefined || value === null) return [];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return [bodyError(path, 'int_type', 'Input should be a valid integer')];
  }
  if (value < min)
    return [bodyError(path, 'greater_than_equal', `Input should be greater than or equal to ${String(min)}`)];
  return value > max
    ? [bodyError(path, 'less_than_equal', `Input should be less than or equal to ${String(max)}`)]
    : [];
}

/**
 * The field errors of an `internal_links.alerts` patch (backend `AlertSettingsPatch`): email and Slack are refused
 * with the reason in the field error, as the API refuses them until the alerts service ships.
 */
function alertErrors(alerts: unknown): ValidationItem[] {
  const path = 'internal_links.alerts';
  if (alerts === undefined || alerts === null) return [];
  if (!isRecord(alerts)) return [notAnObject(path)];
  const errors = extraMembers(alerts, ALERT_FIELDS, path);
  if (Object.keys(alerts).length === 0) {
    errors.push(bodyError(path, 'value_error', 'Value error, give at least one alert setting to change'));
  }
  for (const name of ALERT_FIELDS) {
    if (alerts[name] === null) errors.push(bodyError(`${path}.${name}`, 'null_not_allowed', 'Cannot be null.'));
  }
  errors.push(
    ...booleanError(alerts.enabled ?? undefined, `${path}.enabled`),
    ...wholeError(alerts.max_position, `${path}.max_position`, 1, 8),
    ...wholeError(alerts.threshold, `${path}.threshold`, 1, 50),
  );
  const channel = alerts.channel;
  if (channel === undefined || channel === null) return errors;
  if (channel === 'email' || channel === 'slack') {
    errors.push(
      bodyError(
        `${path}.channel`,
        'value_error',
        'Value error, channel_unavailable: email and Slack alerts are not available yet',
      ),
    );
  } else if (!isOneOf(channel, ALERT_CHANNELS)) {
    errors.push(...enumError(channel, `${path}.channel`, ALERT_CHANNELS));
  }
  return errors;
}

/** The field errors of an `internal_links` patch, as the API's model gives them (backend `InternalLinksSettingsPatch`). */
function linksErrors(links: Readonly<Record<string, unknown>>, host: string | undefined): ValidationItem[] {
  const errors = extraMembers(links, LINK_FIELDS, 'internal_links');
  if (Object.keys(links).length === 0) {
    errors.push(bodyError('internal_links', 'value_error', 'Give at least one setting to change.'));
  }
  for (const name of LINK_FIELDS) {
    if (links[name] === null) errors.push(bodyError(`internal_links.${name}`, 'null_not_allowed', 'Cannot be null.'));
  }
  if (links.schedule !== null)
    errors.push(...enumError(links.schedule, 'internal_links.schedule', internalLinksSettingsScheduleValues));
  if (links.render_javascript !== null)
    errors.push(...booleanError(links.render_javascript, 'internal_links.render_javascript'));
  errors.push(...alertErrors(links.alerts));
  const hosts = links.allowed_subdomains;
  if (hosts === undefined || hosts === null) return errors;
  if (!Array.isArray(hosts))
    return [...errors, bodyError('internal_links.allowed_subdomains', 'list_type', 'Input should be a valid list')];
  if (hosts.length > MAX_SUBDOMAINS) {
    errors.push(bodyError('internal_links.allowed_subdomains', 'too_long', 'At most 10 hosts.'));
  }
  hosts.forEach((entry: unknown, index) => {
    const name = typeof entry === 'string' ? entry.trim() : '';
    if (name === '' || /\s/.test(name)) {
      errors.push(bodyError(`internal_links.allowed_subdomains.${String(index)}`, 'invalid_host', 'Not a host name.'));
    }
  });
  if (errors.length > 0) return errors;
  // A host of the project's site, with or without www., or under it; never a look-alike (backend is_site_host)
  const bare = host?.toLowerCase().replace(/^www\./, '');
  const strangers = hostsOf(hosts).filter(
    (name) => bare === undefined || (name !== bare && !name.endsWith(`.${bare}`)),
  );
  return strangers.length === 0 ? errors : [notASiteHost(strangers, bare)];
}

/** The backend's one error for hosts that are not the site: the field, `not_a_site_host`, the hosts named. */
const notASiteHost = (strangers: readonly string[], bare: string | undefined): ValidationItem =>
  bodyError(
    'internal_links.allowed_subdomains',
    'not_a_site_host',
    bare === undefined
      ? 'The project has no website yet, so it has no subdomains.'
      : `Each host must be the project's website or a subdomain of it (${bare}): ${strangers.join(', ')}.`,
  );

/** Allowed subdomains as the API writes them: lower case, each one once, in the order given. */
const hostsOf = (entries: readonly unknown[]): string[] => [
  ...new Set(entries.map((entry) => String(entry).trim().toLowerCase())),
];

/** The checked `internal_links` patch as the typed patch. */
function settingsPatchOf(links: Readonly<Record<string, unknown>>): InternalLinksSettingsPatch {
  const { schedule, render_javascript: render, allowed_subdomains: hosts, alerts } = links;
  return {
    ...(isOneOf(schedule, internalLinksSettingsScheduleValues) ? { schedule } : {}),
    ...(typeof render === 'boolean' ? { render_javascript: render } : {}),
    ...(Array.isArray(hosts) ? { allowed_subdomains: hostsOf(hosts) } : {}),
    ...(isRecord(alerts) ? { alerts: alertPatchOf(alerts) } : {}),
  };
}

/** The checked `internal_links.alerts` patch: the members given (email and Slack never get this far). */
function alertPatchOf(alerts: Readonly<Record<string, unknown>>): AlertSettingsPatch {
  const { enabled, max_position: maxPosition, threshold, channel } = alerts;
  return {
    ...(typeof enabled === 'boolean' ? { enabled } : {}),
    ...(typeof maxPosition === 'number' ? { max_position: maxPosition } : {}),
    ...(typeof threshold === 'number' ? { threshold } : {}),
    ...(channel === 'app' ? { channel } : {}),
  };
}

export const termAssignmentHandlers: HttpHandler[] = [
  mock('post', `${P}/term-assignments`, async ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'keywords:write',
    });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const shape: ValidationItem[] = [
      ...extraMembers(body, ['subject_type', 'subject_ids', 'subject_filter', 'term_ids', 'op']),
      ...(['subject_type', 'term_ids', 'op'] as const)
        .filter((name) => body[name] === undefined)
        .map((name) => bodyError(name, 'missing', 'Field required')),
      ...enumError(body.subject_type, 'subject_type', ['tracked_keyword', 'prompt']),
      ...enumError(body.op, 'op', OPS),
      ...idListError(body.term_ids, 'term_ids', 100, { min: 1 }),
      ...selectionErrors(body, 'subject_ids', 'subject_filter'),
    ];
    if (shape.length > 0 || !isOneOf(body.op, OPS) || !Array.isArray(body.term_ids)) return invalid(request, shape);
    if (body.subject_type === 'prompt') {
      return invalid(request, [
        bodyError('subject_type', 'subject_type_not_supported', 'Prompts arrive with the AI step.'),
      ]);
    }
    const termIds = body.term_ids.filter((id): id is string => typeof id === 'string');
    const terms = termErrors(caller, termIds, 'term_ids', { removing: body.op === 'remove' });
    if (terms.length > 0) return invalid(request, terms);
    const subjects = selectedRows(request, caller, body, 'subject_ids', 'subject_filter', termIds.length);
    if (subjects instanceof Response) return subjects;
    const vocabularyOf = (termId: string): string | undefined =>
      caller.world.terms.find((term) => term.term_id === termId)?.vocabulary_id;
    const replaced = new Set(termIds.map(vocabularyOf));
    // `add` with a term of a single-valued vocabulary replaces the keyword's other term of it (as built)
    const single = new Set(
      caller.world.vocabularies.filter((v) => v.is_single_valued === true).map((v) => v.vocabulary_id),
    );
    const displacedBy = new Set(
      [...replaced].filter((vocabulary) => vocabulary !== undefined && single.has(vocabulary)),
    );
    let added = 0;
    let removed = 0;
    const adds: { term_id: string; tracked_keyword_id: string }[] = [];
    const removes: { term_id: string; tracked_keyword_id: string }[] = [];
    for (const row of subjects) {
      const id = row.tracked_keyword_id;
      const held = new Set(
        caller.keywords.termLinks.filter((link) => link.tracked_keyword_id === id).map((link) => link.term_id),
      );
      const takeAway =
        body.op === 'remove'
          ? termIds.filter((termId) => held.has(termId))
          : body.op === 'replace'
            ? [...held].filter((termId) => replaced.has(vocabularyOf(termId)) && !termIds.includes(termId))
            : [...held].filter((termId) => displacedBy.has(vocabularyOf(termId)) && !termIds.includes(termId));
      const give = body.op === 'remove' ? [] : termIds.filter((termId) => !held.has(termId));
      removes.push(...takeAway.map((term_id) => ({ term_id, tracked_keyword_id: id })));
      adds.push(...give.map((term_id) => ({ term_id, tracked_keyword_id: id })));
      removed += takeAway.length;
      added += give.length;
    }
    const cookie = savedKeywords(request, withTermLinks(caller.keywordChanges, adds, removes));
    if (typeof cookie !== 'string') return cookie;
    return HttpResponse.json(
      { data: { assignments_added: added, assignments_removed: removed, subjects_matched: subjects.length } },
      { headers: { 'set-cookie': cookie } },
    );
  }),

  mock('get', `${P}/settings`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
    });
    if (caller instanceof Response) return caller;
    const projectId = caller.project.project_id;
    return HttpResponse.json({
      data: {
        version: 1,
        seo: seoOf(caller.keywords.settings[projectId]),
        internal_links: settingsOf(projectId),
        entity_config_version: entityConfigVersion(caller.entityChanges, projectId),
      },
    });
  }),

  mock('patch', `${P}/settings`, async ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const seo = body.seo;
    const links = body.internal_links;
    const errors: ValidationItem[] = [
      ...extraMembers(body, ['seo', 'internal_links']),
      // At least one of the two parts, and neither may be null (a merge patch would read null as "delete")
      ...(seo === undefined && links === undefined
        ? [bodyError('', 'value_error', 'Give seo or internal_links.')]
        : []),
      ...(seo === null ? [bodyError('seo', 'null_not_allowed', 'Cannot be null.')] : []),
      ...(links === null ? [bodyError('internal_links', 'null_not_allowed', 'Cannot be null.')] : []),
      ...(seo !== undefined && seo !== null && !isRecord(seo) ? [notAnObject('seo')] : []),
    ];
    if (isRecord(seo)) {
      errors.push(...extraMembers(seo, Object.keys(SEO_FIELDS), 'seo'));
      for (const [name, allowed] of Object.entries(SEO_FIELDS)) {
        if (seo[name] === null) errors.push(bodyError(`seo.${name}`, 'null_not_allowed', 'Cannot be null.'));
        else errors.push(...enumError(seo[name], `seo.${name}`, allowed));
      }
    }
    if (links !== undefined && links !== null) {
      errors.push(
        ...(isRecord(links)
          ? linksErrors(links, caller.project.primary_domain?.host)
          : [notAnObject('internal_links')]),
      );
    }
    if (errors.length > 0) return invalid(request, errors);
    const projectId = caller.project.project_id;
    // The members sent replace those set before; the others keep their value
    const before = seoOf(caller.keywords.settings[projectId]);
    const settings: SeoValues = !isRecord(seo)
      ? before
      : {
          default_device: isOneOf(seo.default_device, SEO_FIELDS.default_device)
            ? seo.default_device
            : before.default_device,
          default_depth_profile: isOneOf(seo.default_depth_profile, SEO_FIELDS.default_depth_profile)
            ? seo.default_depth_profile
            : before.default_depth_profile,
          default_frequency: isOneOf(seo.default_frequency, SEO_FIELDS.default_frequency)
            ? seo.default_frequency
            : before.default_frequency,
          visibility_weight_scheme: isOneOf(seo.visibility_weight_scheme, SEO_FIELDS.visibility_weight_scheme)
            ? seo.visibility_weight_scheme
            : before.visibility_weight_scheme,
          visibility_volume_mode: isOneOf(seo.visibility_volume_mode, SEO_FIELDS.visibility_volume_mode)
            ? seo.visibility_volume_mode
            : before.visibility_volume_mode,
        };
    const cookie = savedKeywords(request, withSettings(caller.keywordChanges, projectId, settings));
    if (typeof cookie !== 'string') return cookie;
    if (isRecord(links)) changeSettings(projectId, settingsPatchOf(links));
    return HttpResponse.json(
      {
        data: {
          version: 1,
          seo: seoOf(settings),
          internal_links: settingsOf(projectId),
          entity_config_version: entityConfigVersion(caller.entityChanges, projectId),
        },
      },
      { headers: { 'set-cookie': cookie } },
    );
  }),
];
