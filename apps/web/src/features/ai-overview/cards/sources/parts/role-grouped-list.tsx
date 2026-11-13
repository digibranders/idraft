'use client';

import { useId, type ReactElement } from 'react';

import { BarList, type ComparisonRow } from '@/components/app/chart/bar-list';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import type { Density } from '@/lib/tables/table-state';

/**
 * The "By role" view of the top cited domains card (WP-37 plan T5, CH-34): one section per role, each with the role's
 * citation units and share (words, never colour alone), the listed domains of the role as the same bars as the Ranked
 * view, and what the role holds in domains that are not listed. It holds no string: the card passes every word.
 */

export interface RoleSectionView {
  role: string;
  /** The role's name in words: "Own", "Competitor", "Third party". */
  title: string;
  /** "16.3% of citation units, 3,000 of 18,420 units". */
  totalText: string;
  /** Names the section's list: "Third party domains by citation units". */
  caption: string;
  rows: readonly ComparisonRow[];
  /** Why the section has no list; used only when `rows` is empty. */
  emptyText: string;
  /** "9,808 units in domains not listed"; `null` when the listed domains hold the whole role. */
  remainderText: string | null;
}

export interface RoleGroupedListProps {
  sections: readonly RoleSectionView[];
  /** Every bar of every section is drawn on one scale from 0, so a bar in one section compares with another. */
  max: number | undefined;
  /** The headers of the list and the table, which the bars do not draw. */
  headers: { label: string; value: string; context: string };
  density: Density;
}

function RoleSection({
  section,
  max,
  headers,
  density,
}: { section: RoleSectionView } & Pick<RoleGroupedListProps, 'max' | 'headers' | 'density'>): ReactElement {
  const titleId = useId();
  return (
    <div role="group" aria-labelledby={titleId} className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 id={titleId} data-slot="role-section-title" className="type-body-strong">
          {section.title}
        </h3>
        <p data-slot="role-section-total" className="num type-meta text-foreground-secondary">
          {section.totalText}
        </p>
      </div>
      {section.rows.length === 0 ? (
        <p className="type-meta text-foreground-secondary">{section.emptyText}</p>
      ) : (
        <BarList
          mode="comparison"
          rows={section.rows}
          caption={section.caption}
          labelHeader={headers.label}
          valueHeader={headers.value}
          contextHeader={headers.context}
          limit={section.rows.length}
          density={density}
          {...(max === undefined ? {} : { max })}
        />
      )}
      {section.remainderText === null ? null : (
        <p className="num type-meta text-foreground-secondary">{section.remainderText}</p>
      )}
    </div>
  );
}

/** The sections one under the other: three short lists read better stacked than squeezed side by side at card width. */
export function RoleGroupedList({ sections, max, headers, density }: RoleGroupedListProps): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      {sections.map((section) => (
        <RoleSection key={section.role} section={section} max={max} headers={headers} density={density} />
      ))}
    </div>
  );
}

/** One line of the Table view and the export: a listed domain or the units of a role in domains not listed. */
export interface RoleLine {
  id: string;
  role: string;
  label: string;
  share: string;
  counts: string;
}

export function RoleGroupedTable({
  caption,
  headers,
  lines,
  emptyText,
}: {
  caption: string;
  headers: { role: string; label: string; share: string; counts: string };
  lines: readonly RoleLine[];
  emptyText: string;
}): ReactElement {
  const columns: PlainColumn<RoleLine>[] = [
    { id: 'role', header: headers.role, cell: (line) => line.role },
    { id: 'label', header: headers.label, cell: (line) => line.label },
    { id: 'share', header: headers.share, cell: (line) => line.share },
    { id: 'counts', header: headers.counts, cell: (line) => line.counts },
  ];
  return (
    <PlainTable<RoleLine>
      caption={caption}
      columns={columns}
      rows={lines}
      rowKey={(line) => line.id}
      status="ready"
      errorState={null}
      emptyText={emptyText}
    />
  );
}
