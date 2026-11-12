'use client';

import type { ReactNode } from 'react';

import { SpecimenGroup } from './specimen';

/** The chart parts of the AI visibility package (WP-04), each in both themes and both densities. */
export function ChartsSection(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <SpecimenGroup title="Chart frame" note="15-data-visualization.md">
        <p className="type-body">The chart parts are added here as each one is built.</p>
      </SpecimenGroup>
    </div>
  );
}
