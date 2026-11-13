'use client';

import type { ReactElement } from 'react';

import { SpecimenGroup } from './specimen';

/** The gallery of the layout core. Filled by WP-15 (task T11), on the real provider and the mock. */
export function LayoutsSection(): ReactElement {
  return (
    <SpecimenGroup title="Layouts" note="Filled by WP-15.">
      <p className="type-body">The layout grid and the card frame are shown here.</p>
    </SpecimenGroup>
  );
}
