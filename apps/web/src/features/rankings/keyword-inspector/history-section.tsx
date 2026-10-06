'use client';

import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { configHistoryQuery, type KeywordScope } from './inspector-queries';
import { SectionError } from './section-error';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { Badge } from '@/components/ui/badge';
import { formatDetailDateTime } from '@/lib/format';
import { useDepthLabel } from '@/lib/keywords/use-depth-label';

/** A card's list shows ten rows at most (16-drawers-dialogs-popovers.md section 2.4). */
const SHOWN = 10;

/**
 * The keyword's configuration versions, newest first: a new depth profile or target URL starts one, so
 * rank history can be read against the settings that were in force.
 */
export function HistorySection({ scope, timeZone }: { scope: KeywordScope; timeZone: string }): ReactElement {
  const t = useTranslations('rankings.inspector.history');
  const depthLabel = useDepthLabel();
  const history = useQuery(configHistoryQuery(scope));
  const versions = [...(history.data?.data ?? [])].sort((a, b) => b.config_version - a.config_version);
  const earlier = versions.length - SHOWN;
  return (
    <InspectorSection
      title={t('title')}
      icon={History}
      status={history.isPending ? 'loading' : history.isError ? 'error' : 'ready'}
      error={
        <SectionError
          title={t('failed')}
          error={history.error}
          onRetry={() => void history.refetch()}
          retrying={history.isFetching}
        />
      }
    >
      <ol className="flex flex-col divide-y divide-border-subtle">
        {versions.slice(0, SHOWN).map((version) => {
          const date = formatDetailDateTime(version.valid_from, timeZone);
          return (
            <li key={version.config_version} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
              <div className="flex items-center gap-2">
                <span className="type-body-strong">{t('version', { version: version.config_version })}</span>
                {version.valid_to === null ? <Badge tone="positive">{t('current')}</Badge> : null}
              </div>
              <p className="type-body wrap-anywhere text-foreground-secondary">
                {t('settings', {
                  depth: t('depth', { depth: depthLabel(version.depth_profile) }),
                  target:
                    version.target_url === null
                      ? t('noTarget')
                      : t('target', { url: version.target_url.canonical_url }),
                })}
              </p>
              {version.change_reason === null ? null : (
                <p className="type-body wrap-anywhere text-foreground-secondary">
                  {t('reason', { reason: version.change_reason })}
                </p>
              )}
              <p className="type-meta">
                {version.changed_by === null
                  ? t('changedBySystem', { date })
                  : t('changedBy', { date, name: version.changed_by.name })}
              </p>
            </li>
          );
        })}
      </ol>
      {earlier > 0 ? <p className="mt-2 type-meta">{t('more', { count: earlier })}</p> : null}
    </InspectorSection>
  );
}
