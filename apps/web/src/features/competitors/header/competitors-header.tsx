'use client';

import { Link2, MoreHorizontal, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement, type ReactNode } from 'react';

import { useCompetitors } from '../competitors-context';
import { COMPETITOR_VIEW_KEYS, competitorViews } from '../scope/competitors-views';
import { PageHeader } from '@/components/app/shell/page-header';
import { SavedViewMenu } from '@/components/app/views/saved-view-menu';
import { useSavedView } from '@/components/app/views/use-saved-view';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu } from '@/components/ui/menu';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { copyText } from '@/lib/dom/clipboard';
import { formatIsoDate, formatRelative, formatTableDateTime } from '@/lib/format';

/** The id of the More actions item that copies the link. */
const COPY_LINK = 'copy-link';
const DAY_MS = 86_400_000;
// shortcut: stale from 7 days on, the rule of the Citations page and the prompt History (a feature may not import
// them); replace the three with the shared stale rule of WP-18 (CF-27)
const STALE_AFTER_DAYS = 7;

/**
 * The meta line (plan section 3.4): when the newest answer of the scope came and how many competitors are tracked.
 * The time is the freshness of the by topic read, which only the Comparison tab asks, so the other tabs say the count
 * alone. Until the tracked set has answered it is a skeleton the height of the line, so nothing moves; a failed read
 * leaves the line out.
 */
function useMeta(wanted: boolean): ReactNode {
  const t = useTranslations('competitors');
  const { reads, project, today } = useCompetitors();
  const { competitors, topics } = reads;
  if (!wanted || competitors.status === 'error' || competitors.status === 'idle') return undefined;
  if (competitors.data === undefined || topics.status === 'loading') return <Skeleton shape="text-13" widthPct={48} />;
  const count = competitors.data.meta.entities.filter((entity) => entity.role === 'competitor').length;
  const total = topics.data?.data.total;
  if (total === undefined || total === null) return t('metaCount', { count });
  const newest = total.last_observed_at;
  if (newest === null) return t('metaNone', { count });
  const days = (Date.parse(today) - Date.parse(formatIsoDate(newest, project.timeZone))) / DAY_MS;
  if (days >= STALE_AFTER_DAYS) return t('metaStale', { date: formatTableDateTime(newest, project.timeZone), count });
  return t('meta', { time: formatRelative(newest, project.timeZone), count });
}

/**
 * The title block of the page (24 section 9.8): the title, the meta line, the saved view menu (presets), the primary
 * Add competitor for a member who may add entities, and a More menu that copies the link. Add competitor opens the
 * dialog the route composes; the header only asks the screen to open it. `metaWanted` is false when the engines failed
 * to load or none is on: there is nothing to count then.
 */
export function CompetitorsHeader({ metaWanted }: { metaWanted: boolean }): ReactElement {
  const t = useTranslations('competitors');
  const common = useTranslations('common');
  const { addCompetitor } = useCompetitors();
  // With no engine on, or the engines unread, there is nothing to count and so no line
  const meta = useMeta(metaWanted);
  const views = useMemo(() => competitorViews((key) => t(`views.${key}`)), [t]);
  const savedView = useSavedView({ views, viewKeys: COMPETITOR_VIEW_KEYS });
  const copyLink = (): void => {
    void copyText(window.location.href).then((copied) =>
      toast(copied ? { type: 'success', title: t('linkCopied') } : { type: 'error', title: common('copy.failed') }),
    );
  };
  return (
    <PageHeader
      title={t('title')}
      meta={meta}
      actions={
        <>
          <SavedViewMenu
            views={views}
            current={savedView.view}
            viewKeys={COMPETITOR_VIEW_KEYS}
            edited={savedView.edited}
            onApply={savedView.apply}
            onReset={savedView.reset}
          />
          <Menu
            align="end"
            trigger={<IconButton icon={MoreHorizontal} variant="secondary" label={t('moreActions')} />}
            items={[{ id: COPY_LINK, label: t('copyLink'), icon: Link2, onSelect: copyLink }]}
          />
          {addCompetitor === null ? null : (
            <Button variant="primary" icon={Plus} onClick={addCompetitor}>
              {t('header.addCompetitor')}
            </Button>
          )}
        </>
      }
    />
  );
}
