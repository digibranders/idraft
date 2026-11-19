'use client';

import type { ReactElement, ReactNode } from 'react';

import { Truncate } from '@/components/ui/truncate';

/** A titled section of the Changes tab: the heading and one line of meta on the left, the controls on the right. */
export function ChangesPanel({
  id,
  title,
  meta,
  controls,
  children,
}: {
  id: string;
  title: string;
  meta: string;
  controls?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
          <h2 id={id} className="type-subsection-title">
            {title}
          </h2>
          <p className="type-meta text-foreground-secondary">{meta}</p>
        </div>
        {controls === undefined ? null : <div className="flex flex-wrap items-center gap-2">{controls}</div>}
      </div>
      {children}
    </section>
  );
}

/** A page in a table cell: its path, which opens the page's inspector. */
export function PageButton({ path, onOpen }: { path: string; onOpen: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block max-w-64 rounded-sm text-left outline-none hover:underline focus-visible:focus-ring"
    >
      <Truncate text={path} className="type-table text-foreground" />
    </button>
  );
}
