'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { INVITATION_PARAM, useAfterSignIn, withInvitation } from './invitation';
import { alertMessage } from './problems';
import { CODE_LENGTH, MAX_RECOVERY_CODE_LENGTH } from './rules';
import { useFormAlert } from './use-alert';
import { useStep } from './use-step';
import { FormField } from '@/components/app/forms/form-field';
import { AuthCard } from '@/components/app/shell/auth-card';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { OtpField } from '@/components/ui/otp-field';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import { hardNavigate } from '@/lib/navigation/hard-navigate';
import { useFragmentParam } from '@/lib/url/use-fragment-param';

interface CodeValues {
  code: string;
}
interface RecoveryValues {
  recoveryCode: string;
}

/** The sign-in page, saying the second step took too long and told again where the person was going. */
function expiredUrl(next: string | null, invitation: string | null | undefined): string {
  const query = new URLSearchParams({ notice: 'sessionExpired', ...(next === null ? {} : { next }) });
  return withInvitation(`/login?${query.toString()}`, invitation);
}

/**
 * `/two-factor`: the second step of signing in for a user with two-factor on. The password step left a
 * pending session that only this call and sign-out accept, so the page asks for nothing else (not `/me`).
 * When the pending session has expired or is missing, the person starts again at the sign-in page. An
 * invitation token carried from sign-in is accepted once the code is right.
 */
export function TwoFactorForm({ next }: { next: string | null }): ReactNode {
  const t = useTranslations('auth');
  const app = useTranslations('app');
  const invitation = useFragmentParam(INVITATION_PARAM);
  const [method, setMethod] = useState<'code' | 'recovery'>('code');
  const verify = useMutation(apiMutation('post', '/api/v1/auth/totp/verify'));
  const afterSignIn = useAfterSignIn(next, invitation);
  // Once the code is right, the next page is loading: the form cannot be sent again
  const [leaving, setLeaving] = useState(false);
  const busy = verify.isPending || leaving;
  const title = method === 'code' ? t('twoFactor.title') : t('twoFactor.recoveryTitle');
  // The field of the new method takes focus, so the heading does not
  const titleRef = useStep(title, { focusHeading: false });
  const switchMethod = (
    <Button type="button" variant="link" onClick={() => setMethod(method === 'code' ? 'recovery' : 'code')}>
      {method === 'code' ? t('twoFactor.useRecoveryCode') : t('twoFactor.useAuthenticator')}
    </Button>
  );
  const send = async (body: { code: string } | { recovery_code: string }): Promise<void> => {
    await verify.mutateAsync({ body });
    setLeaving(true);
    await afterSignIn();
  };
  const onFailed = (error: unknown): string | null => {
    // The pending session is gone (expired, or signed out elsewhere): the password step comes first again
    if (isApiProblem(error, 'session_expired') || isApiProblem(error, 'unauthenticated')) {
      setLeaving(true);
      hardNavigate(expiredUrl(next, invitation));
      return null;
    }
    return alertMessage(error, t, {
      invalid_code: method === 'code' ? t('twoFactor.invalidCode') : t('twoFactor.invalidRecoveryCode'),
    });
  };
  return (
    <AuthCard
      productName={app('name')}
      title={title}
      description={
        method === 'code' ? t('twoFactor.description', { product: app('name') }) : t('twoFactor.recoveryDescription')
      }
      links={switchMethod}
      titleRef={titleRef}
    >
      {method === 'code' ? (
        <CodeForm busy={busy} onSubmit={(code) => send({ code })} onFailed={onFailed} />
      ) : (
        <RecoveryForm
          busy={busy}
          onSubmit={(recoveryCode) => send({ recovery_code: recoveryCode })}
          onFailed={onFailed}
        />
      )}
    </AuthCard>
  );
}

interface StepProps<TValue> {
  /** A request is in flight, or the next page is loading. */
  busy: boolean;
  onSubmit: (value: TValue) => Promise<void>;
  /** The alert for a failed request, or `null` when the page is being left. */
  onFailed: (error: unknown) => string | null;
}

function CodeForm({ busy, onSubmit, onFailed }: StepProps<string>): ReactNode {
  const t = useTranslations('auth');
  const { alert, setAlert, alertRef } = useFormAlert();
  const schema = useMemo(
    () => z.object({ code: z.string().regex(/^\d{6}$/, { error: t('validation.codeIncomplete') }) }),
    [t],
  );
  const form = useForm<CodeValues>({ resolver: zodResolver(schema), defaultValues: { code: '' } });
  useEffect(() => form.setFocus('code'), [form]);
  const submit = form.handleSubmit(async ({ code }) => {
    if (busy) return;
    setAlert(null);
    try {
      await onSubmit(code);
    } catch (error) {
      setAlert(onFailed(error));
      form.resetField('code');
    }
  });
  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      {alert === null ? null : <FormAlert ref={alertRef} tabIndex={-1} live={false} message={alert} />}
      <FormField
        control={form.control}
        name="code"
        label={t('twoFactor.code')}
        render={(field) => (
          <OtpField
            name={field.name}
            length={CODE_LENGTH}
            inputRef={field.ref}
            value={field.value}
            onValueChange={field.onChange}
            digitLabel={(position, length) => t('twoFactor.digit', { position, length })}
            disabled={field.disabled}
            autoComplete="one-time-code"
          />
        )}
      />
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
        {t('twoFactor.submit')}
      </Button>
    </form>
  );
}

function RecoveryForm({ busy, onSubmit, onFailed }: StepProps<string>): ReactNode {
  const t = useTranslations('auth');
  const { alert, setAlert, alertRef } = useFormAlert();
  const schema = useMemo(
    () =>
      z.object({
        recoveryCode: z
          .string()
          .trim()
          .min(1, { error: t('validation.recoveryCodeRequired') })
          .max(MAX_RECOVERY_CODE_LENGTH, {
            error: t('validation.recoveryCodeTooLong', { max: MAX_RECOVERY_CODE_LENGTH }),
          }),
      }),
    [t],
  );
  const form = useForm<RecoveryValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    defaultValues: { recoveryCode: '' },
  });
  useEffect(() => form.setFocus('recoveryCode'), [form]);
  const submit = form.handleSubmit(async ({ recoveryCode }) => {
    if (busy) return;
    setAlert(null);
    try {
      await onSubmit(recoveryCode.trim());
    } catch (error) {
      setAlert(onFailed(error));
    }
  });
  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      {alert === null ? null : <FormAlert ref={alertRef} tabIndex={-1} live={false} message={alert} />}
      <FormField
        control={form.control}
        name="recoveryCode"
        label={t('twoFactor.recoveryCode')}
        render={(field) => (
          <Input
            {...field.controlProps}
            size="lg"
            // A recovery code is typed from a saved list; the browser has nothing to offer
            autoComplete="off"
            spellCheck={false}
            className="num"
            value={field.value}
            onValueChange={field.onChange}
          />
        )}
      />
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
        {t('twoFactor.submit')}
      </Button>
    </form>
  );
}
