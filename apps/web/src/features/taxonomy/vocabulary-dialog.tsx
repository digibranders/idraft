'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode } from 'react';

import { VOCABULARY_KINDS, vocabulariesQuery, type Vocabulary, type VocabularyKind } from './taxonomy-queries';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel, Fieldset } from '@/components/ui/field';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { RadioGroup } from '@/components/ui/radio-group';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';

const CREATE = apiMutation('post', '/api/v1/workspaces/{workspace_id}/vocabularies');
const CHANGE = apiMutation('patch', '/api/v1/workspaces/{workspace_id}/vocabularies/{vocabulary_id}');
const MAX_NAME_LENGTH = 100;

type Reach = 'project' | 'workspace';

export interface VocabularyDialogProps {
  workspaceId: string;
  projectId: string;
  /** `'new'` creates one; a vocabulary renames it; `null` keeps the dialog closed. */
  vocabulary: Vocabulary | 'new' | null;
  /** Whether the member may create a workspace-wide vocabulary: not when limited to some projects. */
  canShare: boolean;
  onClose: (created?: Vocabulary) => void;
}

/**
 * Create a vocabulary (its kind, name, whether it is for this project or the whole workspace, and whether
 * terms nest and a subject may hold more than one), or rename one and change whether it is single-valued.
 */
export function VocabularyDialog({ vocabulary, ...props }: VocabularyDialogProps): ReactNode {
  if (vocabulary === null) return null;
  return (
    <VocabularyForm key={vocabulary === 'new' ? 'new' : vocabulary.vocabulary_id} vocabulary={vocabulary} {...props} />
  );
}

function VocabularyForm({
  workspaceId,
  projectId,
  vocabulary,
  canShare,
  onClose,
}: Omit<VocabularyDialogProps, 'vocabulary'> & { vocabulary: Vocabulary | 'new' }): ReactNode {
  const t = useTranslations('taxonomySettings.vocabularyDialog');
  const kinds = useTranslations('taxonomySettings.kinds');
  const common = useTranslations('common');
  const discard = useTranslations('account.discard');
  const queryClient = useQueryClient();
  const create = useMutation(CREATE);
  const change = useMutation(CHANGE);
  const nameInput = useRef<HTMLInputElement>(null);
  const initial = vocabulary === 'new' ? null : vocabulary;
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<VocabularyKind>(initial?.kind ?? 'topic');
  const [reach, setReach] = useState<Reach>('project');
  const [hierarchical, setHierarchical] = useState(initial?.is_hierarchical ?? true);
  const [singleValued, setSingleValued] = useState(initial?.is_single_valued ?? false);
  const [submitted, setSubmitted] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const busy = create.isPending || change.isPending;
  const trimmed = name.trim();
  const localError =
    trimmed === ''
      ? t('nameRequired')
      : trimmed.length > MAX_NAME_LENGTH
        ? t('nameTooLong', { max: MAX_NAME_LENGTH })
        : null;
  const shownError = nameError ?? (submitted ? localError : null);
  const dirty =
    initial === null ? trimmed !== '' : trimmed !== initial.name || singleValued !== initial.is_single_valued;

  const submit = async (): Promise<void> => {
    setSubmitted(true);
    setNameError(null);
    if (localError !== null) {
      nameInput.current?.focus();
      return;
    }
    if (busy) return;
    if (!dirty) {
      onClose();
      return;
    }
    setAlert(null);
    try {
      if (initial === null) {
        const created = await create.mutateAsync({
          params: { path: { workspace_id: workspaceId } },
          body: {
            kind,
            name: trimmed,
            project_id: reach === 'project' ? projectId : null,
            is_hierarchical: hierarchical,
            is_single_valued: singleValued,
          },
        });
        void queryClient.invalidateQueries({ queryKey: vocabulariesQuery(workspaceId, projectId).queryKey });
        toast({ type: 'success', title: t('created', { name: trimmed }) });
        onClose(created.data);
        return;
      }
      await change.mutateAsync({
        params: { path: { workspace_id: workspaceId, vocabulary_id: initial.vocabulary_id } },
        body: {
          ...(trimmed === initial.name ? {} : { name: trimmed }),
          ...(singleValued === initial.is_single_valued ? {} : { is_single_valued: singleValued }),
        },
      });
    } catch (error) {
      if (isApiProblem(error, 'duplicate')) {
        setNameError(t('nameTaken'));
        nameInput.current?.focus();
        return;
      }
      setAlert(
        isApiProblem(error, 'single_valued_violation')
          ? t('singleValuedViolation')
          : isApiProblem(error, 'forbidden')
            ? t('forbidden')
            : t('failed'),
      );
      return;
    }
    void queryClient.invalidateQueries({ queryKey: vocabulariesQuery(workspaceId, projectId).queryKey });
    toast({ type: 'success', title: t('saved', { name: trimmed }) });
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      size="md"
      dirty={dirty}
      discard={{
        title: discard('title'),
        description: t('discardDescription'),
        keepEditingLabel: discard('keepEditing'),
        discardLabel: discard('discard'),
      }}
    >
      <form
        noValidate
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <DialogHeader
          title={initial === null ? t('createTitle') : t('editTitle', { name: initial.name })}
          description={initial === null ? t('createDescription') : undefined}
          closeLabel={common('close')}
        />
        <DialogBody>
          {alert === null ? null : <FormAlert message={alert} />}
          {initial === null ? (
            <Field width="medium">
              <FieldLabel>{t('kind')}</FieldLabel>
              <Select<VocabularyKind>
                value={kind}
                onValueChange={setKind}
                placeholder={t('kind')}
                options={VOCABULARY_KINDS.map((value) => ({ value, label: kinds(value) }))}
              />
            </Field>
          ) : null}
          <Field invalid={shownError !== null}>
            <FieldLabel>{t('name')}</FieldLabel>
            <Input
              ref={nameInput}
              aria-required
              autoComplete="off"
              value={name}
              onValueChange={(value) => {
                setName(value);
                setNameError(null);
              }}
            />
            {shownError === null ? null : <FieldError message={shownError} />}
          </Field>
          {initial === null ? (
            <RadioGroup<Reach>
              legend={t('reach')}
              value={reach}
              onValueChange={setReach}
              options={[
                { value: 'project', label: t('reachProject'), description: t('reachProjectHint') },
                {
                  value: 'workspace',
                  label: t('reachWorkspace'),
                  description: canShare ? t('reachWorkspaceHint') : t('reachWorkspaceLimited'),
                  disabled: !canShare,
                },
              ]}
            />
          ) : null}
          <Fieldset legend={t('rules')}>
            {initial === null ? (
              <Checkbox
                checked={hierarchical}
                onCheckedChange={setHierarchical}
                label={t('hierarchical')}
                description={t('hierarchicalHint')}
              />
            ) : null}
            <Checkbox
              checked={singleValued}
              onCheckedChange={setSingleValued}
              label={t('singleValued')}
              description={t('singleValuedHint')}
            />
          </Fieldset>
        </DialogBody>
        <DialogFooter
          secondary={
            <DialogClose>
              <Button type="button" variant="secondary" disabled={busy}>
                {common('cancel')}
              </Button>
            </DialogClose>
          }
          primary={
            <Button type="submit" variant="primary" loading={busy}>
              {initial === null ? t('create') : common('save')}
            </Button>
          }
        />
      </form>
    </Dialog>
  );
}
