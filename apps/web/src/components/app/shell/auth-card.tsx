import { useId, type ComponentProps, type ReactNode, type Ref } from 'react';

import { cn } from '@/lib/utils';

export interface AuthCardProps extends Omit<ComponentProps<'section'>, 'title'> {
  /** Shown above the panel. Not a link: without a session there is nowhere to go. */
  productName: string;
  /** The page's only `h1`. */
  title: string;
  /** One sentence, at most two lines: what happens next. */
  description: ReactNode;
  /** At most two standalone `TextLink`s, below the panel. */
  links?: ReactNode;
  /** The form, or the confirmation that replaces it. */
  children: ReactNode;
  /**
   * The heading, which can take focus: when the panel changes to a step without a field, focus moves to
   * it so the change is read (20-accessibility.md section 4.3).
   */
  titleRef?: Ref<HTMLHeadingElement> | undefined;
}

/**
 * The one panel of an auth screen (T7, 24-page-templates.md section 11): the product name, a 400 px panel
 * with the heading, one sentence and the form, and up to two links below it. Below 640 px the panel's
 * border, fill and padding go, so the form uses the whole width of a phone.
 */
export function AuthCard({
  productName,
  title,
  description,
  links,
  children,
  titleRef,
  className,
  ...props
}: AuthCardProps): ReactNode {
  const titleId = useId();
  return (
    <div className="flex w-full max-w-dialog-sm flex-col gap-6">
      <p className="text-center type-section-title text-foreground">{productName}</p>
      <section
        aria-labelledby={titleId}
        {...props}
        className={cn('flex flex-col gap-6 sm:rounded-lg sm:border sm:border-border sm:bg-surface sm:p-8', className)}
      >
        <header className="flex flex-col gap-2">
          <h1 ref={titleRef} id={titleId} tabIndex={-1} className="type-page-title text-foreground outline-none">
            {title}
          </h1>
          <p className="type-body text-foreground-secondary">{description}</p>
        </header>
        {children}
      </section>
      {links === undefined ? null : <div className="flex flex-col items-center gap-4">{links}</div>}
    </div>
  );
}
