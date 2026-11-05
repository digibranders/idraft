'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { requiredScope, scopeKind, type ScopeKind } from './google-model';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';

const KINDS: readonly ScopeKind[] = ['webmasters', 'analytics', 'openid', 'email'];
/** The two product permissions: a person may untick either, so these lines can say they were not granted. */
const PRODUCT_KINDS: readonly ScopeKind[] = ['webmasters', 'analytics'];
const SCOPE_KEYS = {
  webmasters: 'webmasters',
  analytics: 'analytics',
  openid: 'openid',
  email: 'email',
  other: 'other',
} as const satisfies Record<ScopeKind, string>;

export interface AccessPanelProps {
  scopes: readonly string[];
  /**
   * The scopes are what the connection was granted, so a product permission missing from them is listed as
   * not granted. Without it the scopes are what idraft will ask for, and every line is a promise.
   */
  granted?: boolean | undefined;
}

/**
 * What idraft may do with the Google account, in plain words (24-page-templates.md section 9.12, Access). Each
 * line shows Google's own name for the permission in a tooltip. The last line is true of every scope the
 * backend asks for: nothing here can change a property, a sitemap or a setting.
 */
export function AccessPanel({ scopes, granted = false }: AccessPanelProps): ReactElement {
  const t = useTranslations('integrations.access');
  // One line per kind of permission, in one order: Google may return the email scope under two names, and the
  // API does not promise an order
  const lines = KINDS.flatMap((kind) => {
    const scope = scopes.find((candidate) => scopeKind(candidate) === kind);
    if (scope !== undefined) return [{ kind, scope, missing: false }];
    // Granular consent: a product the person unticked is still named, so they see what is missing
    return granted && PRODUCT_KINDS.includes(kind)
      ? [{ kind, scope: requiredScope(kind === 'webmasters' ? 'gsc' : 'ga4'), missing: true }]
      : [];
  }).concat(
    scopes
      .filter((scope) => scopeKind(scope) === 'other')
      .map((scope) => ({ kind: 'other' as const, scope, missing: false })),
  );
  return (
    <section
      aria-labelledby="google-access-title"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-5 py-4"
    >
      <div>
        <h2 id="google-access-title" className="type-section-title">
          {t('title')}
        </h2>
        <p className="mt-1 type-meta">{t('description')}</p>
      </div>
      <ul aria-label={t('listLabel')} className="flex flex-col gap-1.5">
        {lines.map(({ kind, scope, missing }) => (
          <li key={scope} className="flex flex-wrap items-center gap-2 type-body">
            <Tooltip content={scope} purpose="description">
              <button type="button" className="cursor-help rounded-xs text-left outline-none focus-visible:focus-ring">
                {t(SCOPE_KEYS[kind])}
              </button>
            </Tooltip>
            {missing ? <Badge tone="warning">{t('notGranted')}</Badge> : null}
          </li>
        ))}
        <li className="type-body text-foreground-secondary">{t('readOnly')}</li>
      </ul>
    </section>
  );
}
