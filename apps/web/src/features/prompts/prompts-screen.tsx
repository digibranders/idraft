'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Ban, MessageSquare, Plus, Power } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { AddPromptsDialog } from './add-prompts-dialog';
import { DEFAULT_SORT, usePromptColumns, type PromptRow } from './prompt-columns';
import { DEFAULT_WINDOW, hasAnswers, parseWindow, topicTermsOf, WINDOW_DAYS, windowRange } from './prompt-model';
import { enginesQuery, summaryQuery, usePromptList, type PromptScope } from './prompt-queries';
import { DataTable } from '@/components/app/data-table/data-table';
import type { TableStatus } from '@/components/app/data-table/types';
import { FilterBar } from '@/components/app/filters/filter-bar';
import { ReadOnlyFilterChips } from '@/components/app/filters/read-only-chips';
import type { FilterField } from '@/components/app/filters/types';
import { useUrlFilters } from '@/components/app/filters/use-url-filters';
import { PAGE_CLASS, PageHeader } from '@/components/app/shell/page-header';
import { TopBarPortal } from '@/components/app/shell/top-bar-slot';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { TextLink } from '@/components/ui/text-link';
import { toast } from '@/components/ui/toast';
import { useErrorId } from '@/lib/api/use-error-id';
import { useUtcDay } from '@/lib/dom/use-utc-day';
import { enumValuesOf } from '@/lib/filters/filter-values';
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
 * days (28 by default, in the top bar as a project-wide scope), with Mentioned and Cited per enabled engine.
 * The filter bar narrows by topic, country and engine; branded prompts are left out of the table and the
 * counts until the Branded filter includes them (16-metrics-methodology.md rule 4). A project
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

  // The options are the topics and countries the prompts carry: a value from a link waits until every page is in
  const optionsPending = list.loading || list.fetching || list.error !== null;
  const fields = useMemo((): FilterField[] => {
    const topicNames = new Map<string, string>();
    for (const prompt of list.rows) for (const term of topicTermsOf(prompt)) topicNames.set(term.term_id, term.name);
    const isos = new Set(list.rows.flatMap((prompt) => (prompt.country_iso === null ? [] : [prompt.country_iso])));
    return [
      {
        id: 'topic',
        kind: 'enum',
        label: t('filters.topic'),
        multi: true,
        optionsLoading: optionsPending,
        options: [...topicNames].map(([value, label]) => ({ value, label })),
      },
      {
        id: 'country',
        kind: 'enum',
        label: t('filters.country'),
        multi: true,
        optionsLoading: optionsPending,
        options: [...isos].map((iso) => ({ value: iso, label: countryName.get(iso) ?? iso })),
      },
      {
        id: 'engine',
        kind: 'enum',
        label: t('filters.engine'),
        multi: true,
        optionsLoading: engines.isPending,
        options: enabled.map((engine) => ({ value: engine.engine.engine_code, label: engine.engine.label })),
      },
      {
        id: 'branded',
        kind: 'enum',
        label: t('filters.branded'),
        multi: false,
        options: [{ value: 'include', label: t('filters.brandedInclude') }],
      },
    ];
  }, [t, list.rows, optionsPending, countryName, enabled, engines.isPending]);
  // A filter of a shared link that does not read is left out, and the person is told (13 section 5)
  const [values, setValues] = useUrlFilters(fields, {
    onDropped: (dropped) =>
      toast({
        type: 'info',
        title: t('droppedFilters.title', { count: dropped.length }),
        description: t('droppedFilters.description', {
          fields: formatList(
            dropped.map((field) => field.label),
            locale,
          ),
        }),
      }),
  });
  const filtered = Object.keys(values).length > 0;
  const clearFilters = useCallback(() => setValues({}), [setValues]);
  const includeBranded = enumValuesOf(values.branded).includes('include');
  // Only the engines the Engine filter names, else every engine that is on
  const shown = useMemo(() => {
    const chosen = enumValuesOf(values.engine);
    return chosen.length === 0 ? enabled : enabled.filter((engine) => chosen.includes(engine.engine.engine_code));
  }, [enabled, values.engine]);

  // The table stays on the last counts while a new window, or the Branded filter, is read
  const summary = useQuery({
    ...summaryQuery(scope, range, includeBranded),
    enabled: enabled.length > 0,
    placeholderData: keepPreviousData,
  });
  const summaryById = useMemo(
    () => new Map((summary.data?.data.prompts ?? []).map((row) => [row.prompt_id, row])),
    [summary.data],
  );
  // Branded prompts stay out of the table and the counts until included (16-metrics-methodology.md rule 4)
  const rows = useMemo((): PromptRow[] => {
    const topics = enumValuesOf(values.topic);
    const countries = enumValuesOf(values.country);
    return list.rows
      .filter(
        (prompt) =>
          (includeBranded || !prompt.is_branded) &&
          (topics.length === 0 || topicTermsOf(prompt).some((term) => topics.includes(term.term_id))) &&
          (countries.length === 0 || (prompt.country_iso !== null && countries.includes(prompt.country_iso))),
      )
      .map((prompt) => {
        const topicNames = topicTermsOf(prompt).map((term) => term.name);
        return {
          prompt,
          summary: summaryById.get(prompt.prompt_id),
          topics: topicNames.length === 0 ? null : formatList(topicNames, locale),
          country: prompt.country_iso === null ? null : (countryName.get(prompt.country_iso) ?? prompt.country_iso),
        };
      });
  }, [list.rows, includeBranded, values.topic, values.country, summaryById, countryName, locale]);

  const { columns, sortFields, searchText, rowName } = usePromptColumns(shown);
  const columnIds = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);
  const sort = useMemo((): readonly SortKey[] => {
    const parsed = parseSort(view.sort, sortFields);
    return parsed.length === 0 ? DEFAULT_SORT : parsed;
  }, [view.sort, sortFields]);
  const visible = useMemo(() => parseColumns(view.cols, columnIds, ['prompt']), [view.cols, columnIds]);
  const density = parseDensity(view.density);

  // The summary is pending only before its first answer: a new window keeps the last counts meanwhile
  const waiting = list.loading || engines.isPending || (enabled.length > 0 && summary.isPending);
  const status = ((): TableStatus => {
    if (list.error !== null && list.rows.length === 0) return 'error';
    if (waiting) return 'loading';
    // Without a search or a filter, nothing to show means no prompts (an all branded project too), not no match
    if (rows.length === 0) return view.q === '' && !filtered ? 'empty' : 'filtered-empty';
    // Later pages of the list may still be on their way
    return summary.isFetching || list.fetching ? 'refetching' : 'ready';
  })();
  const listIncomplete = list.error !== null && list.rows.length > 0;
  // Counts of the last window are not the answer to "has any prompt an answer" for this one
  const noAnswers =
    summary.data !== undefined && !summary.isPlaceholderData && rows.length > 0 && !hasAnswers(summary.data.data);

  // Not before the engines are known: the dialog takes the enabled ones
  const addButton =
    canWrite && engines.data !== undefined ? (
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
  const filteredEmpty = (
    <EmptyState
      title={t('emptyFiltered')}
      reason={t('emptyFilteredReason')}
      headingLevel={2}
      details={filtered ? <ReadOnlyFilterChips fields={fields} values={values} /> : undefined}
      primaryAction={
        filtered ? (
          <Button variant="secondary" onClick={clearFilters}>
            {t('clearFilters')}
          </Button>
        ) : undefined
      }
    />
  );
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
  // The filters belong to the table: the other states have nothing to filter
  let toolbar: ReactNode;
  // A failed read in the background leaves the page as it is
  if (engines.isError && engines.data === undefined) {
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
  } else if (engines.data !== undefined && !list.loading && list.error === null && list.rows.length === 0) {
    content = noPrompts;
  } else {
    toolbar = <FilterBar fields={fields} values={values} onChange={setValues} />;
    content = (
      <>
        {noAnswers ? <Banner tone="info" placement="region" message={t('noAnswers')} /> : null}
        {listIncomplete ? (
          <Banner
            tone="warning"
            placement="region"
            live
            message={t('listPartial')}
            actions={
              <Button variant="secondary" size="sm" onClick={list.refetch} loading={list.fetching}>
                {common('retry')}
              </Button>
            }
          />
        ) : null}
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
          toolbar={toolbar}
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
