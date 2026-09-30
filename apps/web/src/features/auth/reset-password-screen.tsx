'use client';

import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { EmailForm } from './email-form';
import { BackToSignIn } from './links';
import { NewPasswordForm } from './new-password-form';
import { MIN_PASSWORD_LENGTH } from './rules';
import { useStep } from './use-step';
import { AuthCard } from '@/components/app/shell/auth-card';
import { apiMutation } from '@/lib/api/query';
import { hardNavigate } from '@/lib/navigation/hard-navigate';
import { useFragmentParam } from '@/lib/url/use-fragment-param';

/** Where a finished reset goes: the sign-in page, which says the password was changed. */
const SIGN_IN_AFTER_RESET = '/login?notice=passwordReset';

type Step =
  { kind: 'request' } | { kind: 'sent'; email: string } | { kind: 'choose'; token: string } | { kind: 'invalid' };

/**
 * `/reset-password`: without a token, asks for the address and sends a link; with the token of that link
 * (`#token=...`), asks for the new password and then sends the person to sign in with it. A reset does not
 * sign anyone in (19 section 3.1).
 */
export function ResetPasswordScreen(): ReactNode {
  const token = useFragmentParam('token');
  // The fragment is read after mount; until then the panel stays empty rather than showing the wrong form
  return token === undefined ? null : <ResetSteps token={token} />;
}

function ResetSteps({ token }: { token: string | null }): ReactNode {
  const t = useTranslations('auth');
  const app = useTranslations('app');
  // `null` until the person acts: the step then follows what happened, not the token
  const [step, setStep] = useState<Step | null>(null);
  const request = useMutation(apiMutation('post', '/api/v1/auth/password-reset/request'));
  const confirm = useMutation(apiMutation('post', '/api/v1/auth/password-reset/confirm'));
  const current: Step = step ?? (token === null ? { kind: 'request' } : { kind: 'choose', token });
  const sendLink = (email: string): Promise<void> =>
    request.mutateAsync({ body: { email } }).then(() => setStep({ kind: 'sent', email }));
  const card = {
    request: { title: t('resetRequest.title'), description: t('resetRequest.description') },
    sent: {
      title: t('resetRequest.sentTitle'),
      description: current.kind === 'sent' ? t('resetRequest.sentDescription', { email: current.email }) : '',
    },
    choose: {
      title: t('resetConfirm.title'),
      description: t('resetConfirm.description', { min: MIN_PASSWORD_LENGTH }),
    },
    invalid: { title: t('invalidLink.title'), description: t('invalidLink.description') },
  }[current.kind];
  // "Check your email" has no field, so its heading takes focus; every other step focuses its field
  const titleRef = useStep(card.title, { focusHeading: current.kind === 'sent' });

  return (
    <AuthCard
      productName={app('name')}
      title={card.title}
      description={card.description}
      links={<BackToSignIn />}
      titleRef={titleRef}
    >
      {current.kind === 'request' ? (
        <EmailForm submitLabel={t('resetRequest.submit')} busy={request.isPending} onSubmit={sendLink} />
      ) : current.kind === 'choose' ? (
        <NewPasswordForm
          busy={confirm.isPending || confirm.isSuccess}
          onSubmit={(password) =>
            confirm
              .mutateAsync({ body: { token: current.token, new_password: password } })
              .then(() => hardNavigate(SIGN_IN_AFTER_RESET))
          }
          onInvalidToken={() => setStep({ kind: 'invalid' })}
        />
      ) : current.kind === 'invalid' ? (
        <EmailForm submitLabel={t('invalidLink.newResetLink')} busy={request.isPending} onSubmit={sendLink} />
      ) : null}
    </AuthCard>
  );
}
