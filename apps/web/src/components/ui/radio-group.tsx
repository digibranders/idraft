'use client';

import { Fieldset as FieldsetPrimitive } from '@base-ui/react/fieldset';
import { Radio as RadioPrimitive } from '@base-ui/react/radio';
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group';
import { useId, useImperativeHandle, useRef, type ReactElement, type Ref, type RefObject } from 'react';

import { cn } from '@/lib/utils';

/** What a form needs from a group to move focus into it. */
export interface FocusHandle {
  focus: () => void;
}

/**
 * Gives a form a way to focus a radio group: a group has no single element to focus, so focus goes to its
 * tab stop, which is the chosen radio, or the first one that is enabled while nothing is chosen. Returns
 * the ref for the element of the group.
 */
export function useRadioFocus(focusRef: Ref<FocusHandle> | undefined): RefObject<HTMLDivElement | null> {
  const group = useRef<HTMLDivElement>(null);
  useImperativeHandle(
    focusRef,
    () => ({
      focus: (): void => {
        const radios = [...(group.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])].filter(
          (radio) => radio.getAttribute('aria-disabled') !== 'true',
        );
        (radios.find((radio) => radio.getAttribute('aria-checked') === 'true') ?? radios[0])?.focus();
      },
    }),
    [],
  );
  return group;
}

export interface RadioOption<TValue extends string> {
  value: TValue;
  label: string;
  /** In a list: one line under the label. In cards: the sentence that says what the option means. */
  description?: string | undefined;
  disabled?: boolean | undefined;
}

export interface RadioGroupProps<TValue extends string> extends Omit<
  RadioGroupPrimitive.Props<TValue>,
  'className' | 'render' | 'children' | 'value' | 'defaultValue' | 'onValueChange'
> {
  /** The visible name of the group. */
  legend: string;
  /** `null` only when "no choice" is a valid answer in the schema. */
  value: TValue | null;
  onValueChange: (value: TValue) => void;
  /** 2 to 6 options in a list, 2 to 4 as cards. */
  options: readonly RadioOption<TValue>[];
  /** `cards` when each option needs a sentence of consequence. */
  presentation?: 'list' | 'cards' | undefined;
  /** Lets a form move focus into the group after a failed submit: `focusRef={field.ref}`. */
  focusRef?: Ref<FocusHandle> | undefined;
  className?: string | undefined;
}

const CIRCLE = cn(
  'flex size-4 items-center justify-center rounded-full border border-border-strong bg-surface transition-colors duration-(--duration-fast) ease-standard group-hover/radio:not-data-disabled:not-data-checked:bg-surface-hover data-checked:border-primary data-checked:bg-primary group-hover/radio:not-data-disabled:data-checked:bg-primary-hover data-disabled:border-border data-disabled:bg-surface-disabled data-disabled:data-checked:border-transparent data-disabled:data-checked:bg-foreground-disabled data-invalid:not-data-checked:border-negative-solid',
);

interface RadioRowProps<TValue extends string> {
  option: RadioOption<TValue>;
  cards: boolean;
  groupDisabled: boolean;
}

function RadioRow<TValue extends string>({ option, cards, groupDisabled }: RadioRowProps<TValue>): ReactElement {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  const disabled = groupDisabled || option.disabled === true;
  return (
    <label
      className={cn(
        'group/radio flex items-start gap-2',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        cards &&
          'rounded-md border border-border bg-surface p-3 has-focus-visible:focus-ring has-data-checked:border-primary-border has-data-checked:bg-surface-selected',
      )}
    >
      <span className="flex size-6 shrink-0 items-center justify-center">
        <RadioPrimitive.Root
          value={option.value}
          disabled={option.disabled}
          aria-labelledby={labelId}
          aria-describedby={option.description === undefined ? undefined : descriptionId}
          // On a card the ring is drawn around the whole card
          className={cn(CIRCLE, cards ? 'outline-none' : 'focus-visible:focus-ring')}
        >
          <RadioPrimitive.Indicator className="size-1.5 rounded-full bg-primary-foreground data-unchecked:hidden" />
        </RadioPrimitive.Root>
      </span>
      <span className="flex min-w-0 flex-col py-0.5">
        <span id={labelId} className={cn('type-body', disabled ? 'text-foreground-disabled' : 'text-foreground')}>
          {option.label}
        </span>
        {option.description === undefined ? null : (
          <span id={descriptionId} className="type-meta">
            {option.description}
          </span>
        )}
      </span>
    </label>
  );
}

/**
 * Exactly one choice from a few options, all visible (10-forms.md section 7). Arrow keys move and select,
 * Tab leaves the group. Short options that belong side by side are a `SegmentedControl`; more than 6 are a
 * `Select`.
 */
export function RadioGroup<TValue extends string>({
  legend,
  value,
  onValueChange,
  options,
  presentation = 'list',
  focusRef,
  className,
  ...props
}: RadioGroupProps<TValue>): ReactElement {
  const group = useRadioFocus(focusRef);
  return (
    <FieldsetPrimitive.Root
      ref={group}
      data-slot="radio-group"
      className={cn('flex min-w-0 flex-col gap-1.5', className)}
      render={
        <RadioGroupPrimitive<TValue | ''>
          {...props}
          // An empty string keeps the group controlled while nothing is chosen; no option has that value
          value={value ?? ''}
          onValueChange={(next) => {
            if (next !== '') onValueChange(next);
          }}
        />
      }
    >
      <FieldsetPrimitive.Legend className="type-label">{legend}</FieldsetPrimitive.Legend>
      <div className="flex flex-col gap-2">
        {options.map((option) => (
          <RadioRow
            key={option.value}
            option={option}
            cards={presentation === 'cards'}
            groupDisabled={props.disabled === true}
          />
        ))}
      </div>
    </FieldsetPrimitive.Root>
  );
}
