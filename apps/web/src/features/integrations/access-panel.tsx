'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { scopeKind, type ScopeKind } from './gsc-model';
import { Tooltip } from '@/components/ui/tooltip';

const KINDS: readonly ScopeKind[] = ['webmasters', 'openid', 'email'];
const SCOPE_KEYS = {
  webmasters: 'webmasters',
  openid: 'openid',
  email: 'email',
  other: 'other',
} as const satisfies Record<ScopeKind, string>;

/**
 * What idraft may do with the Google account, in plain words (24-page-templates.md section 9.12, Access). Each
 * line shows Google's own name for the permission in a tooltip. The last line is true of every scope the
 * backend asks for: nothing here can change a property, a sitemap or a setting.
 */
export function AccessPanel({ scopes }: { scopes: readonly string[] }): ReactElement {
  const t = useTranslations('integrations.access');
  // One line per kind of permission, in one order: Google may return the email scope under two names, and the
  // API does not promise an order
  const lines = KINDS.flatMap((kind) => {
    const scope = scopes.find((candidate) => scopeKind(candidate) === kind);
    return scope === undefined ? [] : [{ kind, scope }];
  }).concat(scopes.filter((scope) => scopeKind(scope) === 'other').map((scope) => ({ kind: 'other' as const, scope })));
  return (
    <section
      aria-labelledby="gsc-access-title"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-5 py-4"
    >
      <div>
        <h2 id="gsc-access-title" className="type-section-title">
          {t('title')}
        </h2>
        <p className="mt-1 type-meta">{t('description')}</p>
      </div>
      <ul aria-label={t('listLabel')} className="flex flex-col gap-1.5">
        {lines.map(({ kind, scope }) => (
          <li key={scope} className="type-body">
            <Tooltip content={scope} purpose="description">
              <button type="button" className="cursor-help rounded-xs text-left outline-none focus-visible:focus-ring">
                {t(SCOPE_KEYS[kind])}
              </button>
            </Tooltip>
          </li>
        ))}
        <li className="type-body text-foreground-secondary">{t('readOnly')}</li>
      </ul>
    </section>
  );
}
