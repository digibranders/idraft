'use client';

import { Select as SelectPrimitive } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import type { ReactElement } from 'react';

import { Icon } from './icon';
import { inputVariants, type InputSize } from './input-variants';
import { POPUP_COLLISION, POPUP_GROUP_LABEL, POPUP_ITEM, POPUP_MOTION, POPUP_SURFACE } from './popup-styles';
import { cn } from '@/lib/utils';

export interface SelectOption<TValue extends string> {
  value: TValue;
  label: string;
  /** A second line under the label. */
  description?: string | undefined;
  /** Options with the same group name are listed together under it. */
  group?: string | undefined;
  disabled?: boolean | undefined;
}

export interface SelectProps<TValue extends string> extends Omit<
  SelectPrimitive.Trigger.Props,
  'className' | 'render' | 'children' | 'value' | 'defaultValue'
> {
  value: TValue | null;
  onValueChange: (value: TValue) => void;
  /** Shown while nothing is chosen: "Select a workload". */
  placeholder: string;
  options: readonly SelectOption<TValue>[];
  size?: InputSize | undefined;
  /** Sent with a native form submit. A react-hook-form field does not need it. */
  name?: string | undefined;
  required?: boolean | undefined;
  /** Layout only. The width of a field is set on `Field`. */
  className?: string | undefined;
}

interface OptionGroup<TValue extends string> {
  name: string | undefined;
  options: SelectOption<TValue>[];
}

/** Consecutive options with the same group name form one group; the order of the options is kept. */
function grouped<TValue extends string>(options: readonly SelectOption<TValue>[]): OptionGroup<TValue>[] {
  const groups: OptionGroup<TValue>[] = [];
  for (const option of options) {
    const last = groups[groups.length - 1];
    if (last && last.name === option.group) last.options.push(option);
    else groups.push({ name: option.group, options: [option] });
  }
  return groups;
}

function Option<TValue extends string>({ option }: { option: SelectOption<TValue> }): ReactElement {
  return (
    <SelectPrimitive.Item
      value={option.value}
      label={option.label}
      disabled={option.disabled}
      className={cn(POPUP_ITEM, option.description !== undefined && 'h-auto items-start py-1.5')}
    >
      <span className="flex h-5 w-4 shrink-0 items-center justify-center">
        <SelectPrimitive.ItemIndicator className="flex">
          <Icon icon={Check} size="sm" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <span className="flex min-w-0 flex-col">
        <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
        {option.description === undefined ? null : <span className="type-meta">{option.description}</span>}
      </span>
    </SelectPrimitive.Item>
  );
}

/**
 * One choice from about 5 to 15 known options (10-forms.md section 6.2). The list opens below the trigger
 * like every other popover, so the label and the fields around it stay visible. Fewer options that are
 * worth seeing side by side are a `SegmentedControl` or a `RadioGroup`; native `<select>` is not used.
 */
export function Select<TValue extends string>({
  value,
  onValueChange,
  placeholder,
  options,
  size = 'md',
  name,
  required,
  disabled,
  className,
  ...props
}: SelectProps<TValue>): ReactElement {
  return (
    <SelectPrimitive.Root<TValue>
      items={options}
      value={value}
      // The list offers no empty option, so there is no way back to "nothing chosen"
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      name={name}
      required={required}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        data-slot="select"
        {...props}
        className={cn(
          inputVariants({ variant: 'outline', size }),
          'flex cursor-default items-center justify-between gap-2 text-left',
          className,
        )}
      >
        <SelectPrimitive.Value
          placeholder={placeholder}
          className="min-w-0 truncate data-placeholder:text-foreground-tertiary"
        />
        <SelectPrimitive.Icon className="flex shrink-0 text-foreground-muted">
          <Icon icon={ChevronDown} size="sm" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          alignItemWithTrigger={false}
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          collisionAvoidance={POPUP_COLLISION}
          className="z-(--z-dropdown)"
        >
          <SelectPrimitive.Popup
            data-slot="select-popup"
            className={cn(
              'max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto p-1',
              POPUP_SURFACE,
              POPUP_MOTION,
            )}
          >
            <SelectPrimitive.List>
              {grouped(options).map((group, index) =>
                group.name === undefined ? (
                  group.options.map((option) => <Option key={option.value} option={option} />)
                ) : (
                  <SelectPrimitive.Group key={`${String(index)}:${group.name}`}>
                    <SelectPrimitive.GroupLabel className={POPUP_GROUP_LABEL}>{group.name}</SelectPrimitive.GroupLabel>
                    {group.options.map((option) => (
                      <Option key={option.value} option={option} />
                    ))}
                  </SelectPrimitive.Group>
                ),
              )}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
