'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';
import {
  useController,
  type Control,
  type FieldPath,
  type FieldPathValue,
  type FieldValues,
  type RefCallBack,
} from 'react-hook-form';

import { Field, FieldDescription, FieldError, FieldLabel, type FieldWidth } from '@/components/ui/field';

/** What the control of a field receives. It passes each part on to the primitive it renders. */
export interface FormFieldControl<TValue> {
  name: string;
  value: TValue;
  onChange: (value: TValue) => void;
  onBlur: () => void;
  /** Goes on the element that takes focus, so a failed submit can move focus to the first wrong field. */
  ref: RefCallBack;
  invalid: boolean;
  disabled: boolean;
  /** Every field is required unless it is marked optional. Controls pass it as `aria-required`. */
  required: boolean;
  /** For a group control (`RadioGroup`, `SegmentedControl`), which shows the label itself as its legend. */
  label: string;
  /**
   * What every control takes unchanged, to spread on it: `<Input {...field.controlProps} />`. Value and
   * change handler are passed by name, because controls name them differently.
   */
  controlProps: {
    name: string;
    ref: RefCallBack;
    onBlur: () => void;
    disabled: boolean;
    'aria-required': boolean;
  };
}

export interface FormFieldProps<TValues extends FieldValues, TName extends FieldPath<TValues>, TTransformed = TValues> {
  control: Control<TValues, unknown, TTransformed>;
  /** Equals the path in the API request body, so a server error finds its field (10-forms.md section 22). */
  name: TName;
  /** Four words at most, no colon. */
  label: string;
  /** Adds "(optional)" to the label. Required fields are unmarked. */
  optional?: boolean | undefined;
  /** Helper text. The error takes its place while the field is wrong. */
  description?: string | undefined;
  width?: FieldWidth | undefined;
  labelDisplay?: 'visible' | 'visually-hidden' | undefined;
  /**
   * `group` for a control that is a group with its own legend: the field then renders no label of its
   * own, and the control shows `label` as the legend.
   */
  kind?: 'control' | 'group' | undefined;
  render: (field: FormFieldControl<FieldPathValue<TValues, TName>>) => ReactElement;
}

/**
 * One field of a react-hook-form form: label, control, then helper text or error (10-forms.md section 2).
 * An error shows when the field loses focus after the user changed it, and from then on follows every
 * change; a submit shows every error. Tabbing through an empty form shows nothing, and nothing appears
 * while the user is still typing (section 18). Switches never go here: they save at once and belong to no
 * form.
 */
export function FormField<TValues extends FieldValues, TName extends FieldPath<TValues>, TTransformed = TValues>({
  control,
  name,
  label,
  optional = false,
  description,
  width,
  labelDisplay,
  kind = 'control',
  render,
}: FormFieldProps<TValues, TName, TTransformed>): ReactElement {
  const t = useTranslations('common');
  const { field, fieldState, formState } = useController({ control, name });
  // Whether the field has lost focus after the user changed it. From then on its error shows and follows
  // every change, also when the field is emptied again and equals its default.
  const [revealed, setRevealed] = useState(false);
  // `isTouched` going back to false means the form was reset: the field starts over.
  const [wasTouched, setWasTouched] = useState(fieldState.isTouched);
  if (wasTouched !== fieldState.isTouched) {
    setWasTouched(fieldState.isTouched);
    if (!fieldState.isTouched) setRevealed(false);
  }
  const message = fieldState.error?.message;
  // An error the server sent is about what was submitted, so it shows at once
  const mayShow = revealed || formState.isSubmitted || fieldState.error?.type === 'server';
  const showError = message !== undefined && message !== '' && mayShow;
  const handleBlur = (): void => {
    if (fieldState.isDirty) setRevealed(true);
    field.onBlur();
  };
  const disabled = field.disabled === true;
  const required = !optional;
  return (
    <Field name={name} invalid={showError} disabled={disabled} width={width}>
      {kind === 'control' ? (
        <FieldLabel optional={optional ? t('optional') : undefined} display={labelDisplay}>
          {label}
        </FieldLabel>
      ) : null}
      {render({
        name,
        value: field.value,
        onChange: field.onChange,
        onBlur: handleBlur,
        ref: field.ref,
        invalid: showError,
        disabled,
        required,
        label,
        controlProps: { name, ref: field.ref, onBlur: handleBlur, disabled, 'aria-required': required },
      })}
      {showError ? (
        <FieldError message={message} />
      ) : description === undefined ? null : (
        <FieldDescription>{description}</FieldDescription>
      )}
    </Field>
  );
}
