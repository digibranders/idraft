'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChartColumn } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useMemo, useState, type ReactElement } from 'react';

import { CompetitorsSection } from './competitors-section';
import { DepthDialog } from './depth-dialog';
import { KeywordMetricStrip, VolumeByMonth } from './demand-section';
import { HistorySection } from './history-section';
import { DETAIL, detailQuery, refreshAfterWrite, type KeywordDetail, type KeywordScope } from './inspector-queries';
import { LinksSection } from './links-section';
import type { EditableSection, SectionEdit } from './section-edit';
import { SectionError } from './section-error';
import { TrackingSection } from './tracking-section';
import { DEPTH_KEY } from '../keyword-values';
import type { ProjectScope } from '../rankings-queries';
import { Inspector } from '@/components/app/inspector/inspector';
import { InspectorFooter } from '@/components/app/inspector/inspector-footer';
import type { InspectorNavigation } from '@/components/app/inspector/inspector-header';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { InspectorPanel, InspectorTabs } from '@/components/app/inspector/inspector-tabs';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { MenuItemDef } from '@/components/ui/menu';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import type { TrackedKeywordRow } from '@/lib/api/types';
import { formatInteger, formatRelative } from '@/lib/format';
import { languageName } from '@/lib/format/language';
import { useCan } from '@/lib/permissions';

export interface KeywordInspectorProps {
  scope: ProjectScope;
  trackedKeywordId: string;
  /** The keyword's row of the list, so the title shows while the keyword loads; `null` from a shared link. */
  row: TrackedKeywordRow | null;
  /** The project's time zone, for dates. */
  timeZone: string;
  /** "12 of 986"; `null` when the keyword is not in the list. */
  positionText: string | null;
  navigation: InspectorNavigation | null;
  onStep: ((direction: 'next' | 'previous') => void) | undefined;
  onClose: () => void;
  /**
   * Whether a section holds unsaved changes, which the screen asks about before the inspector leaves the
   * keyword, or is saving them, which holds the inspector on the keyword until the answer.
   */
  onEditStateChange: (state: InspectorEditState) => void;
  /** Counts the person's "Discard changes": each one ends the edit, even when the keyword stays the same. */
  discards: number;
  /** The keyword is not among the rows the filters match (24-page-templates.md section 9.3, States). */
  hiddenByFilters: boolean;
}

type Tab = 'overview';

export type InspectorEditState = 'clean' | 'dirty' | 'saving';

/** The section being edited, of which keyword, and its form's state. */
interface EditState {
  id: string;
  section: EditableSection;
  dirty: boolean;
  saving: boolean;
}

/**
 * The keyword inspector of Rankings for step 5 part 1 (23-application-patterns.md section 4.2, 16 section
 * 2): the keyword with its scope, depth and state in the header, then one tab, Overview, of cards: Labs
 * metrics and searches by month, groups and tags, tracking settings, competitors and the configuration
 * history. SERP, AI and Timeline join with their steps. A section edits in place behind Edit, one at a
 * time, with Cancel and Save in the footer.
 */
export function KeywordInspector({
  scope,
  trackedKeywordId,
  row,
  timeZone,
  positionText,
  navigation,
  onStep,
  onClose,
  onEditStateChange,
  discards,
  hiddenByFilters,
}: KeywordInspectorProps): ReactElement {
  const t = useTranslations('rankings.inspector');
  const filters = useTranslations('rankings.filters');
  const common = useTranslations('common');
  const inspector = useTranslations('inspector');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const canWrite = useCan('keywords:write');
  const keywordScope: KeywordScope = { ...scope, trackedKeywordId };
  const detail = useQuery(detailQuery(keywordScope));
  const data = detail.data?.data ?? null;

  // Edit mode belongs to one keyword. Its handlers carry the keyword's id, so a save that answers after the
  // person moved on ends nothing of the keyword now shown. Stepping or a discard starts in read mode.
  const formId = useId();
  const [editing, setEditing] = useState<EditState | null>(null);
  const [shown, setShown] = useState({ id: trackedKeywordId, discards });
  if (shown.id !== trackedKeywordId || shown.discards !== discards) {
    setShown({ id: trackedKeywordId, discards });
    setEditing(null);
  }
  const current = editing?.id === trackedKeywordId ? editing : null;
  const section = current?.section ?? null;
  const saving = current?.saving ?? false;
  const update = useCallback((id: string, change: Partial<Pick<EditState, 'dirty' | 'saving'>>): void => {
    setEditing((state) => {
      if (state === null || state.id !== id) return state;
      const next = { ...state, ...change };
      return next.dirty === state.dirty && next.saving === state.saving ? state : next;
    });
  }, []);
  const handlers = useMemo(
    () => ({
      stop: (): void => setEditing((state) => (state?.id === trackedKeywordId ? null : state)),
      setDirty: (dirty: boolean): void => update(trackedKeywordId, { dirty }),
      setSaving: (pending: boolean): void => update(trackedKeywordId, { saving: pending }),
    }),
    [trackedKeywordId, update],
  );
  const editOf = (name: EditableSection): SectionEdit => ({
    active: section === name,
    available: canWrite && section === null,
    start: () => setEditing({ id: trackedKeywordId, section: name, dirty: false, saving: false }),
    formId,
    ...handlers,
  });
  const editState: InspectorEditState =
    current === null ? 'clean' : current.saving ? 'saving' : current.dirty ? 'dirty' : 'clean';
  useEffect(() => onEditStateChange(editState), [editState, onEditStateChange]);
  useEffect(() => () => onEditStateChange('clean'), [onEditStateChange]);

  const [depthOpen, setDepthOpen] = useState(false);
  const patch = useMutation(apiMutation('patch', DETAIL));
  const setActive = async (active: boolean, keyword: KeywordDetail, undo: boolean): Promise<void> => {
    try {
      await patch.mutateAsync({
        params: {
          path: {
            workspace_id: scope.workspaceId,
            project_id: scope.projectId,
            tracked_keyword_id: keyword.tracked_keyword_id,
          },
        },
        body: { is_active: active },
      });
      void refreshAfterWrite(queryClient, { ...scope, trackedKeywordId: keyword.tracked_keyword_id });
      if (active) {
        toast({ type: 'success', title: t('archive.unarchived') });
        return;
      }
      toast({
        type: 'success',
        title: t('archive.archived'),
        description: t('archive.archivedDescription', { keyword: keyword.keyword.text }),
        ...(undo ? { action: { label: t('archive.undo'), onAction: () => void setActive(true, keyword, false) } } : {}),
      });
    } catch (error) {
      const used = isApiProblem(error, 'quota_exceeded') ? error.number('used') : null;
      const limit = isApiProblem(error, 'quota_exceeded') ? error.number('limit') : null;
      toast({
        type: 'error',
        title: active ? t('archive.unarchiveFailed') : t('archive.failed'),
        ...(used !== null && limit !== null
          ? { description: t('archive.quota', { used: formatInteger(used), limit: formatInteger(limit) }) }
          : {}),
      });
    }
  };

  const moreActions: MenuItemDef[] =
    data === null || !canWrite
      ? []
      : [
          { id: 'depth', label: t('more.changeDepth'), onSelect: () => setDepthOpen(true) },
          data.is_active
            ? { id: 'archive', label: t('more.archive'), onSelect: () => void setActive(false, data, true) }
            : { id: 'unarchive', label: t('more.unarchive'), onSelect: () => void setActive(true, data, false) },
        ];

  const title = data?.keyword.text ?? row?.keyword.text ?? '';
  const scopeOf = data ?? row;
  const badges =
    scopeOf === null ? null : (
      <>
        <Badge>
          {t('scope', {
            location: scopeOf.location.name,
            device: filters(`devices.${scopeOf.device}`),
          })}
        </Badge>
        <Badge>
          {t('engine', {
            engine: t(`engines.${scopeOf.search_engine}`),
            language: languageName(scopeOf.language_code, locale),
          })}
        </Badge>
        <Badge>{t('depth', { depth: filters(`depths.${DEPTH_KEY[scopeOf.depth_profile]}`) })}</Badge>
        {scopeOf.is_active ? null : <Badge tone="warning">{t('archived')}</Badge>}
      </>
    );
  const fetchedAt = (data ?? row)?.metrics?.fetched_at ?? null;
  const notFound = isApiProblem(detail.error, 'not_found');

  return (
    <Inspector
      type="keyword"
      backLabel={t('back')}
      onClose={onClose}
      onStep={onStep}
      header={{
        title,
        ...(scopeOf === null ? {} : { lang: scopeOf.language_code }),
        typeLabel: t('type'),
        typeNoun: t('noun'),
        positionText,
        navigation,
        badges,
        freshness:
          fetchedAt === null ? null : <span>{t('updated', { time: formatRelative(fetchedAt, timeZone) })}</span>,
        moreActions,
      }}
      footer={
        section === null ? undefined : (
          <InspectorFooter
            secondary={
              <Button variant="secondary" onClick={handlers.stop} disabled={saving}>
                {common('cancel')}
              </Button>
            }
            primary={
              <Button type="submit" form={formId} variant="primary" loading={saving}>
                {common('save')}
              </Button>
            }
          />
        )
      }
    >
      <InspectorTabs<Tab>
        label={t('tabs')}
        value="overview"
        onValueChange={() => undefined}
        items={[{ value: 'overview', label: t('overview') }]}
      >
        <InspectorPanel<Tab> value="overview">
          {hiddenByFilters ? <Banner tone="info" placement="region" message={t('hidden')} /> : null}
          {detail.isError && data === null ? (
            notFound ? (
              <EmptyState
                variant="inline"
                title={t('loadFailed')}
                reason={inspector('notFound', { type: t('noun') })}
                headingLevel={3}
              />
            ) : (
              <SectionError
                title={t('loadFailed')}
                error={detail.error}
                onRetry={() => void detail.refetch()}
                retrying={detail.isFetching}
              />
            )
          ) : (
            <>
              <KeywordMetricStrip detail={data} />
              {data === null ? (
                <InspectorSection title={t('demand.title')} icon={ChartColumn} status="loading" />
              ) : (
                <>
                  <VolumeByMonth workspaceId={scope.workspaceId} detail={data} />
                  <LinksSection scope={keywordScope} detail={data} edit={editOf('links')} />
                  <TrackingSection scope={keywordScope} detail={data} timeZone={timeZone} edit={editOf('tracking')} />
                  <CompetitorsSection scope={keywordScope} detail={data} edit={editOf('competitors')} />
                  <HistorySection scope={keywordScope} timeZone={timeZone} />
                  <DepthDialog
                    key={`${data.tracked_keyword_id}:${String(data.config_version)}`}
                    scope={keywordScope}
                    detail={data}
                    open={depthOpen}
                    onOpenChange={setDepthOpen}
                  />
                </>
              )}
            </>
          )}
        </InspectorPanel>
      </InspectorTabs>
    </Inspector>
  );
}
