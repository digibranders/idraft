'use client';

import { Link2, MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement, type ReactNode } from 'react';

import { askedEngines } from '../data/overview-queries';
import { buildAggregates } from '../data/aggregates';
import { useOverview, useOverviewSummary } from '../overview-context';
import { metaLine } from './meta-line';
import { PageHeader } from '@/components/app/shell/page-header';
import { IconButton } from '@/components/ui/icon-button';
import { Menu } from '@/components/ui/menu';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { CustomizeButton, CustomizingBadge } from '@/features/layouts';
import { copyText } from '@/lib/dom/clipboard';
import { formatTableDateTime } from '@/lib/format';

/** The id of the More actions item that copies the link. */
const COPY_LINK = 'copy-link';

/**
 * The meta line: when the newest answer came, how many prompts are asked and on how many engines, all of the
 * scope the numbers below show. Until the summary has answered it is a skeleton the height of the line, so nothing
 * moves; a failed read leaves the engines alone, and a project with no engine on has no line.
 */
function useMeta(): ReactNode {
  const t = useTranslations('aiOverview.meta');
  const { project, scope, engines, enabledEngines } = useOverview();
  const summary = useOverviewSummary();
  const aggregates = useMemo(
    () =>
      summary.data === undefined || engines.data === undefined
        ? null
        : buildAggregates({
            current: summary.data,
            previous: null,
            engines: engines.data,
            chosenEngines: scope.engines,
            topicsKept: null,
            sources: null,
            fanout: null,
          }),
    [summary.data, engines.data, scope.engines],
  );
  if (engines.status === 'error' || (engines.status === 'ready' && enabledEngines.length === 0)) return undefined;
  if (engines.status === 'loading' || summary.status === 'loading') return <Skeleton shape="text-13" widthPct={48} />;
  const updatedAt = aggregates?.lastObservedAt ?? null;
  const promptCount = aggregates?.promptCount ?? null;
  return metaLine([
    updatedAt === null ? null : t('updated', { time: formatTableDateTime(updatedAt, project.timeZone) }),
    promptCount === null ? null : t('prompts', { count: promptCount }),
    t('engines', { count: askedEngines({ scope, enabledEngines }).length }),
  ]);
}

/**
 * The title block of the page (24 section 9.2, the approved preview): the title with the Customizing badge beside
 * it, the meta line under it, and Customize and More actions at the end. The Export menu joins them with the
 * export (T11). While the engines load there is no Customize: the layout counts AI cards as unavailable until they
 * are read, so entering the mode then would show every AI card as a placeholder.
 */
export function OverviewHeader(): ReactElement {
  const t = useTranslations('aiOverview');
  const common = useTranslations('common');
  const { engines } = useOverview();
  const meta = useMeta();
  const copyLink = (): void => {
    void copyText(window.location.href).then((copied) =>
      toast(copied ? { type: 'success', title: t('linkCopied') } : { type: 'error', title: common('copy.failed') }),
    );
  };
  return (
    <PageHeader
      title={t('title')}
      titleAddon={<CustomizingBadge />}
      meta={meta}
      actions={
        <>
          {engines.status === 'loading' ? (
            // The size of the Customize button, so the actions do not move when it arrives
            <span
              aria-hidden="true"
              className="hidden h-control w-28 animate-skeleton-pulse rounded-md bg-surface-subtle md:block"
            />
          ) : (
            <CustomizeButton />
          )}
          <Menu
            align="end"
            trigger={<IconButton icon={MoreHorizontal} variant="secondary" label={t('moreActions')} />}
            items={[{ id: COPY_LINK, label: t('copyLink'), icon: Link2, onSelect: copyLink }]}
          />
        </>
      }
    />
  );
}
