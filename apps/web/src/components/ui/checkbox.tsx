import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Check, Minus } from 'lucide-react';
import { useId, type ReactElement } from 'react';

import { Icon } from './icon';
import { cn } from '@/lib/utils';

export interface CheckboxProps extends Omit<
  CheckboxPrimitive.Root.Props,
  'className' | 'render' | 'children' | 'checked' | 'defaultChecked' | 'indeterminate'
> {
  /** `indeterminate` only for a parent that stands for children of which some are checked. */
  checked: boolean | 'indeterminate';
  /** The visible label, or the name read out in a table cell ("Select crm pricing"). */
  label: string;
  labelDisplay?: 'visible' | 'visually-hidden' | undefined;
  /** One line under the label. */
  description?: string | undefined;
  /** Layout only. */
  className?: string | undefined;
}

/**
 * A boolean that takes effect when its form is saved, or a row selection (09-buttons-controls.md section
 * 8.1). The box is 16 px inside a 24 px target, and the label extends the target. A setting that takes
 * effect at once is a `Switch`.
 */
export function Checkbox({
  checked,
  label,
  labelDisplay = 'visible',
  description,
  className,
  disabled,
  ...props
}: CheckboxProps): ReactElement {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  const indeterminate = checked === 'indeterminate';
  return (
    <div data-slot="checkbox" className={cn('flex min-w-0 flex-col', className)}>
      <label
        className={cn('group/checkbox flex items-start gap-2', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}
      >
        <span className="flex size-6 shrink-0 items-center justify-center">
          <CheckboxPrimitive.Root
            aria-labelledby={labelId}
            aria-describedby={description === undefined ? undefined : descriptionId}
            {...props}
            checked={checked === true}
            indeterminate={indeterminate}
            disabled={disabled}
            className="flex size-4 items-center justify-center rounded-sm border border-border-strong bg-surface text-primary-foreground transition-colors duration-(--duration-fast) ease-standard group-hover/checkbox:not-data-disabled:not-data-checked:not-data-indeterminate:bg-surface-hover focus-visible:focus-ring data-checked:border-primary data-checked:bg-primary group-hover/checkbox:not-data-disabled:data-checked:bg-primary-hover data-disabled:border-border data-disabled:bg-surface-disabled data-disabled:data-checked:border-transparent data-disabled:data-checked:bg-foreground-disabled data-indeterminate:border-primary data-indeterminate:bg-primary group-hover/checkbox:not-data-disabled:data-indeterminate:bg-primary-hover data-disabled:data-indeterminate:border-transparent data-disabled:data-indeterminate:bg-foreground-disabled data-invalid:not-data-checked:border-negative-solid"
          >
            <CheckboxPrimitive.Indicator className="flex data-unchecked:hidden">
              <Icon icon={indeterminate ? Minus : Check} size="xs" />
            </CheckboxPrimitive.Indicator>
          </CheckboxPrimitive.Root>
        </span>
        <span
          id={labelId}
          className={cn(
            labelDisplay === 'visible' ? 'py-0.5 type-body' : 'sr-only',
            disabled ? 'text-foreground-disabled' : 'text-foreground',
          )}
        >
          {label}
        </span>
      </label>
      {description === undefined ? null : (
        // Aligned to the left edge of the label: the 24 px target plus the 8 px gap
        <span id={descriptionId} className="pl-8 type-meta">
          {description}
        </span>
      )}
    </div>
  );
}
