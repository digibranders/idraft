'use client';

import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { AiAlongsideCard } from './ai-alongside-card';
import { AiBasisNote, AiPeriod } from './ai-basis';
import { AiPromptsCard } from './ai-prompts-card';
import { AiTrendCard } from './ai-trend-card';
import type { PageDrawerContext } from './page-drawer-context';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import type { PageDetail } from '@/lib/internal-links/types';
import { usePageAi } from '@/lib/pages/page-ai';

export interface DrawerAiTabProps {
  context: PageDrawerContext;
  urlId: string;
  detail: PageDetail | null;
  /** The existing citations strip built by `ExtrasSections` when `detail` has citations. */
  citations: ReactElement;
}

/** The AI tab of the page drawer: today's strip, citing prompts, daily trend, and pages cited alongside. */
export function DrawerAiTab({ context, urlId, detail, citations }: DrawerAiTabProps): ReactElement {
  const t = useTranslations('pages.drawer.ai');
  const extrasWords = useTranslations('internalLinks.inspectorExtras');
  const common = useTranslations('common');
  const aiRead = usePageAi(context.scope, context.crawl.run, urlId);

  const strip: ReactElement =
    detail === null ? (
      <InspectorSection title={extrasWords('citations')} icon={Sparkles} status="loading" />
    ) : detail.extras.citations.total === 0 ? (
      <InspectorSection title={extrasWords('citations')} icon={Sparkles} status="ready">
        <p className="type-body text-foreground-tertiary">{t('none')}</p>
      </InspectorSection>
    ) : (
      citations
    );

  let cards: ReactNode = null;
  if (aiRead.state === 'loading') {
    cards = (
      <>
        <InspectorSection title={t('prompts.title')} flush status="loading" />
        <InspectorSection title={t('trend.title')} status="loading" />
        <InspectorSection title={t('alongside.title')} flush status="loading" />
      </>
    );
  } else if (aiRead.state === 'error') {
    cards = (
      <InlineError
        title={t('state.loadFailed')}
        reason={t('state.loadFailedReason')}
        errorId={null}
        onRetry={aiRead.retry}
        retrying={false}
        retryLabel={common('retry')}
      />
    );
  } else if (aiRead.state === 'ready') {
    const ai = aiRead.data;
    if (ai.state === 'no_prompts') {
      cards = (
        <EmptyState
          variant="card"
          headingLevel={3}
          title={t('state.noPromptsTitle')}
          reason={t('state.noPromptsReason')}
        />
      );
    } else if (ai.state === 'no_answers') {
      cards = (
        <EmptyState
          variant="card"
          headingLevel={3}
          title={t('state.noAnswersTitle')}
          reason={t('state.noAnswersReason')}
        />
      );
    } else {
      cards = (
        <>
          <AiPeriod ai={ai} />
          <AiPromptsCard ai={ai} onOpenPrompt={context.openPrompt} />
          <AiTrendCard ai={ai} />
          <AiAlongsideCard ai={ai} onOpenPage={context.openPage} />
          <AiBasisNote />
        </>
      );
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {strip}
      {cards}
    </div>
  );
}
