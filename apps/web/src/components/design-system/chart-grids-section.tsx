import type { ReactNode } from 'react';

import { SpecimenGroup } from './specimen';

export function ChartGridsSection(): ReactNode {
  return (
    <>
      <SpecimenGroup title="Heat-map table">
        <p className="type-body">
          Shows a rate by row and column on one shared set of bins. Cells with too few answers are hatched instead of
          coloured, and topic rows open into their prompts as tree rows.
        </p>
      </SpecimenGroup>

      <SpecimenGroup title="Small multiples">
        <p className="type-body">
          Shows the same measure in a grid of small charts. Every chart shares one ceiling, and a crosshair moved over
          one chart appears on all of them.
        </p>
      </SpecimenGroup>
    </>
  );
}
