'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import { Ban, SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { parseAsString, useQueryState } from 'nuqs';
import { useMemo, type ReactElement } from 'react';

import { DayColumns } from './day-columns';
import { DAY_COLUMNS, columnOf, dayAnswers } from './day-compare-model';
import { PlatformMark } from './platform-mark';
import { WIDEST_WINDOW, windowRange } from './prompt-model';
import { engineAnswersQuery, enginesQuery, observationQuery, promptQuery, type PromptScope } from './prompt-queries';
import { byEngineOrder } from '@/components/app/engine/order';
import { DetailPageHeader } from '@/components/app/shell/detail-page-header';
import { PAGE_CLASS } from '@/components/app/shell/page-header';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Select, type SelectOption } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TextLink } from '@/components/ui/text-link';
import { isApiProblem } from '@/lib/api/problem';
import { useErrorId } from '@/lib/api/use-error-id';
import { useCan } from '@/lib/permissions';
import { projectPath, promptsPath } from '@/lib/routes/paths';

export interface DayCompareScreenProps {
  workspaceId: string;
  projectId: string;
  /** The slugs in the URL, for the way back to the list. */
  workspaceSlug: string;
  projectSlug: string;
  promptId: string;
  /** The project's time zone, for dates. */
  timeZone: string;
}

/**
 * The page of one prompt (16-drawers-dialogs-popovers.md section 1.1: the study that the drawer cannot hold).
 * It opens with Compare days: one platform, the last four days with a valid answer side by side, each built from the
 * answer's own detail. It needs `data:read`, as every AI read does.
 */
export function DayCompareScreen(props: DayCompareScreenProps): ReactElement {
  return useCan('data:read') ? <DayCompareContent {...props} /> : <NoAccess {...props} />;
}

function NoAccess({ workspaceSlug, projectSlug }: DayCompareScreenProps): ReactElement {
  const t = useTranslations('prompts.dayCompare');
  return (
    <div className={PAGE_CLASS}>
      <EmptyState
        icon={Ban}
        title={t('noAccess.title')}
        reason={t('noAccess.reason')}
        headingLevel={1}
        secondaryAction={
          <TextLink render={<Link href={projectPath(workspaceSlug, projectSlug)} />}>
            {t('noAccess.toOverview')}
          </TextLink>
        }
      />
    </div>
  );
}

function DayCompareContent({
  workspaceId,
  projectId,
  workspaceSlug,
  projectSlug,
  promptId,
  timeZone,
}: DayCompareScreenProps): ReactElement {
  const t = useTranslations('prompts.dayCompare');
  const common = useTranslations('common');
  const scope = useMemo((): PromptScope => ({ workspaceId, projectId }), [workspaceId, projectId]);
  const backHref = promptsPath(workspaceSlug, projectSlug);
  const range = useMemo(() => windowRange(WIDEST_WINDOW, new Date(), timeZone), [timeZone]);

  const detail = useQuery(promptQuery(scope, promptId));
  const engines = useQuery(enginesQuery(scope));
  const enabled = useMemo(
    () =>
      byEngineOrder(
        (engines.data?.data ?? []).filter((engine) => engine.is_enabled),
        (engine) => engine.engine.engine_code,
      ),
    [engines.data],
  );
  const [engineParam, setEngineParam] = useQueryState('engine', parseAsString);
  // An engine the address names but the project has off is not offered: the first one that is on is shown instead
  const engineCode =
    enabled.find((engine) => engine.engine.engine_code === engineParam)?.engine.engine_code ??
    enabled[0]?.engine.engine_code ??
    null;

  const answers = useQuery({
    ...engineAnswersQuery(scope, promptId, engineCode ?? '', range),
    enabled: engineCode !== null,
  });
  const picked = useMemo(
    () => (engineCode === null ? [] : dayAnswers(answers.data?.data ?? [], engineCode)),
    [answers.data, engineCode],
  );
  const details = useQueries({
    queries: picked.map((row) => observationQuery(scope, row.observation_id, row.observed_at)),
  });
  // An answer the API no longer has (removed since the list was read) leaves its day out; it is no failure of the page
  const readable = details.filter((entry) => !(entry.isError && isApiProblem(entry.error, 'not_found')));
  const detailsError = readable.find((entry) => entry.isError);
  const columns = readable.every((entry) => entry.data !== undefined)
    ? readable.flatMap((entry) => (entry.data === undefined ? [] : [columnOf(entry.data.data)]))
    : null;

  const errorId = useErrorId(detail.error ?? answers.error ?? engines.error ?? detailsError?.error);
  const retry = (): void => {
    void detail.refetch();
    void engines.refetch();
    void answers.refetch();
    for (const entry of readable) if (entry.isError) void entry.refetch();
  };

  if (isApiProblem(detail.error, 'not_found') || isApiProblem(detail.error, 'validation_failed')) {
    return (
      <div className={PAGE_CLASS}>
        <EmptyState
          icon={SearchX}
          title={t('notFound.title')}
          reason={t('notFound.reason')}
          headingLevel={1}
          secondaryAction={<TextLink render={<Link href={backHref} />}>{t('notFound.toList')}</TextLink>}
        />
      </div>
    );
  }

  const prompt = detail.data?.data ?? null;
  const failed = detail.isError || engines.isError || answers.isError || detailsError !== undefined;
  const options: SelectOption<string>[] = enabled.map((engine) => ({
    value: engine.engine.engine_code,
    label: engine.engine.label,
    icon: <PlatformMark code={engine.engine.engine_code} />,
  }));
  const chosenLabel = enabled.find((engine) => engine.engine.engine_code === engineCode)?.engine.label ?? '';

  let body: ReactElement;
  if (failed) {
    body = (
      <InlineError
        title={t('loadFailed.title')}
        reason={t('loadFailed.reason')}
        errorId={errorId}
        onRetry={retry}
        retrying={
          detail.isFetching || engines.isFetching || answers.isFetching || readable.some((entry) => entry.isFetching)
        }
        retryLabel={common('retry')}
      />
    );
  } else if (engines.isPending || (engineCode !== null && answers.isPending) || columns === null) {
    body = (
      <div className="@container">
        <div
          className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @4xl:grid-cols-4"
          role="status"
          aria-label={common('loading')}
        >
          {Array.from({ length: DAY_COLUMNS }, (_, index) => (
            <Skeleton key={index} shape="block" height="chart-280" />
          ))}
        </div>
      </div>
    );
  } else if (columns.length === 0) {
    body = (
      <EmptyState
        variant="inline"
        title={engineCode === null ? t('noEngines.title') : t('empty.title', { platform: chosenLabel })}
        reason={engineCode === null ? t('noEngines.reason') : t('empty.reason')}
        headingLevel={3}
      />
    );
  } else {
    body = <DayColumns columns={columns} timeZone={timeZone} />;
  }

  return (
    <div className={PAGE_CLASS}>
      <DetailPageHeader
        back={{ label: t('back'), href: backHref }}
        objectName={prompt?.current_version.text ?? t('titleFallback')}
        facts={t('meta')}
      />
      <section aria-labelledby="day-compare-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="day-compare-title" className="type-section-title">
            {t('title')}
          </h2>
          {options.length === 0 || engineCode === null ? null : (
            <div className="ml-auto">
              <Select<string>
                aria-label={t('platformTrigger', { value: chosenLabel })}
                listLabel={t('platformList')}
                size="sm"
                value={engineCode}
                placeholder={t('platform')}
                options={options}
                onValueChange={(next) => void setEngineParam(next)}
              />
            </div>
          )}
        </div>
        <p className="type-meta">{t('note')}</p>
        {body}
      </section>
    </div>
  );
}
