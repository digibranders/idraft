'use client';

import { useQuery } from '@tanstack/react-query';
import { Ban, MessageSquare, Plus, Power } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { parseAsString, useQueryStates } from 'nuqs';
import { useMemo, useState, type ReactNode } from 'react';

import { AddPromptsDialog } from './add-prompts-dialog';
import { DEFAULT_SORT, usePromptColumns, type PromptRow } from './prompt-columns';
import { DEFAULT_WINDOW, hasAnswers, parseWindow, topicTermsOf, WINDOW_DAYS, windowRange } from './prompt-model';
import { enginesQuery, summaryQuery, usePromptList, type PromptScope } from './prompt-queries';
import { DataTable } from '@/components/app/data-table/data-table';
import type { TableStatus } from '@/components/app/data-table/types';
import { PAGE_CLASS, PageHeader } from '@/components/app/shell/page-header';
import { TopBarPortal } from '@/components/app/shell/top-bar-slot';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { TextLink } from '@/components/ui/text-link';
import { useErrorId } from '@/lib/api/use-error-id';
import { useUtcDay } from '@/lib/dom/use-utc-day';
import { formatBusinessDate, formatList } from '@/lib/format';
import { useCountries } from '@/lib/locations/countries';
import { useCan } from '@/lib/permissions';
import { projectPath } from '@/lib/routes/paths';
import {
  DEFAULT_DENSITY,
  formatColumns,
  formatSort,
  parseColumns,
  parseDensity,
  parseSort,
  sameSort,
  type Density,
  type SortKey,
} from '@/lib/tables/table-state';

export interface PromptsProject {
  id: string;
  slug: string;
  name: string;
  /** The project's time zone: the window's days are its days. */
  timeZone: string;
  /** The project's defaults, which Add prompts starts on. */
  defaultLanguage: string | null;
  defaultCountryIso: string | null;
}

export interface PromptsScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  project: PromptsProject;
}

/** The URL's keys besides the filters': the window and the table's state. */
const VIEW_STATE = {
  window: parseAsString,
  q: parseAsString.withDefault(''),
  sort: parseAsString,
  cols: parseAsString,
  density: parseAsString,
};

const promptRowId = (row: PromptRow): string => row.prompt.prompt_id;

/**
 * AI > Topics & Prompts (spec 2026-11-11 section 4.6, ADR-DS-022): the project's prompts over a window of
 * days (28 by default, in the top bar as a project-wide scope), with what each engine answered. A project
 * without an engine on is sent to Settings > Engines; until the first answers arrive the page says when they
 * come, so an empty table is not read as a failure.
 */
export function PromptsScreen(props: PromptsScreenProps): ReactNode {
  const t = useTranslations('prompts');
  const canRead = useCan('data:read');
  if (!canRead) {
    return (
      <div className={PAGE_CLASS}>
        <PageHeader title={t('title')} />
        <EmptyState icon={Ban} title={t('noAccessTitle')} reason={t('noAccessReason')} headingLevel={2} />
      </div>
    );
  }
  return <PromptsContent {...props} />;
}

function PromptsContent({ workspaceId, workspaceSlug, project }: PromptsScreenProps): ReactNode {
  const t = useTranslations('prompts');
  const common = useTranslations('common');
  const locale = useLocale();
  const canWrite = useCan('prompts:write');
  const [addOpen, setAddOpen] = useState(false);
  const scope = useMemo((): PromptScope => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  const [view, setView] = useQueryStates(VIEW_STATE, { history: 'replace' });
  const windowDays = parseWindow(view.window);
  // The same date all UTC day; a new day is read at midnight UTC
  const now = useUtcDay();
  const range = useMemo(() => windowRange(windowDays, now, project.timeZone), [windowDays, now, project.timeZone]);

  const engines = useQuery(enginesQuery(scope));
  const enginesErrorId = useErrorId(engines.error);
  const enabled = useMemo(() => (engines.data?.data ?? []).filter((engine) => engine.is_enabled), [engines.data]);
  const { countries } = useCountries();
  const countryName = useMemo(
    () => new Map(countries.map((country) => [country.country_iso, country.name])),
    [countries],
  );
  const list = usePromptList(scope);
  const listErrorId = useErrorId(list.error);
  const summary = useQuery({ ...summaryQuery(scope, range, false), enabled: enabled.length > 0 });
  // Branded prompts stay out, as the rates leave them out (16-metrics-methodology.md rule 4)
  const summaryById = useMemo(
    () => new Map((summary.data?.data.prompts ?? []).map((row) => [row.prompt_id, row])),
    [summary.data],
  );
  const rows = useMemo(
    (): PromptRow[] =>
      list.rows
        .filter((prompt) => !prompt.is_branded)
        .map((prompt) => {
          const topics = topicTermsOf(prompt).map((term) => term.name);
          return {
            prompt,
            summary: summaryById.get(prompt.prompt_id),
            topics: topics.length === 0 ? null : formatList(topics, locale),
            country: prompt.country_iso === null ? null : (countryName.get(prompt.country_iso) ?? prompt.country_iso),
          };
        }),
    [list.rows, summaryById, countryName, locale],
  );

  const { columns, sortFields, searchText, rowName } = usePromptColumns();
  const columnIds = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);
  const sort = useMemo((): readonly SortKey[] => {
    const parsed = parseSort(view.sort, sortFields);
    return parsed.length === 0 ? DEFAULT_SORT : parsed;
  }, [view.sort, sortFields]);
  const visible = useMemo(() => parseColumns(view.cols, columnIds, ['prompt']), [view.cols, columnIds]);
  const density = parseDensity(view.density);

  const waiting = list.loading || engines.isPending || (enabled.length > 0 && summary.isPending);
  const status = ((): TableStatus => {
    if (list.error !== null && list.rows.length === 0) return 'error';
    if (waiting) return 'loading';
    if (rows.length === 0) return 'filtered-empty';
    return summary.isFetching ? 'refetching' : 'ready';
  })();
  const noAnswers = summary.data !== undefined && list.rows.length > 0 && !hasAnswers(summary.data.data);

  const addButton = canWrite ? (
    <Button variant="primary" size="sm" icon={Plus} onClick={() => setAddOpen(true)}>
      {t('addPrompts')}
    </Button>
  ) : null;

  const listError = (
    <InlineError
      title={t('loadFailed')}
      reason={t('loadFailedReason')}
      errorId={listErrorId}
      onRetry={list.refetch}
      retrying={list.fetching}
      retryLabel={common('retry')}
      live
    />
  );
  const filteredEmpty = <EmptyState title={t('emptyFiltered')} reason={t('emptyFilteredReason')} headingLevel={2} />;
  const noPrompts = (
    <EmptyState
      icon={MessageSquare}
      title={t('noPromptsTitle')}
      reason={t('noPromptsReason')}
      headingLevel={2}
      primaryAction={addButton ?? undefined}
    />
  );

  let content: ReactNode;
  if (engines.isError) {
    content = (
      <InlineError
        title={t('enginesFailed')}
        reason={t('loadFailedReason')}
        errorId={enginesErrorId}
        onRetry={() => void engines.refetch()}
        retrying={engines.isFetching}
        retryLabel={common('retry')}
      />
    );
  } else if (engines.data !== undefined && enabled.length === 0) {
    content = (
      <EmptyState
        icon={Power}
        title={t('noEngineTitle')}
        reason={t('noEngineReason')}
        headingLevel={2}
        secondaryAction={
          <TextLink render={<Link href={projectPath(workspaceSlug, project.slug, '/settings/engines')} />}>
            {t('toEngines')}
          </TextLink>
        }
      />
    );
  } else if (!list.loading && list.error === null && list.rows.length === 0) {
    content = noPrompts;
  } else {
    content = (
      <>
        {noAnswers ? <Banner tone="info" placement="region" message={t('noAnswers')} /> : null}
        {summary.isError ? (
          <Banner
            tone="warning"
            placement="region"
            live
            message={t('summaryFailed')}
            actions={
              <Button variant="secondary" size="sm" onClick={() => void summary.refetch()} loading={summary.isFetching}>
                {common('retry')}
              </Button>
            }
          />
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col">
          <DataTable<PromptRow>
            caption={t('caption')}
            itemNoun={{ one: t('noun.one'), other: t('noun.other') }}
            columns={columns}
            getRowId={promptRowId}
            rows={rows}
            total={rows.length}
            sort={sort}
            onSortChange={(next) => void setView({ sort: sameSort(next, DEFAULT_SORT) ? null : formatSort(next) })}
            defaultSort={DEFAULT_SORT}
            density={density}
            onDensityChange={(next: Density) => void setView({ density: next === DEFAULT_DENSITY ? null : next })}
            columnState={{
              visible,
              onChange: (next) => void setView({ cols: next === null ? null : formatColumns(next) }),
            }}
            search={view.q}
            onSearchChange={(next) => void setView({ q: next === '' ? null : next })}
            searchPlaceholder={t('search')}
            searchText={searchText}
            rowName={rowName}
            status={status}
            errorState={listError}
            emptyState={noPrompts}
            filteredEmptyState={filteredEmpty}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <TopBarPortal>
        <div className="w-44">
          <Select<string>
            aria-label={t('window')}
            value={String(windowDays)}
            onValueChange={(next) => void setView({ window: next === String(DEFAULT_WINDOW) ? null : next })}
            placeholder={t('window')}
            options={WINDOW_DAYS.map((days) => ({ value: String(days), label: t('windowOption', { days }) }))}
          />
        </div>
      </TopBarPortal>
      <div className="flex h-page-body min-h-page-body-min flex-col gap-3 px-3 pt-3 pb-5 md:px-4 lg:px-5">
        <PageHeader
          title={t('title')}
          meta={t('meta', {
            from: formatBusinessDate(range.from, { withYear: false }),
            to: formatBusinessDate(range.to),
          })}
          actions={list.rows.length > 0 ? addButton : undefined}
        />
        {content}
      </div>
      {canWrite ? (
        <AddPromptsDialog
          scope={scope}
          open={addOpen}
          onOpenChange={setAddOpen}
          engines={enabled}
          existing={list.rows}
          defaults={{ languageCode: project.defaultLanguage, countryIso: project.defaultCountryIso }}
        />
      ) : null}
    </>
  );
}
