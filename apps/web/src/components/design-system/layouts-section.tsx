import Link from 'next/link';
import type { ReactNode } from 'react';

import { SpecimenGroup } from './specimen';
import { TextLink } from '@/components/ui/text-link';

/**
 * The layout core of WP-15 (docs/superpowers/plans/2026-11-13-ai-wp-15-layouts-core.md, task T11). The layout
 * grid reads and saves a layout, so it is drawn on the real provider and the mock API, and the preview layer may
 * not fetch or import a feature (eslint.config.mjs). The specimens live on a page of their own.
 */
export function LayoutsSection(): ReactNode {
  return (
    <SpecimenGroup
      title="Layout grid and card frame"
      note="WP-15. The grid of cards a person arranges: drag by the handle or by keyboard, set a width, hide a card, undo and save."
    >
      <p className="type-body">
        The specimens run the real layout provider on the mock API, so they sit on their own page: the live layout with
        Customize, Save, Cancel, Undo and Redo, and the states it keeps (loading, a failed read, refetching, empty, a
        picked up card and the one column drawer form).
      </p>
      <p className="type-body">
        <TextLink variant="inline" render={<Link href="/design-system/layouts-live" />}>
          Open the live layout specimens
        </TextLink>
      </p>
    </SpecimenGroup>
  );
}
