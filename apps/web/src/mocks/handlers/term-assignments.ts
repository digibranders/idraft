import { HttpResponse, type HttpHandler } from 'msw';

import {
  idListError,
  keywordProjectCaller,
  savedKeywords,
  selectedRows,
  selectionErrors,
  termErrors,
} from './keyword-rules';
import { bodyError, enumError, extraMembers, isOneOf, isRecord, notAnObject } from './rules';
import { entityConfigVersion } from '../entities-state';
import { withSettings, withTermLinks, DEPTH_PROFILES, type StoredSeoSettings } from '../keywords-state';
import { invalid, mock } from '../respond';
import type { ValidationItem } from '@/lib/api/types';

/**
 * Terms given to tracked keywords in bulk (19 section 3.5): `add`, `remove`, or `replace` (the subjects'
 * terms in the vocabularies of `term_ids` give way to them; other vocabularies are kept), over a list of
 * ids or a filter. And a project's keyword defaults, `settings.seo`.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const OPS = ['add', 'remove', 'replace'] as const;

/** Every keyword default with a value. */
type SeoValues = { [K in keyof StoredSeoSettings]-?: Exclude<StoredSeoSettings[K], undefined> };

const SEO_DEFAULTS: SeoValues = {
  default_device: 'desktop',
  default_depth_profile: 'standard',
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
    const subjects = selectedRows(request, caller, body, 'subject_ids', 'subject_filter');
    if (subjects instanceof Response) return subjects;
    const vocabularyOf = (termId: string): string | undefined =>
      caller.world.terms.find((term) => term.term_id === termId)?.vocabulary_id;
    const replaced = new Set(termIds.map(vocabularyOf));
    // `add` never leaves a subject with two terms of a single-valued vocabulary; `replace` swaps them
    if (body.op === 'add') {
      const single = new Set(
        caller.world.vocabularies.filter((v) => v.is_single_valued === true).map((v) => v.vocabulary_id),
      );
      const given = new Set(termIds);
      const clash = subjects.some((row) =>
        caller.keywords.termLinks.some((link) => {
          if (link.tracked_keyword_id !== row.tracked_keyword_id || given.has(link.term_id)) return false;
          const vocabulary = vocabularyOf(link.term_id);
          return vocabulary !== undefined && single.has(vocabulary) && replaced.has(vocabulary);
        }),
      );
      if (clash) {
        return invalid(request, [
          bodyError('term_ids', 'single_valued_vocabulary', 'A subject already has a term of this vocabulary.'),
        ]);
      }
    }
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
            : [];
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
    const errors: ValidationItem[] = [
      ...extraMembers(body, ['seo']),
      ...(seo === undefined ? [bodyError('seo', 'missing', 'Field required')] : []),
      ...(seo !== undefined && !isRecord(seo) ? [notAnObject('seo')] : []),
    ];
    if (isRecord(seo)) {
      errors.push(...extraMembers(seo, Object.keys(SEO_FIELDS), 'seo'));
      for (const [name, allowed] of Object.entries(SEO_FIELDS)) {
        if (seo[name] === null) errors.push(bodyError(`seo.${name}`, 'null_not_allowed', 'Cannot be null.'));
        else errors.push(...enumError(seo[name], `seo.${name}`, allowed));
      }
    }
    if (errors.length > 0 || !isRecord(seo)) return invalid(request, errors);
    const projectId = caller.project.project_id;
    // The members sent replace those set before; the others keep their value
    const before = seoOf(caller.keywords.settings[projectId]);
    const settings: SeoValues = {
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
    return HttpResponse.json(
      {
        data: {
          version: 1,
          seo: seoOf(settings),
          entity_config_version: entityConfigVersion(caller.entityChanges, projectId),
        },
      },
      { headers: { 'set-cookie': cookie } },
    );
  }),
];
