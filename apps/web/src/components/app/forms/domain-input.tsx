'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode, Ref } from 'react';

import { FieldDescription } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { InputSize } from '@/components/ui/input-variants';
import { useDebouncedValue } from '@/lib/dom/use-debounced-value';
import { normalizeDomain } from '@/lib/domains/normalize';

/** The preview follows typing after a short pause: it is feedback, not an error (10-forms.md section 12). */
const PREVIEW_DELAY_MS = 150;

export interface DomainInputProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Helper text shown until the value can be previewed. */
  description?: string | undefined;
  /** The field shows an error: the preview gives its line to it. */
  invalid?: boolean | undefined;
  size?: InputSize | undefined;
  name?: string | undefined;
  inputRef?: Ref<HTMLInputElement> | undefined;
  onBlur?: (() => void) | undefined;
  disabled?: boolean | undefined;
  'aria-required'?: boolean | undefined;
}

/**
 * A site's host, for competitors and projects (10-forms.md section 12, inventory 4.21). Under the field it
 * says what will be tracked, and which path it drops: "Will track: hubspot.com (path /products/crm
 * ignored)". The preview is a guess at what the API keeps; the API's answer decides. Render it inside a
 * `FormField` with no description of its own: this component shows the helper text or the preview.
 */
export function DomainInput({
  value,
  onValueChange,
  description,
  invalid = false,
  size,
  inputRef,
  ...props
}: DomainInputProps): ReactElement {
  const t = useTranslations('common.domain');
  const settled = useDebouncedValue(value, PREVIEW_DELAY_MS);
  const preview = normalizeDomain(settled);
  // The value that will be stored stands out from the words around it
  const stored = (chunks: ReactNode): ReactNode => <span className="text-foreground">{chunks}</span>;
  const line = invalid
    ? null
    : preview.ok
      ? preview.ignoredPath === null
        ? t.rich('preview', { domain: preview.domain, value: stored })
        : t.rich('previewWithPath', { domain: preview.domain, path: preview.ignoredPath, value: stored })
      : (description ?? null);
  return (
    <>
      <Input
        {...props}
        ref={inputRef}
        size={size}
        type="text"
        inputMode="url"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={value}
        onValueChange={onValueChange}
      />
      {line === null ? null : <FieldDescription>{line}</FieldDescription>}
    </>
  );
}
