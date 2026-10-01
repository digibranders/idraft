'use client';

import { useState, type ReactNode } from 'react';

import { SpecimenGroup } from './specimen';
import { FilterBar } from '@/components/app/filters/filter-bar';
import type { FilterField, FilterValues } from '@/components/app/filters/types';
import { TEXT_OPERATORS } from '@/lib/filters/filter-values';
import { formatInteger } from '@/lib/format';

/** The keyword filters of 13-filters-search.md section 4, with sample facet counts. */
const FIELDS: readonly FilterField[] = [
  { id: 'kw', kind: 'text', label: 'Keyword', operators: TEXT_OPERATORS },
  {
    id: 'intent',
    kind: 'enum',
    label: 'Intent',
    multi: true,
    options: [
      { value: 'commercial', label: 'Commercial', count: 1204 },
      { value: 'informational', label: 'Informational', count: 2390 },
      { value: 'transactional', label: 'Transactional', count: 611 },
      { value: 'navigational', label: 'Navigational', count: 87 },
    ],
  },
  {
    id: 'serp',
    kind: 'enum',
    label: 'SERP feature',
    multi: true,
    options: [
      'AI Overview',
      'Featured snippet',
      'People also ask',
      'Local pack',
      'Images',
      'Videos',
      'Top stories',
      'Shopping',
      'Sitelinks',
      'Knowledge panel',
    ].map((label) => ({ value: label.toLowerCase().replaceAll(' ', '_'), label })),
  },
  {
    id: 'device',
    kind: 'enum',
    label: 'Device',
    multi: false,
    options: [
      { value: 'desktop', label: 'Desktop' },
      { value: 'mobile', label: 'Mobile' },
    ],
  },
  { id: 'vol', kind: 'range', label: 'Volume', bounds: { min: 0, max: 10_000_000 } },
  { id: 'kd', kind: 'range', label: 'KD', bounds: { min: 0, max: 100 } },
];

const APPLIED: FilterValues = {
  intent: { kind: 'enum', values: ['commercial', 'transactional'] },
  vol: { kind: 'range', min: 1000, max: null },
  kw: { kind: 'text', operator: 'contains', text: 'crm' },
};

function SampleBar({ initial, count }: { initial: FilterValues; count?: boolean }): ReactNode {
  const [values, setValues] = useState<FilterValues>(initial);
  const applied = Object.keys(values).length;
  return (
    <FilterBar
      fields={FIELDS}
      values={values}
      onChange={setValues}
      trailing={
        count === true ? (
          <p className="num type-meta">{`${formatInteger(4812 - applied * 1100)} keywords`}</p>
        ) : undefined
      }
    />
  );
}

export function FiltersSection(): ReactNode {
  return (
    <>
      <SpecimenGroup
        title="FilterBar"
        note="13 sections 2 and 3. A chip per applied filter opens its editor; multi-choice editors apply with Apply or Enter, a single choice at once, and Escape discards. SERP feature has more than 8 options, so its list has a search."
      >
        <SampleBar initial={APPLIED} />
      </SpecimenGroup>
      <SpecimenGroup
        title="No filters, with a result count"
        note="13 section 2. Clear filters shows only while a chip is applied."
      >
        <SampleBar initial={{}} count />
      </SpecimenGroup>
    </>
  );
}
