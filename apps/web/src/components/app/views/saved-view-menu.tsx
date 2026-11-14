'use client';

import { ChevronDown, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type ReactElement } from 'react';

import { DEFAULT_VIEW_ID, viewChangeCount, type SavedView } from './views-model';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { Truncate } from '@/components/ui/truncate';
import { announce } from '@/lib/a11y/announcer';

/** An item WP-49 adds to the menu: its own `group` is required, so the items form a section of their own. */
export type SavedViewExtraItem = MenuItemDef & { group: string };

export interface SavedViewMenuProps {
  /** Every view the screen offers, the default view included. An empty list gives a menu with the current view alone. */
  views: readonly SavedView[];
  current: SavedView;
  /** The URL keys the screen governs (the ones `useSavedView` takes): the announcement counts only these. */
  viewKeys: readonly string[];
  edited: boolean;
  onApply: (view: SavedView) => void;
  onReset: () => void;
  /**
   * The persistence seam: items listed after Reset, in the group each one names (Save, Save as, Rename,
   * Delete, Default, Share). The caller builds them with its own labels and handlers. WP-49's hook reads
   * `useCan('views:write')` and leaves out every item a role without it must not see, so the menu itself
   * never reads a permission. Absent or empty, the menu has the views and Reset only.
   */
  extraItems?: readonly SavedViewExtraItem[] | undefined;
  /** "1 filter no longer exists" (WP-49): a warning line in the menu header and in the trigger's description. */
  notice?: string | null | undefined;
}

/**
 * The saved view of a screen, in the page header (23-application-patterns.md section 14): "View", the view
 * name, "(edited)" when the URL differs from it, and a menu of presets that each map to a URL state. The
 * trigger is as wide as its text up to a bound; a long name is cut with the whole name in a tooltip and in
 * the accessible name.
 */
export function SavedViewMenu({
  views,
  current,
  viewKeys,
  edited,
  onApply,
  onReset,
  extraItems,
  notice,
}: SavedViewMenuProps): ReactElement {
  const t = useTranslations('common.savedViewMenu');
  const noticeId = useId();
  const warning = notice === undefined || notice === null || notice === '' ? null : notice;

  // A radio item keeps its menu open, so the menu is controlled: choosing a view closes it, and Base UI returns focus
  const [open, setOpen] = useState(false);

  const applied = (view: SavedView): void => {
    setOpen(false);
    announce(t('applied', { name: view.name, count: viewChangeCount(view, viewKeys) }), { key: 'saved-view' });
  };
  const apply = (view: SavedView): void => {
    applied(view);
    onApply(view);
  };
  // Reset applies the current view again, so it is spoken as that view applied
  const reset = (): void => {
    applied(current);
    onReset();
  };
  const radio = (view: SavedView, group: string): MenuItemDef => ({
    id: `view:${view.id}`,
    label: view.name,
    kind: 'radio',
    checked: view.id === current.id,
    group,
    onSelect: () => apply(view),
  });
  // A screen without views of its own (or one that has none of the current id) still lists the view it is on
  const offered = views.some((view) => view.id === current.id) ? views : [current, ...views];
  const presets = offered.filter((view) => view.kind === 'preset');
  const stored = offered.filter((view) => view.kind === 'stored');
  const items: MenuItemDef[] = [
    ...presets.filter((view) => view.id === DEFAULT_VIEW_ID).map((view) => radio(view, t('presets'))),
    ...presets.filter((view) => view.id !== DEFAULT_VIEW_ID).map((view) => radio(view, t('presets'))),
    ...stored.filter((view) => view.scope === 'workspace').map((view) => radio(view, t('workspace'))),
    ...stored.filter((view) => view.scope !== 'workspace').map((view) => radio(view, t('personal'))),
  ];
  if (edited) items.push({ id: 'reset', label: t('reset', { name: current.name }), icon: RotateCcw, onSelect: reset });
  items.push(...(extraItems ?? []));

  return (
    <>
      <Menu
        open={open}
        onOpenChange={setOpen}
        items={items}
        header={warning === null ? undefined : <p className="type-meta text-warning-text">{warning}</p>}
        trigger={
          <Button
            variant="secondary"
            size="sm"
            aria-label={t(edited ? 'nameEdited' : 'name', { name: current.name })}
            aria-describedby={warning === null ? undefined : noticeId}
            className="max-w-full min-w-0 shrink"
          >
            <span className="text-foreground-tertiary">{t('view')}</span>
            <Truncate text={current.name} className="max-w-48" />
            {edited ? <span className="text-foreground-tertiary">{t('edited')}</span> : null}
            <Icon icon={ChevronDown} size="sm" />
          </Button>
        }
      />
      {warning === null ? null : (
        <span id={noticeId} hidden>
          {warning}
        </span>
      )}
    </>
  );
}
