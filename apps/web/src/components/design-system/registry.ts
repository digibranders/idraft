import type { ReactNode } from 'react';

import { BadgesSection } from './badges-section';
import { ButtonsSection } from './buttons-section';
import { ChartGridsSection } from './chart-grids-section';
import { ControlsSection } from './controls-section';
import { DomainsFeedsSection } from './domains-feeds-section';
import { ChartPartsSection } from './chart-parts-section';
import { ChartsSection } from './charts-section';
import { DataDisplaySection } from './data-display-section';
import { FeedbackSection } from './feedback-section';
import { FiltersSection } from './filters-section';
import { FormsSection } from './forms-section';
import { IconsSection } from './icons-section';
import { InspectorPreviewSection } from './inspector-section';
import { MetricPartsSection } from './metric-parts-section';
import { OverlaysSection } from './overlays-section';
import type { PreviewSectionSlug } from './section-slugs';
import { SizesSection } from './sizes-section';
import { TablesSection } from './tables-section';
import { TokensSection } from './tokens-section';
import { TypographySection } from './typography-section';

export interface PreviewSection {
  readonly slug: PreviewSectionSlug;
  readonly title: string;
  readonly render: () => ReactNode;
}

/** The sections of the component preview, in the order the index lists them (26 section 10). */
export const PREVIEW_SECTIONS: readonly PreviewSection[] = [
  { slug: 'tokens', title: 'Color tokens', render: TokensSection },
  { slug: 'typography', title: 'Typography', render: TypographySection },
  { slug: 'sizes', title: 'Spacing and sizes', render: SizesSection },
  { slug: 'icons', title: 'Icons', render: IconsSection },
  { slug: 'buttons', title: 'Buttons and controls', render: ButtonsSection },
  { slug: 'forms', title: 'Forms', render: FormsSection },
  { slug: 'badges', title: 'Badges', render: BadgesSection },
  { slug: 'tables', title: 'Tables', render: TablesSection },
  { slug: 'filters', title: 'Filters', render: FiltersSection },
  { slug: 'inspector', title: 'Inspector', render: InspectorPreviewSection },
  { slug: 'data-display', title: 'Data display', render: DataDisplaySection },
  { slug: 'charts', title: 'Charts', render: ChartsSection },
  { slug: 'chart-parts', title: 'Chart parts', render: ChartPartsSection },
  { slug: 'overlays', title: 'Overlays', render: OverlaysSection },
  { slug: 'feedback', title: 'Feedback', render: FeedbackSection },
  { slug: 'metric-parts', title: 'Metrics and engines', render: MetricPartsSection },
  { slug: 'chart-grids', title: 'Chart grids', render: ChartGridsSection },
  { slug: 'domains-feeds', title: 'Domains, feeds and stepping', render: DomainsFeedsSection },
  { slug: 'controls', title: 'Lists, views and dates', render: ControlsSection },
];

export const previewSection = (slug: string): PreviewSection | undefined =>
  PREVIEW_SECTIONS.find((section) => section.slug === slug);
