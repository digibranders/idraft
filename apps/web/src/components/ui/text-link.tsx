import { cloneElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

type AnchorProps = Omit<ComponentProps<'a'>, 'href' | 'children' | 'className'>;
type Destination =
  | { href: string; render?: undefined }
  | {
      /**
       * The link to render instead of a plain anchor. Pass the router's link (`<Link href="..." />`) from an
       * application component for navigation inside the app: primitives do not import the router.
       */
      render: ReactElement<{ className?: string | undefined; children?: ReactNode }>;
      href?: undefined;
    };

export type TextLinkProps = Destination &
  AnchorProps & {
    children: ReactNode;
    /**
     * `inline`: a link inside a sentence. It is underlined at rest, because the link color alone does not
     * stand out from the text around it by 3:1 (WCAG 1.4.1).
     * `standalone` (default): a link that stands on its own, such as "View all", a back link or a link in a
     * meta line. Its position says it is a link, and the underline appears on hover and on focus.
     */
    variant?: 'standalone' | 'inline' | undefined;
    /** `inherit` for back links and links in a meta line, which take the color of the text around them. */
    tone?: 'link' | 'inherit' | undefined;
    className?: string | undefined;
  };

/** A text link (09-buttons-controls.md section 2.7). An action that does not navigate is a `Button` with `variant="link"`. */
export function TextLink({
  href,
  render,
  children,
  variant = 'standalone',
  tone = 'link',
  className,
  ...props
}: TextLinkProps): ReactElement {
  const classes = cn(
    'rounded-xs underline-offset-2 focus-visible:focus-ring',
    variant === 'inline' ? 'underline' : 'hover:underline focus-visible:underline',
    tone === 'link' ? 'text-link' : 'text-inherit',
    className,
  );
  if (render) {
    const merged = { 'data-slot': 'text-link', ...props, className: cn(render.props.className, classes) };
    return cloneElement(render, merged as object, children);
  }
  return (
    <a data-slot="text-link" {...props} href={href} className={classes}>
      {children}
    </a>
  );
}
