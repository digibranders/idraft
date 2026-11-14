import { useId, type ReactElement, type ReactNode } from 'react';

/**
 * One titled section of a tab (plan section 3.5): a region named by its own `h2`, so a person using a screen reader
 * moves between the sections, and the page keeps one `h1`. The section's body is its children.
 */
export function SectionFrame({ title, children }: { title: string; children?: ReactNode }): ReactElement {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="type-section-title">
        {title}
      </h2>
      {children}
    </section>
  );
}
