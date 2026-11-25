'use client';

import { Link2, MoreHorizontal, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement, type ReactNode } from 'react';

import { useCompetitors } from '../competitors-context';
import { COMPETITOR_VIEW_KEYS, competitorViews } from '../scope/competitors-views';
import { PageToolbar } from '@/components/app/page-toolbar';
import { SavedViewMenu } from '@/components/app/views/saved-view-menu';
import { useSavedView } from '@/components/app/views/use-saved-view';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu } from '@/components/ui/menu';
import { toast } from '@/components/ui/toast';
import { copyText } from '@/lib/dom/clipboard';

const COPY_LINK = 'copy-link';

/**
 * Sticky under the top bar at every width, as the AI Overview's and the Prompts page's toolbars are: the scope is
 * changed from any tab, and the filters wrap onto a second row when the width asks. The negative margins and the equal
 * padding make it sit where it would without them.
 */
const TOOLBAR_CLASS =
  'bg-background -mx-3 -my-2 px-3 py-2 md:-mx-4 md:px-4 lg:-mx-5 lg:px-5 sticky top-topbar z-(--z-sticky)';

export interface CompetitorsToolbarProps {
  /** The filter bar and the comparison select, in the toolbar's filter slot. */
  filters: ReactNode;
  /** The tracked-competitor count or the freshness, as a small status chip. */
  status: ReactNode;
}

/**
 * The toolbar of the Competitors page: filters on the left, then the status, saved views, More actions and the primary
 * Add competitor for a member who may add entities.
 */
export function CompetitorsToolbar({ filters, status }: CompetitorsToolbarProps): ReactElement {
  const t = useTranslations('competitors');
  const common = useTranslations('common');
  const { addCompetitor } = useCompetitors();
  const views = useMemo(() => competitorViews((key) => t(`views.${key}`)), [t]);
  const savedView = useSavedView({ views, viewKeys: COMPETITOR_VIEW_KEYS });
  const copyLink = (): void => {
    void copyText(window.location.href).then((copied) =>
      toast(copied ? { type: 'success', title: t('linkCopied') } : { type: 'error', title: common('copy.failed') }),
    );
  };
  return (
    <section aria-label={t('toolbar')} className={TOOLBAR_CLASS}>
      <PageToolbar
        title={t('title')}
        filters={filters}
        status={status}
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
    </section>
  );
}
