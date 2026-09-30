import type { ReactNode } from 'react';

/** A titled group of examples inside a preview section. */
export function SpecimenGroup({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="type-section-title">{title}</h2>
        {note ? <p className="type-meta">{note}</p> : null}
      </header>
      {children}
    </section>
  );
}

/** One row of examples with the name of what varies on the left. */
export function SpecimenRow({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="w-full shrink-0 type-label sm:w-40">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}
