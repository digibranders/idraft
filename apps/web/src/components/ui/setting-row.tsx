import { Field as FieldPrimitive } from '@base-ui/react/field';
import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';

export interface SettingRowProps extends Omit<FieldPrimitive.Root.Props, 'className' | 'render' | 'children'> {
  /** The name of the setting, never "On" or "Enabled". */
  label: string;
  description?: string | undefined;
  /** The `Switch`. The row names it with `label` and describes it with `description`. */
  control: ReactElement;
  /** Why the last change was not saved. The caller also announces it (10-forms.md section 13.3). */
  error?: string | null | undefined;
  className?: string | undefined;
}

/**
 * The row of a setting that saves at once: name and description on the left, the switch on the right, and
 * a line below it when a save failed. A section holds either rows like this or a form with a save bar,
 * never both (10-forms.md section 8).
 */
export function SettingRow({ label, description, control, error, className, ...props }: SettingRowProps): ReactElement {
  return (
    <FieldPrimitive.Root data-slot="setting-row" {...props} className={cn('flex flex-col gap-1.5 py-3', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col">
          <FieldPrimitive.Label className="type-body text-foreground">{label}</FieldPrimitive.Label>
          {description === undefined ? null : (
            <FieldPrimitive.Description className="type-meta">{description}</FieldPrimitive.Description>
          )}
        </div>
        {control}
      </div>
      {/* A second description, so the switch is described by the failure as well */}
      {error ? (
        <FieldPrimitive.Description className="type-meta text-negative-text">{error}</FieldPrimitive.Description>
      ) : null}
    </FieldPrimitive.Root>
  );
}
