'use client';

import { useCallback, useState, type ReactNode } from 'react';

import { SpecimenGroup, SpecimenRow } from './specimen';
import { TableScroll } from './table-scroll';
import { Truncate } from '@/components/ui/truncate';
import { TYPE_STYLES } from '@/lib/design/class-names';

type TypeStyle = (typeof TYPE_STYLES)[number];

/** Every type utility with a sample of what it is for. TypeScript fails the build when one is missing. */
const SAMPLES: Readonly<Record<TypeStyle, { className: string; sample: string; use: string }>> = {
  'page-title': { className: 'type-page-title', sample: 'Rank Tracker', use: 'The h1 of a page' },
  'inspector-title': {
    className: 'type-inspector-title',
    sample: 'best crm for startups',
    use: 'The title of the inspector',
  },
  'section-title': { className: 'type-section-title', sample: 'Visibility and mention rate', use: 'Panels, dialogs' },
  'subsection-title': { className: 'type-subsection-title', sample: 'Fix 2 fields to save', use: 'Inside a panel' },
  body: { className: 'type-body', sample: 'Tracked for SEO rank and AI share of voice.', use: 'Text and controls' },
  'input-touch': {
    className: 'type-input-touch',
    sample: 'ana@digibranders.test',
    use: 'Text fields below 768 px, so iOS does not zoom on focus',
  },
  'body-strong': { className: 'type-body-strong', sample: 'Add keywords', use: 'Button labels, the chosen option' },
  'inline-strong': {
    className: 'type-inline-strong',
    sample: 'Fynix',
    use: 'Weight only, for a span in running text: the own brand in an answer',
  },
  prose: {
    className: 'type-prose',
    sample: 'Visibility is the share of tracked keywords for which the site is in the top 10.',
    use: 'Running text of more than two lines',
  },
  table: { className: 'type-table', sample: 'crm pricing comparison', use: 'Table cells, 12 / 16 in every table' },
  'table-strong': { className: 'type-table-strong', sample: 'Total', use: 'A strong table cell, such as a total row' },
  'table-header': {
    className: 'type-table-header',
    sample: 'Search volume',
    use: 'Table column headers: capitals, 0.04em, tertiary',
  },
  meta: { className: 'type-meta', sample: 'Checked 2 hours ago', use: 'Helper text, secondary lines' },
  label: { className: 'type-label', sample: 'Monthly limit', use: 'Field labels' },
  micro: { className: 'type-micro', sample: 'Commercial', use: 'Badges, counters' },
  metric: { className: 'type-metric', sample: '34.2%', use: 'The value of a metric' },
  'metric-sm': { className: 'type-metric-sm', sample: '1,204', use: 'Metrics in dense strips' },
  mono: { className: 'type-mono', sample: '/blog/how-to-choose-a-crm', use: 'URLs, identifiers, code' },
  kbd: { className: 'type-kbd', sample: 'Ctrl K', use: 'Key caps' },
};

const px = (value: string): string => `${String(Math.round(Number.parseFloat(value) * 100) / 100)}`;

/** One utility: its sample, and the size, line height and weight the browser gives it. */
function TypeRow({ name }: { name: TypeStyle }): ReactNode {
  const { className, sample, use } = SAMPLES[name];
  const [spec, setSpec] = useState('');
  // A ref callback reads the computed style once the sample is in the document
  const measure = useCallback((node: HTMLSpanElement | null): void => {
    if (!node) return;
    const style = getComputedStyle(node);
    if (style.fontSize === '') return;
    setSpec(`${px(style.fontSize)} / ${px(style.lineHeight)} px, weight ${style.fontWeight}`);
  }, []);
  return (
    <tr className="border-t border-border-subtle">
      <th scope="row" className="py-2 pr-4 text-left align-baseline font-mono text-foreground">
        {className}
      </th>
      <td className="py-2 pr-4 align-baseline">
        <span ref={measure} className={className}>
          {sample}
        </span>
      </td>
      <td className="py-2 pr-4 align-baseline num text-foreground-tertiary">{spec === '' ? 'Not read yet' : spec}</td>
      <td className="py-2 align-baseline text-foreground-tertiary">{use}</td>
    </tr>
  );
}

export function TypographySection(): ReactNode {
  return (
    <>
      <SpecimenGroup
        title="Type utilities"
        note="03 section 2. Size, line height and weight come together. Table text is 12 / 16 with capital headers (owner decisions of 2026-10-29)."
      >
        <TableScroll label="Type utilities">
          <table className="w-full border-collapse type-table">
            <caption className="sr-only">The type utilities with a sample and their measured values</caption>
            <thead>
              <tr>
                {['Utility', 'Sample', 'Measured', 'Used for'].map((heading) => (
                  <th key={heading} scope="col" className="h-row-header pr-4 text-left type-table-header">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TYPE_STYLES.map((name) => (
                <TypeRow key={name} name={name} />
              ))}
            </tbody>
          </table>
        </TableScroll>
      </SpecimenGroup>

      <SpecimenGroup title="Numbers" note="Every number that is compared with another uses tabular figures.">
        <SpecimenRow label="num, without">
          <div className="flex flex-col num type-table">
            <span>1,111.10</span>
            <span>8,888.80</span>
          </div>
          <div className="flex flex-col type-table">
            <span>1,111.10</span>
            <span>8,888.80</span>
          </div>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Truncate" note="The tooltip appears only when the text is cut.">
        <SpecimenRow label="Fits, cut, shortened in the middle">
          <div className="w-40 type-table">
            <Truncate text="crm pricing" />
          </div>
          <div className="w-40 type-table">
            <Truncate text="What is the best CRM for a 20-person startup that sells to enterprises?" />
          </div>
          <div className="w-56 type-mono">
            <Truncate text="/blog/2026/guides/how-to-choose-a-crm" display="/blog/…/how-to-choose-a-crm" />
          </div>
        </SpecimenRow>
      </SpecimenGroup>
    </>
  );
}
