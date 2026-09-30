import { Field as FieldPrimitive } from '@base-ui/react/field';
import { Fieldset as FieldsetPrimitive } from '@base-ui/react/fieldset';
import { CircleX } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { Icon } from './icon';
import { cn } from '@/lib/utils';

/** Widths follow the expected content, not the container (10-forms.md section 3). All are full width below 640 px. */
export type FieldWidth = 'short' | 'date' | 'medium' | 'long' | 'full';

const WIDTH_CLASS: Readonly<Record<FieldWidth, string>> = {
  short: cn('w-full sm:w-30'),
  date: cn('w-full sm:w-40'),
  medium: cn('w-full sm:w-60'),
  long: cn('w-full sm:w-90'),
  full: cn('w-full'),
};

export interface FieldProps extends Omit<FieldPrimitive.Root.Props, 'className' | 'render'> {
  width?: FieldWidth | undefined;
  className?: string | undefined;
}

/**
 * One labeled control: label, control, then the helper text or the error (10-forms.md section 2). Base UI
 * generates the ids and writes `htmlFor`, `aria-describedby` and `aria-invalid`, so no part does it by hand.
 * Pass `invalid` when the form library knows the field is wrong.
 */
export function Field({ width = 'full', className, ...props }: FieldProps): ReactElement {
  return (
    <FieldPrimitive.Root
      data-slot="field"
      {...props}
      className={cn('flex min-w-0 flex-col gap-1.5', WIDTH_CLASS[width], className)}
    />
  );
}

export interface FieldLabelProps extends Omit<FieldPrimitive.Label.Props, 'children' | 'className' | 'render'> {
  /** Names the value, not the action: sentence case, no colon, four words at most. */
  children: string;
  /** The marker of an optional field, "(optional)", from the catalog. Required fields have no marker. */
  optional?: string | undefined;
  /** `visually-hidden` for inline forms, where a placeholder or an icon shows what the field is. */
  display?: 'visible' | 'visually-hidden' | undefined;
  className?: string | undefined;
}

export function FieldLabel({
  children,
  optional,
  display = 'visible',
  className,
  ...props
}: FieldLabelProps): ReactElement {
  return (
    <FieldPrimitive.Label
      data-slot="field-label"
      {...props}
      className={cn(display === 'visible' ? 'type-label' : 'sr-only', className)}
    >
      {children}
      {/* The space is a text node of the label itself, so every name computation keeps it */}
      {optional === undefined ? null : ' '}
      {optional === undefined ? null : <span className="type-meta">{optional}</span>}
    </FieldPrimitive.Label>
  );
}

export interface FieldDescriptionProps extends Omit<FieldPrimitive.Description.Props, 'className' | 'render'> {
  /** A format, a constraint or a consequence, in one line. */
  children: ReactNode;
  className?: string | undefined;
}

/**
 * The helper text under a control. While the field shows an error, render `FieldError` in its place, not
 * both: the field keeps one line and one current description (10-forms.md section 2.2).
 */
export function FieldDescription({ className, ...props }: FieldDescriptionProps): ReactElement {
  return <FieldPrimitive.Description data-slot="field-description" {...props} className={cn('type-meta', className)} />;
}

export interface FieldErrorProps extends Omit<
  FieldPrimitive.Error.Props,
  'children' | 'className' | 'render' | 'match'
> {
  /** Says what to do and states the constraint (10-forms.md section 19). */
  message: string;
  className?: string | undefined;
}

/** The error line under a control. Color is not the only cue: the icon and the text carry it too. */
export function FieldError({ message, className, ...props }: FieldErrorProps): ReactElement {
  return (
    <FieldPrimitive.Error
      data-slot="field-error"
      {...props}
      // The form library decides when a field is wrong, so the line shows whenever it is rendered
      match
      className={cn('flex items-start gap-1 type-meta text-negative-text', className)}
    >
      {/* 12 px icon centered on the 20 px first line */}
      <Icon icon={CircleX} size="xs" className="mt-1" />
      <span>{message}</span>
    </FieldPrimitive.Error>
  );
}

export interface FieldsetProps extends Omit<FieldsetPrimitive.Root.Props, 'className' | 'render'> {
  /** The name of the group, shown above it in the label style. */
  legend: string;
  children: ReactNode;
  className?: string | undefined;
}

/** A group of related controls under one name: two fields that are one concept, a set of checkboxes. */
export function Fieldset({ legend, children, className, ...props }: FieldsetProps): ReactElement {
  return (
    <FieldsetPrimitive.Root data-slot="fieldset" {...props} className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <FieldsetPrimitive.Legend className="type-label">{legend}</FieldsetPrimitive.Legend>
      {children}
    </FieldsetPrimitive.Root>
  );
}
