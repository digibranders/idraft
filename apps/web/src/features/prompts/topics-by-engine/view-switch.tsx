'use client';

import { Columns3, List } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { TopicsView } from './drill';
import { SegmentedControl } from '@/components/ui/segmented-control';

/** The views offered; the Heat map joins them with its own view. */
const VIEWS = ['list', 'engines'] as const satisfies readonly TopicsView[];
const ICON = { list: List, engines: Columns3 } as const;

/**
 * The switch between the List, the By engine view (and, later, the Heat map) of the Topics tab. Icons only, each named by
 * its label and with a tooltip: the toolbar's end already holds the metric, the tab switch, the density and the columns.
 */
export function ViewSwitch({
  value,
  onValueChange,
}: {
  value: TopicsView;
  onValueChange: (view: TopicsView) => void;
}): ReactElement {
  const t = useTranslations('prompts.topicDrawer.view');
  return (
    <SegmentedControl<TopicsView>
      semantics="view"
      label={t('label')}
      value={value}
      onValueChange={onValueChange}
      size="sm"
      iconOnly
      items={VIEWS.map((view) => ({ value: view, label: t(view), icon: ICON[view] }))}
    />
  );
}
