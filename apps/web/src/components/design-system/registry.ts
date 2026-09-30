import type { ReactNode } from 'react';

import { BadgesSection } from './badges-section';
import { ButtonsSection } from './buttons-section';
import { FeedbackSection } from './feedback-section';
import { FormsSection } from './forms-section';
import { IconsSection } from './icons-section';
import { OverlaysSection } from './overlays-section';
import type { PreviewSectionSlug } from './section-slugs';
import { SizesSection } from './sizes-section';
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
  { slug: 'overlays', title: 'Overlays', render: OverlaysSection },
  { slug: 'feedback', title: 'Feedback', render: FeedbackSection },
];

export const previewSection = (slug: string): PreviewSection | undefined =>
  PREVIEW_SECTIONS.find((section) => section.slug === slug);
