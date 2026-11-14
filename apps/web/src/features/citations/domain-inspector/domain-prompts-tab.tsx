'use client';

import { MessageSquareText } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type ReactElement, type ReactNode } from 'react';

import { useDomainCitations, usePromptTexts, type DomainDetailRead } from './domain-reads';
import { enginesByPrompt, topPrompts } from './prompt-engines-model';
import { EngineBadge } from '@/components/app/engine/engine-badge';
import { InspectorSection, type InspectorSectionStatus } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TextLink } from '@/components/ui/text-link';
import { Tooltip } from '@/components/ui/tooltip';
import { Truncate } from '@/components/ui/truncate';
import type { SourceFilters } from '@/lib/citations/source-queries';
import type { DomainPrompt, EngineCode, SourceDomainDetailData, SourceScope } from '@/lib/citations/types';
import { formatInteger } from '@/lib/format';

/** The inspector lists the ten prompts that cite the domain most. */
const LIMIT = 10;

/** A tooltip on an element nothing focuses reaches no keyboard user (20 section 6.2 rule 6); the lint rule cannot see why. */
const FOCUSABLE = { tabIndex: 0 } as const;

export interface DomainPromptsTabProps {
  source: SourceScope;
  filters: SourceFilters;
  domain: string;
  /** `null` while the read has nothing. */
  data: SourceDomainDetailData | null;
  read: DomainDetailRead;
  /** A read is on its way while the rows are on screen: they stay and the section says it is busy. */
  refetching: boolean;
  /** The engines in scope with their names. */
  engines: readonly { code: EngineCode; label: string }[];
  /** The prompt inspector on the prompts page, as a real link: the prompts feature is reached by address, not by import. */
  promptHrefOf: (promptId: string) => Route;
}

/**
 * The Prompts tab (WB-DOM-08): the ten prompts whose answers cite the domain most, each with its text, the engines
 * it was cited on, its units and its answers. The detail names neither text nor engine, so two reads join it: the
 * project's prompts for the text, and the latest 100 citations of the domain (one read, not one per prompt) for the
 * engines. Each fails alone and the rest stays: a prompt without a text shows its id and says the text is n/a; a
 * prompt with no engine in those 100 citations says n/a and why, never a blank. The texts are provider data: text only.
 */
export function DomainPromptsTab({
  source,
  filters,
  domain,
  data,
  read,
  refetching,
  engines,
  promptHrefOf,
}: DomainPromptsTabProps): ReactElement {
  const t = useTranslations('citations.inspectors.domain');
  const common = useTranslations('common');
  const locale = useLocale();
  const texts = usePromptTexts(source);
  const citations = useDomainCitations(source, filters, domain);
  const rows = useMemo(() => topPrompts(data?.prompts ?? [], LIMIT), [data]);
  const enginesOf = useMemo(() => enginesByPrompt(citations.data?.data ?? []), [citations.data]);
  const labels = useMemo(() => new Map(engines.map((engine) => [engine.code, engine.label])), [engines]);
  const status: InspectorSectionStatus =
    data === null ? (read.status === 'error' ? 'error' : 'loading') : rows.length === 0 ? 'empty' : 'ready';
  const citationsFailed = citations.status === 'error';

  const promptCell = (row: DomainPrompt): ReactNode => {
    const text = texts.data?.get(row.prompt_id);
    if (text === undefined && texts.status === 'loading') return <Skeleton shape="text-12" widthPct={48} />;
    return (
      <TextLink render={<Link href={promptHrefOf(row.prompt_id)} />} tone="inherit" className="text-foreground">
        <Truncate
          text={text ?? t('promptUnknown', { id: row.prompt_id })}
          className={text === undefined ? 'max-w-40 text-foreground-tertiary' : 'max-w-40'}
        />
      </TextLink>
    );
  };

  const enginesCell = (row: DomainPrompt): ReactNode => {
    if (citations.status === 'loading') return <Skeleton shape="text-12" widthPct={64} />;
    const found = enginesOf.get(row.prompt_id);
    if (found !== undefined) {
      return (
        <span className="flex flex-wrap gap-1">
          {found.map((code) => (
            <EngineBadge key={code} engine={code} name={labels.get(code) ?? code} />
          ))}
        </span>
      );
    }
    // A read that failed is named once above the table; one that answered without this prompt says what it covered
    const unknown = (
      <span {...FOCUSABLE} className="rounded-sm text-foreground-tertiary outline-none focus-visible:focus-ring">
        {t('enginesUnknown')}
      </span>
    );
    return citationsFailed ? (
      unknown
    ) : (
      <Tooltip content={t('enginesUnknownTip', { count: citations.data?.data.length ?? 0 })}>{unknown}</Tooltip>
    );
  };

  const columns: PlainColumn<DomainPrompt>[] = [
    { id: 'prompt', header: t('prompt'), cell: promptCell },
    { id: 'engines', header: t('promptEngines'), wrap: true, cell: enginesCell },
    { id: 'units', header: t('promptUnits'), cell: (row) => formatInteger(row.citation_units, { locale }) },
    { id: 'answers', header: t('promptAnswers'), cell: (row) => formatInteger(row.observations, { locale }) },
  ];

  return (
    <InspectorSection
      title={t('promptsTitle')}
      icon={MessageSquareText}
      status={status}
      error={
        <InlineError
          title={t('promptsFailed')}
          reason={t('loadFailedReason')}
          errorId={read.errorId}
          onRetry={read.retry}
          retrying={read.retrying}
          retryLabel={common('retry')}
        />
      }
      empty={
        <EmptyState variant="inline" title={t('promptsEmptyTitle')} reason={t('promptsEmptyReason')} headingLevel={3} />
      }
    >
      <div aria-busy={refetching ? true : undefined} className="flex flex-col gap-2">
        {citationsFailed ? (
          <p className="flex flex-wrap items-center gap-2 type-meta">
            {t('enginesPartial')}
            <Button variant="link" size="sm" loading={citations.retrying} onClick={citations.retry}>
              {common('retry')}
            </Button>
          </p>
        ) : null}
        <PlainTable<DomainPrompt>
          caption={t('promptsCaption', { domain })}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.prompt_id}
          status="ready"
          errorState={null}
          emptyText={t('promptsEmptyTitle')}
        />
      </div>
    </InspectorSection>
  );
}
