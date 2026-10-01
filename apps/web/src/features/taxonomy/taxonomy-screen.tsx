'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode } from 'react';

import {
  ancestorsOf,
  flatten,
  refreshTerms,
  termsQuery,
  vocabulariesQuery,
  type TermNode,
  type Vocabulary,
} from './taxonomy-queries';
import { TermDialog, type TermAction } from './term-dialogs';
import { VocabularyDialog } from './vocabulary-dialog';
import { Banner } from '@/components/app/status/banner';
import { InlineError } from '@/components/app/status/inline-error';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { TreeView, type TreeViewNode } from '@/components/ui/tree-view';
import { announce } from '@/lib/a11y/announcer';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import { canWriteSharedTaxonomy, useCan, useMembership } from '@/lib/permissions';

const DELETE_TERM = apiMutation('delete', '/api/v1/workspaces/{workspace_id}/terms/{term_id}');
const DELETE_VOCABULARY = apiMutation('delete', '/api/v1/workspaces/{workspace_id}/vocabularies/{vocabulary_id}');
const SKELETON_ROWS = 4;

const toTree = (nodes: readonly TermNode[]): TreeViewNode[] =>
  nodes.map((node) => ({ id: node.term_id, label: node.name, children: toTree(node.children) }));

export interface TaxonomyScreenProps {
  workspaceId: string;
  projectId: string;
}

/**
 * Settings > Project settings > Taxonomy (20 section 5.19.7): the vocabularies this project sees, its own
 * and the workspace's, and the terms of one as a tree. Terms are added, renamed, moved with "Move to" and
 * deleted from the toolbar, which acts on the selected term. Read-only without `taxonomy:write`.
 */
export function TaxonomyScreen({ workspaceId, projectId }: TaxonomyScreenProps): ReactNode {
  const t = useTranslations('taxonomySettings');
  const common = useTranslations('common');
  const canWrite = useCan('taxonomy:write');
  // A member limited to some projects changes only their projects' vocabularies, not the shared ones
  const canWriteShared = canWriteSharedTaxonomy(useMembership());
  const vocabularies = useQuery(vocabulariesQuery(workspaceId, projectId));
  const [chosen, setChosen] = useState<string | null>(null);
  const [editingVocabulary, setEditingVocabulary] = useState<Vocabulary | 'new' | null>(null);
  const [deletingVocabulary, setDeletingVocabulary] = useState<Vocabulary | null>(null);
  const [deleteVocabularyError, setDeleteVocabularyError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const deleteVocabulary = useMutation(DELETE_VOCABULARY);
  const heading = useRef<HTMLHeadingElement>(null);
  // The API lists by name; the picker groups them, the workspace's first, each group still by name
  const list = [...(vocabularies.data?.data ?? [])].sort(
    (a, b) => Number(a.project_id !== null) - Number(b.project_id !== null),
  );
  const vocabulary = list.find((candidate) => candidate.vocabulary_id === chosen) ?? list[0] ?? null;
  const canChange = vocabulary !== null && canWrite && (vocabulary.project_id !== null || canWriteShared);

  const confirmDeleteVocabulary = async (): Promise<void> => {
    if (deletingVocabulary === null) return;
    setDeleteVocabularyError(null);
    try {
      await deleteVocabulary.mutateAsync({
        params: { path: { workspace_id: workspaceId, vocabulary_id: deletingVocabulary.vocabulary_id } },
      });
    } catch (error) {
      if (!isApiProblem(error, 'not_found')) {
        setDeleteVocabularyError(t('deleteVocabularyFailed', { name: deletingVocabulary.name }));
        throw error;
      }
    }
    void queryClient.invalidateQueries({ queryKey: vocabulariesQuery(workspaceId, projectId).queryKey });
    setChosen(null);
    toast({ type: 'success', title: t('vocabularyDeleted', { name: deletingVocabulary.name }) });
  };

  const vocabularyItems = (current: Vocabulary): MenuItemDef[] => [
    { id: 'rename', label: t('vocabularyMenu.edit'), onSelect: () => setEditingVocabulary(current) },
    {
      id: 'delete',
      label: t('vocabularyMenu.delete'),
      tone: 'destructive',
      onSelect: () => setDeletingVocabulary(current),
    },
  ];

  return (
    <section aria-labelledby="taxonomy-title" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="taxonomy-title" ref={heading} tabIndex={-1} className="type-section-title outline-none">
            {t('title')}
          </h2>
          <p className="mt-1 type-meta">{t('description')}</p>
        </div>
        {canWrite ? (
          <Button icon={Plus} onClick={() => setEditingVocabulary('new')}>
            {t('newVocabulary')}
          </Button>
        ) : null}
      </div>
      {canWrite ? null : <Banner tone="info" placement="region" lead={t('readOnlyLead')} message={t('readOnly')} />}
      {vocabularies.isError ? (
        <InlineError
          title={t('loadFailed')}
          reason={t('loadFailedReason')}
          errorId={null}
          onRetry={() => void vocabularies.refetch()}
          retrying={vocabularies.isFetching}
          retryLabel={common('retry')}
        />
      ) : vocabularies.isPending ? (
        <Skeleton shape="text-14" widthPct={48} />
      ) : vocabulary === null ? (
        <p className="type-body text-foreground-secondary">{t('noVocabularies')}</p>
      ) : (
        <>
          <div className="flex items-end gap-2">
            <Field width="long">
              <FieldLabel>{t('vocabulary')}</FieldLabel>
              <Select<string>
                value={vocabulary.vocabulary_id}
                onValueChange={setChosen}
                placeholder={t('vocabulary')}
                options={list.map((candidate) => ({
                  value: candidate.vocabulary_id,
                  label: candidate.name,
                  group: candidate.project_id === null ? t('groups.workspace') : t('groups.project'),
                }))}
              />
            </Field>
            {canChange ? (
              <Menu
                align="end"
                trigger={
                  <IconButton
                    icon={MoreHorizontal}
                    size="icon"
                    variant="ghost"
                    label={t('vocabularyActions', { name: vocabulary.name })}
                  />
                }
                items={vocabularyItems(vocabulary)}
              />
            ) : null}
          </div>
          <p className="type-meta">
            {t('vocabularySummary', {
              kind: t(`kinds.${vocabulary.kind}`),
              count: vocabulary.term_count,
              reach: vocabulary.project_id === null ? 'workspace' : 'project',
            })}
          </p>
          {canWrite && !canChange ? (
            <Banner tone="info" placement="region" lead={t('sharedReadOnlyLead')} message={t('sharedReadOnly')} />
          ) : null}
          <TermTree
            key={vocabulary.vocabulary_id}
            workspaceId={workspaceId}
            projectId={projectId}
            vocabulary={vocabulary}
            canWrite={canChange}
          />
        </>
      )}
      <VocabularyDialog
        workspaceId={workspaceId}
        projectId={projectId}
        canShare={canWriteShared}
        vocabulary={editingVocabulary}
        onClose={(created) => {
          setEditingVocabulary(null);
          if (created !== undefined) setChosen(created.vocabulary_id);
        }}
      />
      <ConfirmDialog
        open={deletingVocabulary !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingVocabulary(null);
        }}
        finalFocus={heading}
        title={t('deleteVocabularyTitle', { name: deletingVocabulary?.name ?? '' })}
        description={t('deleteVocabularyDescription', { count: deletingVocabulary?.term_count ?? 0 })}
        confirmLabel={t('deleteVocabularyConfirm')}
        cancelLabel={common('cancel')}
        onConfirm={confirmDeleteVocabulary}
        error={deleteVocabularyError}
      />
    </section>
  );
}

interface TermTreeProps {
  workspaceId: string;
  projectId: string;
  vocabulary: Vocabulary;
  canWrite: boolean;
}

/** One vocabulary's terms as a tree, with the toolbar that acts on the selected term. */
function TermTree({ workspaceId, projectId, vocabulary, canWrite }: TermTreeProps): ReactNode {
  const t = useTranslations('taxonomySettings');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const terms = useQuery(termsQuery(workspaceId, vocabulary.vocabulary_id));
  const deleteTerm = useMutation(DELETE_TERM);
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // A term to bring into view when the refreshed tree contains it
  const [reveal, setReveal] = useState<string | null>(null);
  const [action, setAction] = useState<TermAction | null>(null);
  const [deleting, setDeleting] = useState<{ term: TermNode; cascade: boolean } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const toolbarStart = useRef<HTMLButtonElement>(null);
  const tree = terms.data?.data ?? [];
  const all = flatten(tree);
  const term = all.find((candidate) => candidate.term_id === selected) ?? null;
  const scope = { workspaceId, projectId, vocabularyId: vocabulary.vocabulary_id };
  // Opens the branch a new or moved term sits in, once the refreshed tree shows it there
  if (reveal !== null && all.some((candidate) => candidate.term_id === reveal)) {
    const above = ancestorsOf(tree, reveal);
    setReveal(null);
    if (above.some((id) => !expanded.has(id))) setExpanded(new Set([...expanded, ...above]));
  }

  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    setDeleteError(null);
    try {
      await deleteTerm.mutateAsync({
        params: {
          path: { workspace_id: workspaceId, term_id: deleting.term.term_id },
          query: { cascade: deleting.cascade },
        },
      });
    } catch (error) {
      if (isApiProblem(error, 'has_children')) {
        // Someone added terms under it meanwhile: the question becomes the one with its terms, counted anew
        const fresh = await terms.refetch();
        const now = flatten(fresh.data?.data ?? []).find((candidate) => candidate.term_id === deleting.term.term_id);
        setDeleting({ term: now ?? deleting.term, cascade: true });
        setDeleteError(t('deleteTerm.hasChildren', { name: deleting.term.name }));
        throw error;
      }
      if (!isApiProblem(error, 'not_found')) {
        setDeleteError(t('deleteTerm.failed', { name: deleting.term.name }));
        throw error;
      }
    }
    refreshTerms(queryClient, workspaceId, projectId, vocabulary.vocabulary_id);
    setSelected(deleting.term.parent_id);
    toast({ type: 'success', title: t('deleteTerm.deleted', { name: deleting.term.name }) });
  };

  if (terms.isError) {
    return (
      <InlineError
        title={t('termsLoadFailed')}
        reason={t('loadFailedReason')}
        errorId={null}
        onRetry={() => void terms.refetch()}
        retrying={terms.isFetching}
        retryLabel={common('retry')}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {canWrite ? (
        <div role="group" aria-label={t('toolbar')} className="flex flex-wrap gap-2">
          <Button ref={toolbarStart} icon={Plus} size="sm" onClick={() => setAction({ kind: 'add', parent: null })}>
            {t('addTerm')}
          </Button>
          {vocabulary.is_hierarchical ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={term === null}
              onClick={() => setAction({ kind: 'add', parent: term })}
            >
              {term === null ? t('addChild') : t('addChildOf', { name: term.name })}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={term === null}
            onClick={() => {
              if (term !== null) setAction({ kind: 'rename', term });
            }}
          >
            {t('rename')}
          </Button>
          {vocabulary.is_hierarchical ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={term === null}
              onClick={() => {
                if (term !== null) setAction({ kind: 'move', term });
              }}
            >
              {t('moveTo')}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={term === null}
            onClick={() => {
              if (term !== null) setDeleting({ term, cascade: term.children.length > 0 });
            }}
          >
            {t('delete')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAction({ kind: 'paste' })}>
            {t('paste')}
          </Button>
        </div>
      ) : null}
      <div className="rounded-lg border border-border bg-surface p-1">
        {terms.isPending ? (
          <div className="flex flex-col gap-2 p-2" aria-busy="true">
            {Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <Skeleton key={index} shape="text-14" widthPct={index % 2 === 0 ? 48 : 64} />
            ))}
          </div>
        ) : tree.length === 0 ? (
          <p className="p-3 type-body text-foreground-secondary">{t('noTerms')}</p>
        ) : (
          <TreeView
            label={t('treeLabel', { name: vocabulary.name })}
            nodes={toTree(tree)}
            selected={selected}
            onSelect={setSelected}
            expanded={expanded}
            onExpandedChange={setExpanded}
          />
        )}
      </div>
      <TermDialog
        scope={scope}
        terms={tree}
        hierarchical={vocabulary.is_hierarchical}
        action={action}
        onClose={(focus) => {
          // A new or moved term is selected, and shown with every term above it open once the tree has it
          if (focus !== undefined) {
            setSelected(focus);
            setReveal(focus);
            announce(t('selectedAfterChange'));
          }
          setAction(null);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
            setDeleteError(null);
          }
        }}
        finalFocus={toolbarStart}
        title={t('deleteTerm.title', { name: deleting?.term.name ?? '' })}
        description={
          deleting?.cascade === true
            ? t('deleteTerm.descriptionWithChildren', { count: flatten(deleting.term.children).length })
            : t('deleteTerm.description')
        }
        confirmLabel={deleting?.cascade === true ? t('deleteTerm.confirmWithChildren') : t('deleteTerm.confirm')}
        cancelLabel={common('cancel')}
        onConfirm={confirmDelete}
        error={deleteError}
      />
    </div>
  );
}
