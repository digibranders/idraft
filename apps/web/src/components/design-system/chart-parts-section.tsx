'use client';

import type { ReactNode } from 'react';

import { SpecimenGroup } from './specimen';

/** The HTML chart parts of the AI visibility package (WP-05): bar list, share bar, step bars and interval bar. */
export function ChartPartsSection(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <SpecimenGroup title="Chart parts" note="15-data-visualization.md sections 5.1 and 5.2">
        <p className="type-body">
          The bar list, the stacked share bar, the step bars and the interval bar are shown here as each one is built.
        </p>
      </SpecimenGroup>
    </div>
  );
}
