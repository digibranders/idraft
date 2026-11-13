'use client';

import { Columns3, Grid3x3, List } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { TopicsView } from './drill';
import { SegmentedControl } from '@/components/ui/segmented-control';

const ALL_VIEWS = ['list', 'engines', 'heatmap'] as const satisfies readonly TopicsView[];
const ICON = { list: List, engines: Columns3, heatmap: Grid3x3 } as const;

/**
 * The switch between the List, the By engine view and the Heat map of the Topics tab. Icons only, each named by its
 * label and with a tooltip: the toolbar's end already holds the metric, the tab switch, the density and the columns.
 * `views` narrows what is offered (a phone has one list for the List and the By engine view).
 */
export function ViewSwitch({
  value,
  onValueChange,
  views = ALL_VIEWS,
}: {
  value: TopicsView;
  onValueChange: (view: TopicsView) => void;
  views?: readonly TopicsView[] | undefined;
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
      items={views.map((view) => ({ value: view, label: t(view), icon: ICON[view] }))}
    />
  );
}
