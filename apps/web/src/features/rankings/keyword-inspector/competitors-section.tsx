'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Swords } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type FormEvent, type ReactElement, type RefObject } from 'react';

import {
  COMPETITORS,
  competitorCandidates,
  effectiveCompetitorIds,
  overridesFor,
  projectEntitiesQuery,
  refreshAfterWrite,
  type KeywordDetail,
  type KeywordScope,
  type ProjectEntity,
} from './inspector-queries';
import { EditButton, useEditFocus, type SectionEdit } from './section-edit';
import { SectionError } from './section-error';
import { EntitySwatch } from '@/components/app/entity/entity-swatch';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Fieldset } from '@/components/ui/field';
import { FormAlert } from '@/components/ui/form-alert';
import { announce } from '@/lib/a11y/announcer';
import { apiMutation } from '@/lib/api/query';
import { formatList } from '@/lib/format';

/**
 * The competitors rank checks compare this keyword against: the project's SEO competitors, with some left
 * out or watched entities added for this keyword alone. Editing ticks the set; saving sends whatever
 * differs from the project's default as the keyword's overrides.
 */
export function CompetitorsSection({
  scope,
  detail,
  edit,
}: {
  scope: KeywordScope;
  detail: KeywordDetail;
  edit: SectionEdit;
}): ReactElement {
  const t = useTranslations('rankings.inspector.competitors');
  const locale = useLocale();
  const focus = useEditFocus(edit.active);
  const entities = useQuery(projectEntitiesQuery(scope));
  const all = useMemo(() => entities.data?.data ?? [], [entities.data]);
  const candidates = useMemo(() => competitorCandidates(all), [all]);
  const effective = effectiveCompetitorIds(all, detail.competitor_overrides);
  const included = new Set(
    detail.competitor_overrides.filter((item) => item.mode === 'include').map((item) => item.entity.entity_id),
  );
  const shown = candidates.filter((entity) => effective.has(entity.entity.entity_id));
  const leftOut = detail.competitor_overrides
    .filter((item) => item.mode === 'exclude')
    .map((item) => item.entity.canonical_name);

  const status = entities.isPending ? 'loading' : entities.isError ? 'error' : 'ready';
  return (
    <InspectorSection
      title={t('title')}
      icon={Swords}
      status={status}
      action={
        edit.active || status !== 'ready' || candidates.length === 0 ? null : (
          <EditButton section={t('title')} edit={edit} buttonRef={focus.edit} />
        )
      }
      error={
        <SectionError
          title={t('failed')}
          error={entities.error}
          onRetry={() => void entities.refetch()}
          retrying={entities.isFetching}
        />
      }
    >
      {edit.active ? (
        <CompetitorsForm
          scope={scope}
          candidates={candidates}
          entities={all}
          effective={effective}
          edit={edit}
          formRef={focus.form}
        />
      ) : candidates.length === 0 ? (
        <EmptyState variant="inline" title={t('noCandidates')} reason={t('noCandidatesReason')} headingLevel={3} />
      ) : shown.length === 0 ? (
        <EmptyState variant="inline" title={t('none')} reason={t('noneReason')} headingLevel={3} />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="type-meta">{t('description')}</p>
          <ul className="flex flex-col gap-2">
            {shown.map((entity) => (
              <li key={entity.entity.entity_id} className="flex min-w-0 items-center gap-2">
                <EntitySwatch colorIndex={entity.color_index} own={false} />
                <span className="min-w-0 truncate type-body">{entity.entity.canonical_name}</span>
                {included.has(entity.entity.entity_id) ? <Badge>{t('added')}</Badge> : null}
              </li>
            ))}
          </ul>
          {leftOut.length === 0 ? null : (
            <p className="type-meta">{t('leftOut', { names: formatList(leftOut, locale) })}</p>
          )}
        </div>
      )}
    </InspectorSection>
  );
}

function CompetitorsForm({
  scope,
  candidates,
  entities,
  effective,
  edit,
  formRef,
}: {
  scope: KeywordScope;
  candidates: readonly ProjectEntity[];
  entities: readonly ProjectEntity[];
  effective: ReadonlySet<string>;
  edit: SectionEdit;
  formRef: RefObject<HTMLFormElement | null>;
}): ReactElement {
  const t = useTranslations('rankings.inspector.competitors');
  const inspector = useTranslations('rankings.inspector');
  const queryClient = useQueryClient();
  // Only what the form can show: an override for an entity that lost its role in the project is dropped on save
  const [initial] = useState(
    () => new Set(candidates.map((entity) => entity.entity.entity_id).filter((id) => effective.has(id))),
  );
  const [chosen, setChosen] = useState<ReadonlySet<string>>(initial);
  const [alert, setAlert] = useState<string | null>(null);
  const put = useMutation(apiMutation('put', COMPETITORS));
  const dirty = chosen.size !== initial.size || [...chosen].some((id) => !initial.has(id));
  const { setDirty, setSaving, stop } = edit;
  useEffect(() => setDirty(dirty), [dirty, setDirty]);

  const toggle = (id: string, on: boolean): void =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (put.isPending) return;
    if (!dirty) {
      stop();
      return;
    }
    setAlert(null);
    setSaving(true);
    try {
      await put.mutateAsync({
        params: {
          path: {
            workspace_id: scope.workspaceId,
            project_id: scope.projectId,
            tracked_keyword_id: scope.trackedKeywordId,
          },
        },
        body: overridesFor(entities, chosen),
      });
      await refreshAfterWrite(queryClient, scope);
      announce(inspector('savedAnnouncement', { section: t('title') }));
      stop();
    } catch {
      setAlert(inspector('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      ref={formRef}
      id={edit.formId}
      noValidate
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-3"
    >
      {alert === null ? null : <FormAlert message={alert} />}
      <p className="type-meta">{t('description')}</p>
      <Fieldset legend={t('fieldset')} className="gap-2">
        {candidates.map((entity) => (
          <Checkbox
            key={entity.entity.entity_id}
            checked={chosen.has(entity.entity.entity_id)}
            onCheckedChange={(on) => toggle(entity.entity.entity_id, on)}
            label={entity.entity.canonical_name}
            {...(entity.role === 'watch' ? { description: t('watch') } : {})}
          />
        ))}
      </Fieldset>
    </form>
  );
}
