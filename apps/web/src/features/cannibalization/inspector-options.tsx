'use client';

import { GitMerge, ScanSearch, Target } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { internalLinksQuery, targetChoices } from './cann-evidence';
import { PageLine } from './cann-parts';
import type { CannScope } from './cann-reads';
import { useTargetWrite } from './use-target-write';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import type { CannKeywordDetail } from '@/lib/api/types';
import { useCan } from '@/lib/permissions';
import { keywordDetailPath, projectPath, withQuery } from '@/lib/routes/paths';

export interface InspectorOptionsProps {
  detail: CannKeywordDetail;
  scope: CannScope;
  workspaceSlug: string;
  projectSlug: string;
  /** The keyword the drawer is open on. While `detail` is still the last keyword's, no write is offered. */
  keywordId: string;
  /** The read is the last keyword's or a refresh of this one's: the page addresses on screen may not be this keyword's. */
  stale: boolean;
}

const LINK =
  'inline-flex items-center gap-1.5 self-start rounded-sm type-body text-link outline-none hover:underline focus-visible:focus-ring';

/**
 * Options (docs/33 section 7.2): what a person can do about the finding. Nothing changes by itself; each option is a
 * press. Set or clear the target page writes the tracked keyword (needs `keywords:write`); the other two are links.
 */
export function InspectorOptions({
  detail,
  scope,
  workspaceSlug,
  projectSlug,
  keywordId,
  stale,
}: InspectorOptionsProps): ReactElement {
  const t = useTranslations('cannibalization.inspector.options');
  const canWrite = useCan('keywords:write');
  const { write, pending } = useTargetWrite(scope);
  const { keyword } = detail;
  const choices = useMemo(() => targetChoices(detail), [detail]);
  const target = choices.find((page) => page.isTarget);
  const links = internalLinksQuery(detail);
  const idle = pending || stale || keyword.tracked_keyword_id !== keywordId;
  const press = (page: { url: string; path: string } | null): void => {
    if (idle) return;
    void write({ trackedKeywordId: keyword.tracked_keyword_id, keyword: keyword.keyword, page });
  };
  return (
    <InspectorSection title={t('title')} meta={t('meta')} status="ready">
      <div className="flex flex-col gap-3">
        {choices.length === 0 ? null : canWrite ? (
          <ul aria-label={t('targetLabel')} className="flex flex-col gap-2">
            {choices.map((page) => (
              <li key={page.id} className="flex items-start justify-between gap-2">
                <span className="flex min-w-0 flex-col gap-1">
                  <PageLine page={page} strong={page.isTarget} />
                  {page.isTarget ? (
                    <Badge icon={Target} className="self-start">
                      {t('isTarget')}
                    </Badge>
                  ) : null}
                </span>
                {page.isTarget ? null : (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={idle}
                    aria-label={t('setTargetLabel', { path: page.path })}
                    onClick={() => press(page)}
                  >
                    {t('setTarget')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="type-meta">{t('noAccess')}</p>
        )}
        {canWrite && target !== undefined ? (
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            disabled={idle}
            aria-label={t('clearTargetLabel', { path: target.path })}
            onClick={() => press(null)}
          >
            {t('clearTarget')}
          </Button>
        ) : null}
        <div className="flex flex-col gap-1">
          {links === null ? null : (
            <>
              <Link
                href={withQuery(projectPath(workspaceSlug, projectSlug, '/seo/internal-links'), links)}
                className={LINK}
              >
                <Icon icon={GitMerge} size="sm" />
                {t('plan')}
              </Link>
              <p className="type-meta">{t('planNote')}</p>
            </>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Link
            href={withQuery(keywordDetailPath(workspaceSlug, projectSlug, keywordId), 'tab=snapshots')}
            className={LINK}
          >
            <Icon icon={ScanSearch} size="sm" />
            {t('serp')}
          </Link>
          <p className="type-meta">{t('serpNote')}</p>
        </div>
      </div>
    </InspectorSection>
  );
}
