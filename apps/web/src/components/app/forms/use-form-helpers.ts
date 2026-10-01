'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useWatch, type FieldValues, type Path, type PathValue, type UseFormReturn } from 'react-hook-form';

import { browserTimeZoneName } from '@/lib/format/time-zone';
import { slugFromName } from '@/lib/slugs/slug';

/**
 * The form's `onSubmit` that starts `submit` once at a time. Two quick presses of Enter would otherwise both
 * start it: a mutation's pending state only updates on the next render.
 */
export function useSubmitOnce(
  submit: (event: FormEvent<HTMLFormElement>) => Promise<void>,
): (event: FormEvent<HTMLFormElement>) => void {
  const running = useRef(false);
  return useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      if (running.current) {
        event.preventDefault();
        return;
      }
      running.current = true;
      void submit(event).finally(() => {
        running.current = false;
      });
    },
    [submit],
  );
}

/**
 * Suggests a slug from the name while the person has not written one of their own; clearing the slug
 * hands it back to the name. Returns the slug field's change handler.
 */
export function useSlugSuggestion<TValues extends FieldValues>(
  form: UseFormReturn<TValues>,
  nameField: Path<TValues>,
  slugField: Path<TValues>,
): (value: string) => void {
  const [edited, setEdited] = useState(false);
  const name = useWatch({ control: form.control, name: nameField });
  useEffect(() => {
    if (edited) return;
    const suggestion = slugFromName(typeof name === 'string' ? name : '') as PathValue<TValues, Path<TValues>>;
    // A slug error shown already follows the suggestion, so it does not outlive what it was about
    const validate = form.getFieldState(slugField).invalid || form.formState.isSubmitted;
    form.setValue(slugField, suggestion, { shouldDirty: true, shouldValidate: validate });
  }, [name, edited, form, slugField]);
  return (value: string): void => {
    setEdited(value !== '');
    form.setValue(slugField, value.toLowerCase() as PathValue<TValues, Path<TValues>>, {
      shouldDirty: true,
      shouldValidate: form.getFieldState(slugField).invalid,
    });
  };
}

/**
 * Starts a time zone field at the browser's zone once the page runs in the browser. The server cannot know
 * it, so the form renders `UTC` there and takes the browser's zone as its default after hydration.
 */
export function useBrowserTimeZoneDefault<TValues extends FieldValues>(
  form: UseFormReturn<TValues>,
  field: Path<TValues>,
): void {
  useEffect(() => {
    form.resetField(field, { defaultValue: browserTimeZoneName() as PathValue<TValues, Path<TValues>> });
  }, [form, field]);
}
