'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Tags } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactElement, type RefObject } from 'react';
import { useForm } from 'react-hook-form';

import {
  GROUP_MEMBERS,
  GROUP_MEMBERS_REMOVE,
  TERM_ASSIGNMENTS,
  refreshAfterWrite,
  type KeywordDetail,
  type KeywordScope,
} from './inspector-queries';
import { EditButton, useEditFocus, type SectionEdit } from './section-edit';
import { useKeywordGroups, useVocabularies, type VocabularyTerms } from '../taxonomy-queries';
import { FormField } from '@/components/app/forms/form-field';
import { useSubmitOnce } from '@/components/app/forms/use-form-helpers';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { FormAlert } from '@/components/ui/form-alert';
import { MultiSelect } from '@/components/ui/multi-select';
import { Select } from '@/components/ui/select';
import { Tag } from '@/components/ui/tag';
import { announce } from '@/lib/a11y/announcer';
import { apiMutation } from '@/lib/api/query';

/** A group or a term as a choice: its id and its place by name. */
interface Choice {
  id: string;
  label: string;
}

interface LinkValues {
  groups: string[];
  /** The chosen term ids by vocabulary id. */
  terms: Record<string, string[]>;
}

/** No term of a single-valued vocabulary. */
const NO_TERM = '';

const valuesOf = (detail: KeywordDetail, vocabularies: readonly VocabularyTerms[]): LinkValues => ({
  groups: detail.groups.map((group) => group.group_id),
  terms: Object.fromEntries(
    vocabularies.map(({ vocabulary }) => [
      vocabulary.vocabulary_id,
      detail.terms.filter((term) => term.vocabulary_id === vocabulary.vocabulary_id).map((term) => term.term_id),
    ]),
  ),
});

/**
 * The keyword's groups and the terms of the vocabularies the project sees (16 section 2.5: tags and group
 * are edits in place). Saving adds and removes the keyword in each changed group and assigns the changed
 * terms; a term of a single-valued vocabulary replaces the one it had.
 */
export function LinksSection({
  scope,
  detail,
  edit,
}: {
  scope: KeywordScope;
  detail: KeywordDetail;
  edit: SectionEdit;
}): ReactElement {
  const t = useTranslations('rankings.inspector.links');
  const focus = useEditFocus(edit.active);
  const vocabularies = useVocabularies(scope);
  const groups = useKeywordGroups(scope);
  // The editor offers every group and term, so it opens once the lists are in
  const listsReady = !vocabularies.pending && !vocabularies.error && groups.isSuccess;
  const groupChoices = useMemo(
    (): Choice[] => (groups.data?.data ?? []).map((group) => ({ id: group.group_id, label: group.path })),
    [groups.data],
  );
  const termNames = useMemo(
    () => new Map(vocabularies.loaded.flatMap(({ terms }) => terms.map((term) => [term.termId, term.path] as const))),
    [vocabularies.loaded],
  );
  const vocabularyNames = new Map(
    vocabularies.loaded.map(({ vocabulary }) => [vocabulary.vocabulary_id, vocabulary.name] as const),
  );
  // The keyword's terms by vocabulary, in the order the API lists the vocabularies
  const termRows = [...new Set(detail.terms.map((term) => term.vocabulary_id))].map((vocabularyId) => ({
    vocabularyId,
    name: vocabularyNames.get(vocabularyId) ?? t('tags'),
    terms: detail.terms.filter((term) => term.vocabulary_id === vocabularyId),
  }));

  return (
    <InspectorSection
      title={t('title')}
      icon={Tags}
      status="ready"
      action={
        edit.active || !listsReady ? null : <EditButton section={t('title')} edit={edit} buttonRef={focus.edit} />
      }
    >
      {edit.active ? (
        <LinksForm
          scope={scope}
          detail={detail}
          edit={edit}
          formRef={focus.form}
          vocabularies={vocabularies.loaded}
          groupChoices={groupChoices}
        />
      ) : (
        <dl className="flex flex-col gap-3">
          <LinkRow label={t('groups')} empty={t('noGroups')} labels={detail.groups.map((group) => group.path)} />
          {termRows.length === 0 ? (
            <LinkRow label={t('tags')} empty={t('noTags')} labels={[]} />
          ) : (
            termRows.map((row) => (
              <LinkRow
                key={row.vocabularyId}
                label={row.name}
                empty={t('noTags')}
                labels={row.terms.map((term) => termNames.get(term.term_id) ?? term.name)}
              />
            ))
          )}
        </dl>
      )}
    </InspectorSection>
  );
}

function LinkRow({ label, empty, labels }: { label: string; empty: string; labels: readonly string[] }): ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="type-label text-foreground-tertiary">{label}</dt>
      <dd className="flex flex-wrap gap-1.5">
        {labels.length === 0 ? (
          <span className="type-body text-foreground-secondary">{empty}</span>
        ) : (
          labels.map((text) => <Tag key={text} label={text} />)
        )}
      </dd>
    </div>
  );
}

function LinksForm({
  scope,
  detail,
  edit,
  formRef,
  vocabularies,
  groupChoices,
}: {
  scope: KeywordScope;
  detail: KeywordDetail;
  edit: SectionEdit;
  formRef: RefObject<HTMLFormElement | null>;
  vocabularies: readonly VocabularyTerms[];
  groupChoices: readonly Choice[];
}): ReactElement {
  const t = useTranslations('rankings.inspector.links');
  const inspector = useTranslations('rankings.inspector');
  const queryClient = useQueryClient();
  const [alert, setAlert] = useState<string | null>(null);
  // What the keyword had when the edit began: a teammate's change that arrives meanwhile is not undone
  const [initial] = useState(() => valuesOf(detail, vocabularies));
  const form = useForm<LinkValues>({ defaultValues: initial });
  const addMembers = useMutation(apiMutation('post', GROUP_MEMBERS));
  const removeMembers = useMutation(apiMutation('post', GROUP_MEMBERS_REMOVE));
  const assign = useMutation(apiMutation('post', TERM_ASSIGNMENTS));
  const { isDirty } = form.formState;
  const { setDirty, setSaving, stop } = edit;
  useEffect(() => setDirty(isDirty), [isDirty, setDirty]);

  const groupById = new Map(groupChoices.map((choice) => [choice.id, choice]));
  // A group of the keyword's that the list has not loaded still shows by its path
  for (const group of detail.groups) {
    if (!groupById.has(group.group_id)) groupById.set(group.group_id, { id: group.group_id, label: group.path });
  }

  const project = { workspace_id: scope.workspaceId, project_id: scope.projectId };
  const id = detail.tracked_keyword_id;
  const submit = useSubmitOnce(
    form.handleSubmit(async (values) => {
      setAlert(null);
      setSaving(true);
      // Each request is whole on its own; a retry after a partial save sends them again, which changes nothing twice
      let landed = 0;
      try {
        const before = new Set(initial.groups);
        const after = new Set(values.groups);
        for (const groupId of values.groups.filter((group) => !before.has(group))) {
          await addMembers.mutateAsync({
            params: { path: { ...project, group_id: groupId } },
            body: { tracked_keyword_ids: [id] },
          });
          landed += 1;
        }
        for (const groupId of initial.groups.filter((group) => !after.has(group))) {
          await removeMembers.mutateAsync({
            params: { path: { ...project, group_id: groupId } },
            body: { tracked_keyword_ids: [id] },
          });
          landed += 1;
        }
        // A changed vocabulary that keeps terms is replaced in one request; one that was emptied is cleared
        const replaced: string[] = [];
        const cleared: string[] = [];
        for (const { vocabulary } of vocabularies) {
          const had = initial.terms[vocabulary.vocabulary_id] ?? [];
          const has = values.terms[vocabulary.vocabulary_id] ?? [];
          if (had.length === has.length && had.every((term) => has.includes(term))) continue;
          if (has.length > 0) replaced.push(...has);
          else cleared.push(...had);
        }
        if (replaced.length > 0) {
          await assign.mutateAsync({
            params: { path: project },
            body: { op: 'replace', subject_type: 'tracked_keyword', subject_ids: [id], term_ids: replaced },
          });
          landed += 1;
        }
        if (cleared.length > 0) {
          await assign.mutateAsync({
            params: { path: project },
            body: { op: 'remove', subject_type: 'tracked_keyword', subject_ids: [id], term_ids: cleared },
          });
          landed += 1;
        }
        await refreshAfterWrite(queryClient, scope);
        announce(inspector('savedAnnouncement', { section: t('title') }));
        stop();
      } catch {
        // What landed shows in read mode once the person leaves; the form keeps their choices for a retry
        void refreshAfterWrite(queryClient, scope);
        setAlert(inspector(landed > 0 ? 'partialSave' : 'saveFailed'));
      } finally {
        setSaving(false);
      }
    }),
  );

  return (
    <form ref={formRef} id={edit.formId} noValidate onSubmit={submit} className="flex flex-col gap-4">
      {alert === null ? null : <FormAlert message={alert} />}
      <FormField
        control={form.control}
        name="groups"
        label={t('groups')}
        render={(field) => (
          <MultiSelect<Choice>
            inputRef={field.ref}
            onBlur={field.onBlur}
            value={field.value.flatMap((groupId) => groupById.get(groupId) ?? [])}
            onValueChange={(chosen) => field.onChange(chosen.map((choice) => choice.id))}
            items={groupChoices}
            itemToString={(choice) => choice.label}
            itemKey={(choice) => choice.id}
            placeholder={t('groupsPlaceholder')}
            emptyText={(query) => t('groupsEmpty', { query })}
            chipsLabel={t('chips', { field: t('groups') })}
            removeLabel={(value) => t('remove', { value })}
            chipsHint={(count) => t('chipsHint', { count })}
            chipHint={t('chipHint')}
          />
        )}
      />
      {vocabularies.map(({ vocabulary, terms }) => {
        const choices = terms.map((term) => ({ id: term.termId, label: term.path }));
        const byId = new Map(choices.map((choice) => [choice.id, choice]));
        return (
          <FormField
            key={vocabulary.vocabulary_id}
            control={form.control}
            name={`terms.${vocabulary.vocabulary_id}`}
            label={vocabulary.name}
            {...(vocabulary.is_single_valued ? { description: t('single') } : {})}
            render={(field) =>
              vocabulary.is_single_valued ? (
                <Select<string>
                  {...field.controlProps}
                  value={field.value[0] ?? NO_TERM}
                  onValueChange={(value) => field.onChange(value === NO_TERM ? [] : [value])}
                  placeholder={t('noTerm')}
                  options={[
                    { value: NO_TERM, label: t('noTerm') },
                    ...choices.map((choice) => ({ value: choice.id, label: choice.label })),
                  ]}
                />
              ) : (
                <MultiSelect<Choice>
                  inputRef={field.ref}
                  onBlur={field.onBlur}
                  value={field.value.flatMap((termId) => byId.get(termId) ?? [])}
                  onValueChange={(chosen) => field.onChange(chosen.map((choice) => choice.id))}
                  items={choices}
                  itemToString={(choice) => choice.label}
                  itemKey={(choice) => choice.id}
                  placeholder={t('termsPlaceholder')}
                  emptyText={(query) => t('termsEmpty', { query })}
                  chipsLabel={t('chips', { field: vocabulary.name })}
                  removeLabel={(value) => t('remove', { value })}
                  chipsHint={(count) => t('chipsHint', { count })}
                  chipHint={t('chipHint')}
                />
              )
            }
          />
        );
      })}
    </form>
  );
}
