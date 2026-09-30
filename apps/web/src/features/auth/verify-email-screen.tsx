'use client';

import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { EmailForm } from './email-form';
import { BackToSignIn } from './links';
import { alertMessage } from './problems';
import { useStep } from './use-step';
import { AuthCard } from '@/components/app/shell/auth-card';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { LinkButton } from '@/components/ui/link-button';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import { useFragmentParam } from '@/lib/url/use-fragment-param';

/**
 * `/verify-email#token=...`: sends the token of the emailed link as soon as the page has read it, then says
 * the address is verified. A link that does not work (used or expired) or that has no token offers a new
 * one; a request that failed for another reason (a limit, an outage) can be sent again.
 */
export function VerifyEmailScreen(): ReactNode {
  const token = useFragmentParam('token');
  return token === undefined ? null : <VerifySteps token={token} />;
}

function VerifySteps({ token }: { token: string | null }): ReactNode {
  const t = useTranslations('auth');
  const app = useTranslations('app');
  const common = useTranslations('common');
  const verify = useMutation(apiMutation('post', '/api/v1/auth/verify-email'));
  const request = useMutation(apiMutation('post', '/api/v1/auth/verify-email/request'));
  const [sentTo, setSentTo] = useState<string | null>(null);
  // A token is single-use: React's development double mount must not send it twice
  const sent = useRef(false);
  const { mutate } = verify;
  useEffect(() => {
    if (token === null || sent.current) return;
    sent.current = true;
    mutate({ body: { token } });
  }, [token, mutate]);

  const view =
    sentTo !== null
      ? 'sent'
      : token === null
        ? 'missing'
        : verify.isSuccess
          ? 'done'
          : verify.isError
            ? isApiProblem(verify.error, 'invalid_token')
              ? 'invalid'
              : 'failed'
            : 'checking';
  const card = {
    sent: { title: t('verifyEmail.sentTitle'), description: t('verifyEmail.sentDescription', { email: sentTo ?? '' }) },
    missing: { title: t('verifyEmail.missingTitle'), description: t('verifyEmail.missingDescription') },
    done: {
      title: t('verifyEmail.doneTitle'),
      description: t('verifyEmail.doneDescription', { product: app('name') }),
    },
    invalid: { title: t('invalidLink.title'), description: t('verifyEmail.invalidDescription') },
    failed: { title: t('verifyEmail.failedTitle'), description: t('verifyEmail.checkingDescription') },
    checking: { title: t('verifyEmail.checkingTitle'), description: t('verifyEmail.checkingDescription') },
  }[view];
  // Views with an email field focus it; the others move focus to their heading, so the outcome is read
  const titleRef = useStep(card.title, { focusHeading: view !== 'invalid' && view !== 'missing' });
  const newLinkForm = (
    <EmailForm
      submitLabel={t('verifyEmail.submit')}
      busy={request.isPending}
      onSubmit={(email) => request.mutateAsync({ body: { email } }).then(() => setSentTo(email))}
    />
  );

  return (
    <AuthCard
      productName={app('name')}
      title={card.title}
      description={card.description}
      links={view === 'done' || view === 'checking' ? undefined : <BackToSignIn />}
      titleRef={titleRef}
      aria-busy={view === 'checking' || verify.isPending}
    >
      {view === 'done' ? (
        <LinkButton variant="primary" size="lg" className="w-full" render={<Link href="/" />}>
          {t('verifyEmail.continue')}
        </LinkButton>
      ) : view === 'failed' ? (
        <div className="flex flex-col gap-4">
          <FormAlert message={alertMessage(verify.error, t)} />
          <Button
            type="button"
            variant="primary"
            size="lg"
            className="w-full"
            loading={verify.isPending}
            onClick={() => {
              if (token !== null) mutate({ body: { token } });
            }}
          >
            {common('retry')}
          </Button>
        </div>
      ) : view === 'invalid' || view === 'missing' ? (
        newLinkForm
      ) : null}
    </AuthCard>
  );
}
