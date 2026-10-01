import type { ReactElement, ReactNode } from 'react';

export interface KeyValue {
  id: string;
  label: string;
  value: ReactNode;
}

/**
 * The read view of a section's settings: one row per fact, the label in the first two fifths and the
 * value beside it, wrapping long values such as a URL.
 */
export function KeyValues({ items }: { items: readonly KeyValue[] }): ReactElement {
  return (
    <dl className="grid grid-cols-5 gap-x-4 gap-y-2">
      {items.map((item) => (
        <div key={item.id} className="col-span-5 grid grid-cols-subgrid">
          <dt className="col-span-2 type-label text-foreground-tertiary">{item.label}</dt>
          <dd className="col-span-3 min-w-0 type-body wrap-anywhere text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
