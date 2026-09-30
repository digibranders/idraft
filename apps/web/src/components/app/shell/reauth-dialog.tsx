'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { FormAlert } from '@/components/ui/form-alert';
import { OtpField } from '@/components/ui/otp-field';
import { PasswordInput } from '@/components/ui/password-input';
import { isApiProblem, retryMinutes } from '@/lib/api/problem';

/** How the person confirms: their password, or a code when they have a second factor. */
export type ReauthMethod = 'password' | 'totp';
/**
 * What the request answered. `second-factor-required`: the account has two-factor on, so a password alone
 * is refused (19 section 3.1) and the dialog asks for a code instead. Anything else rejects.
 */
export type ReauthOutcome = 'ok' | 'invalid' | 'second-factor-required';

export interface ReauthDialogProps {
  open: boolean;
  /** How to ask first. */
  method: ReauthMethod;
  /** Sends the password or the code. The feature performs the request. */
  onSubmit: (method: ReauthMethod, secret: string) => Promise<ReauthOutcome>;
  onCancel: () => void;
}

const CODE_LENGTH = 6;

/**
 * "Confirm it is you" (16 section 4.4, 25 section 3.33): opened on `403 fresh_session_required`, then the
 * request that needed it is sent again once. A 400 px dialog with one field, the password or the 6-digit
 * code. It may stack above the dialog of the action it confirms.
 */
export function ReauthDialog({ open, method, onSubmit, onCancel }: ReauthDialogProps): ReactElement {
  // Each opening starts clean: the method asked for, no value, no error
  const [opening, setOpening] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setOpening(opening + 1);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      size="sm"
    >
      <ReauthForm key={opening} initialMethod={method} onSubmit={onSubmit} />
    </Dialog>
  );
}

type Translate = ReturnType<typeof useTranslations<'shell.reauth'>>;

function ReauthForm({
  initialMethod,
  onSubmit,
}: {
  initialMethod: ReauthMethod;
  onSubmit: ReauthDialogProps['onSubmit'];
}): ReactElement {
  const t = useTranslations('shell.reauth');
  const common = useTranslations('common');
  const [method, setMethod] = useState(initialMethod);
  const [secret, setSecret] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [alert, setAlert] = useState<{ tone: 'negative' | 'warning'; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const alertRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (alert !== null) alertRef.current?.focus();
  }, [alert]);

  const invalidMessage = method === 'password' ? t('invalidPassword') : t('invalidCode');
  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    const missing =
      method === 'password'
        ? secret === ''
          ? t('passwordRequired')
          : null
        : secret.length < CODE_LENGTH
          ? t('codeIncomplete')
          : null;
    setFieldError(missing);
    setAlert(null);
    if (missing !== null) {
      fieldRef.current?.focus();
      return;
    }
    setPending(true);
    try {
      const outcome = await onSubmit(method, secret);
      if (outcome === 'invalid') {
        // In an alert that takes focus, as the sign-in forms do: an error under a field that has focus
        // already is not read when the form was sent with Enter
        setSecret('');
        setAlert({ tone: 'negative', message: invalidMessage });
      } else if (outcome === 'second-factor-required') {
        setMethod('totp');
        setSecret('');
        setAlert({ tone: 'warning', message: t('secondFactorRequired') });
      }
    } catch (error) {
      setAlert({ tone: 'negative', message: failureMessage(error, t) });
    } finally {
      setPending(false);
    }
  };

  const invalid = fieldError !== null;
  return (
    <form noValidate className="contents" onSubmit={(event) => void submit(event)}>
      <DialogHeader
        title={t('title')}
        description={method === 'password' ? t('passwordDescription') : t('codeDescription')}
        closeLabel={common('close')}
      />
      <DialogBody>
        {alert === null ? null : (
          <FormAlert ref={alertRef} tabIndex={-1} live={false} tone={alert.tone} message={alert.message} />
        )}
        <Field name={method === 'password' ? 'password' : 'totp_code'} invalid={invalid}>
          <FieldLabel>{method === 'password' ? t('password') : t('code')}</FieldLabel>
          {method === 'password' ? (
            <PasswordInput
              ref={fieldRef}
              aria-required
              autoComplete="current-password"
              showLabel={t('showPassword')}
              hideLabel={t('hidePassword')}
              value={secret}
              onValueChange={setSecret}
            />
          ) : (
            <OtpField
              length={CODE_LENGTH}
              inputRef={fieldRef}
              value={secret}
              onValueChange={setSecret}
              digitLabel={(position, length) => t('digit', { position, length })}
              autoComplete="one-time-code"
            />
          )}
          {fieldError === null ? null : <FieldError message={fieldError} />}
        </Field>
      </DialogBody>
      <DialogFooter
        secondary={
          <DialogClose>
            <Button type="button" variant="secondary">
              {common('cancel')}
            </Button>
          </DialogClose>
        }
        primary={
          <Button type="submit" variant="primary" loading={pending}>
            {t('submit')}
          </Button>
        }
      />
    </form>
  );
}

/** The alert for a request that failed for another reason than the secret: a lock, or no answer. */
function failureMessage(error: unknown, t: Translate): string {
  if (isApiProblem(error, 'rate_limited')) return t('rateLimited', { minutes: retryMinutes(error) });
  if (isApiProblem(error, 'service_unavailable')) return t('serviceUnavailable');
  return t('failed');
}
