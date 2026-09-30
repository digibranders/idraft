import type { ReactNode } from 'react';

import { BadgesSection } from './badges-section';
import { ButtonsSection } from './buttons-section';
import { DisplaySection } from './display-section';
import { FormsSection } from './forms-section';
import { OverlaysSection } from './overlays-section';

export interface PreviewSection {
  readonly slug: string;
  readonly title: string;
  readonly render: () => ReactNode;
}

/** The sections of the component preview, in the order the index lists them (26 section 10). */
export const PREVIEW_SECTIONS: readonly PreviewSection[] = [
  { slug: 'buttons', title: 'Buttons', render: ButtonsSection },
  { slug: 'forms', title: 'Forms', render: FormsSection },
  { slug: 'overlays', title: 'Overlays and feedback', render: OverlaysSection },
  { slug: 'badges', title: 'Badges', render: BadgesSection },
  { slug: 'display', title: 'Icons and display', render: DisplaySection },
];

export const previewSection = (slug: string): PreviewSection | undefined =>
  PREVIEW_SECTIONS.find((section) => section.slug === slug);
