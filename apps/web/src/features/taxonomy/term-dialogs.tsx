'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode } from 'react';

import { flatten, namedPaths, refreshTerms, subtreeIds, type TermNode } from './taxonomy-queries';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import { textLength } from '@/lib/text/length';

const ADD = apiMutation('post', '/api/v1/workspaces/{workspace_id}/vocabularies/{vocabulary_id}/terms');
const CHANGE = apiMutation('patch', '/api/v1/workspaces/{workspace_id}/terms/{term_id}');
const MAX_NAME_LENGTH = 200;
/** One request takes at most this many terms (19 section 3.5). */
const MAX_BATCH = 500;
/** The Select value that stands for the top level, which has no term id. */
const ROOT = '';
/** A term is at most this many levels from its root (19 section 3.5). */
const MAX_DEPTH = 10;
/** The longest path a pasted line may be, in characters (19 section 3.5, `TermInput.path`). */
const MAX_PATH_LENGTH = 2048;

type Translate = ReturnType<typeof useTranslations<'taxonomySettings.termDialog'>>;

/**
 * What to say for a refusal any term write can meet, or `null`: a place too deep, a parent deleted
 * meanwhile, or a workspace vocabulary a member limited to some projects may not change.
 */
function refusalOf(error: unknown, t: Translate): string | null {
  if (isApiProblem(error, 'forbidden')) return t('forbidden');
  if (!isApiProblem(error, 'validation_failed')) return null;
  const codes = new Set(error.errors.map((item) => item.code));
  if (codes.has('too_deep')) return t('tooDeep', { max: MAX_DEPTH });
  if (codes.has('parent_unknown')) return t('parentGone');
  return null;
}

export interface TermScope {
  workspaceId: string;
  projectId: string;
  vocabularyId: string;
}

/** What the term dialog does: add a term (under a parent, or at the top), or rename one. */
export type TermAction =
  | { kind: 'add'; parent: TermNode | null }
  | { kind: 'rename'; term: TermNode }
  | { kind: 'move'; term: TermNode }
  | { kind: 'paste' };

export interface TermDialogProps {
  scope: TermScope;
  /** Every term of the vocabulary, as a tree. */
  terms: readonly TermNode[];
  hierarchical: boolean;
  action: TermAction | null;
  onClose: (focus?: string) => void;
}

/** The dialog for one action on the terms of a vocabulary. */
export function TermDialog({ action, ...props }: TermDialogProps): ReactNode {
  if (action === null) return null;
  switch (action.kind) {
    case 'add':
      return <NameForm {...props} parent={action.parent} term={null} />;
    case 'rename':
      return <NameForm {...props} parent={null} term={action.term} />;
    case 'move':
      return <MoveForm {...props} term={action.term} />;
    case 'paste':
      return <PasteForm {...props} />;
  }
}

function Footer({ busy, submitLabel }: { busy: boolean; submitLabel: string }): ReactNode {
  const common = useTranslations('common');
  return (
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
          {submitLabel}
        </Button>
      }
    />
  );
}

/** Add a term, or rename one. */
function NameForm({
  scope,
  parent,
  term,
  onClose,
}: Omit<TermDialogProps, 'action' | 'terms' | 'hierarchical'> & {
  parent: TermNode | null;
  term: TermNode | null;
}): ReactNode {
  const t = useTranslations('taxonomySettings.termDialog');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const add = useMutation(ADD);
  const change = useMutation(CHANGE);
  const nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(term?.name ?? '');
  const [submitted, setSubmitted] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const busy = add.isPending || change.isPending;
  const trimmed = name.trim();
  const localError =
    trimmed === ''
      ? t('nameRequired')
      : trimmed.length > MAX_NAME_LENGTH
        ? t('nameTooLong', { max: MAX_NAME_LENGTH })
        : null;
  const shownError = nameError ?? (submitted ? localError : null);

  const submit = async (): Promise<void> => {
    setSubmitted(true);
    setNameError(null);
    if (localError !== null) {
      nameInput.current?.focus();
      return;
    }
    if (busy) return;
    if (term !== null && trimmed === term.name) {
      onClose();
      return;
    }
    setAlert(null);
    let id: string;
    try {
      if (term === null) {
        const added = await add.mutateAsync({
          params: { path: { workspace_id: scope.workspaceId, vocabulary_id: scope.vocabularyId } },
          body: { name: trimmed, parent_id: parent?.term_id ?? null },
        });
        id = added.data[0]?.term_id ?? '';
      } else {
        await change.mutateAsync({
          params: { path: { workspace_id: scope.workspaceId, term_id: term.term_id } },
          body: { name: trimmed },
        });
        id = term.term_id;
      }
    } catch (error) {
      if (isApiProblem(error, 'duplicate')) {
        setNameError(t('nameTaken'));
        nameInput.current?.focus();
        return;
      }
      setAlert(refusalOf(error, t) ?? (isApiProblem(error, 'not_found') ? t('gone') : t('failed')));
      return;
    }
    refreshTerms(queryClient, scope.workspaceId, scope.projectId, scope.vocabularyId);
    toast({ type: 'success', title: t(term === null ? 'added' : 'renamed', { name: trimmed }) });
    onClose(id);
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      size="sm"
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
          title={
            term !== null
              ? t('renameTitle', { name: term.name })
              : parent === null
                ? t('addTitle')
                : t('addUnderTitle', { parent: parent.name })
          }
          closeLabel={common('close')}
        />
        <DialogBody>
          {alert === null ? null : <FormAlert message={alert} />}
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
        </DialogBody>
        <Footer busy={busy} submitLabel={term === null ? t('add') : common('save')} />
      </form>
    </Dialog>
  );
}

/** "Move to": a new parent for a term, from the terms outside its own subtree, or the top level. */
function MoveForm({
  scope,
  terms,
  term,
  onClose,
}: Omit<TermDialogProps, 'action' | 'hierarchical'> & { term: TermNode }): ReactNode {
  const t = useTranslations('taxonomySettings.termDialog');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const change = useMutation(CHANGE);
  const [parent, setParent] = useState<string>(term.parent_id ?? ROOT);
  const [alert, setAlert] = useState<string | null>(null);
  const blocked = subtreeIds(term);
  const names = namedPaths(terms);
  const options = [
    { value: ROOT, label: t('topLevel') },
    ...flatten(terms)
      .filter((candidate) => !blocked.has(candidate.term_id))
      .map((candidate) => ({ value: candidate.term_id, label: names.get(candidate.term_id) ?? candidate.name })),
  ];

  const submit = async (): Promise<void> => {
    if (change.isPending) return;
    if (parent === (term.parent_id ?? ROOT)) {
      onClose();
      return;
    }
    setAlert(null);
    try {
      await change.mutateAsync({
        params: { path: { workspace_id: scope.workspaceId, term_id: term.term_id } },
        body: { parent_id: parent === ROOT ? null : parent },
      });
    } catch (error) {
      setAlert(
        isApiProblem(error, 'cycle_detected')
          ? t('cycle', { name: term.name })
          : isApiProblem(error, 'duplicate')
            ? t('moveDuplicate', { name: term.name })
            : (refusalOf(error, t) ?? t('failed')),
      );
      return;
    }
    refreshTerms(queryClient, scope.workspaceId, scope.projectId, scope.vocabularyId);
    toast({ type: 'success', title: t('moved', { name: term.name }) });
    onClose(term.term_id);
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !change.isPending) onClose();
      }}
      size="sm"
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
          title={t('moveTitle', { name: term.name })}
          description={t('moveDescription')}
          closeLabel={common('close')}
        />
        <DialogBody>
          {alert === null ? null : <FormAlert message={alert} />}
          <Field>
            <FieldLabel>{t('newParent')}</FieldLabel>
            <Select<string> value={parent} onValueChange={setParent} placeholder={t('newParent')} options={options} />
          </Field>
        </DialogBody>
        <Footer busy={change.isPending} submitLabel={t('move')} />
      </form>
    </Dialog>
  );
}

/** "Paste a list": one term per line; a path such as "CRM/CRM for startups" creates missing parents. */
function PasteForm({ scope, hierarchical, onClose }: Omit<TermDialogProps, 'action' | 'terms'>): ReactNode {
  const t = useTranslations('taxonomySettings.termDialog');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const add = useMutation(ADD);
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const lines = [
    ...new Set(
      text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== ''),
    ),
  ];
  const localError =
    lines.length === 0
      ? t('pasteRequired')
      : lines.length > MAX_BATCH
        ? t('pasteTooMany', { max: MAX_BATCH })
        : hierarchical && lines.some((line) => line.split('/').length > MAX_DEPTH)
          ? t('pasteTooDeep', { max: MAX_DEPTH })
          : lines.some((line) =>
                hierarchical
                  ? textLength(line) > MAX_PATH_LENGTH ||
                    line.split('/').some((name) => textLength(name.trim()) > MAX_NAME_LENGTH)
                  : textLength(line) > MAX_NAME_LENGTH,
              )
            ? t('pasteTooLong', { max: MAX_NAME_LENGTH })
            : null;

  const submit = async (): Promise<void> => {
    setSubmitted(true);
    if (localError !== null || add.isPending) return;
    setAlert(null);
    try {
      const added = await add.mutateAsync({
        params: { path: { workspace_id: scope.workspaceId, vocabulary_id: scope.vocabularyId } },
        body: { items: lines.map((line) => (hierarchical ? { path: line } : { name: line })) },
      });
      refreshTerms(queryClient, scope.workspaceId, scope.projectId, scope.vocabularyId);
      // A path that exists adds nothing, so a paste of known terms adds none
      toast({
        type: 'success',
        title: added.data.length === 0 ? t('pastedNone') : t('pasted', { count: added.data.length }),
      });
      onClose();
    } catch (error) {
      setAlert(
        isApiProblem(error, 'duplicate')
          ? t('pasteDuplicate')
          : isApiProblem(error, 'payload_too_large')
            ? t('pasteTooLarge')
            : (refusalOf(error, t) ?? t('failed')),
      );
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !add.isPending) onClose();
      }}
      size="md"
    >
      <form
        noValidate
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <DialogHeader title={t('pasteTitle')} closeLabel={common('close')} />
        <DialogBody>
          {alert === null ? null : <FormAlert message={alert} />}
          <Field invalid={submitted && localError !== null}>
            <FieldLabel>{t('pasteLabel')}</FieldLabel>
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={hierarchical ? t('pastePlaceholderPaths') : t('pastePlaceholder')}
              counter={lines.length > 0 ? t('pasteCount', { count: lines.length }) : null}
              counterOver={lines.length > MAX_BATCH}
              submitOnModEnter
            />
            {submitted && localError !== null ? (
              <FieldError message={localError} />
            ) : (
              <FieldDescription>{hierarchical ? t('pasteHintPaths') : t('pasteHint')}</FieldDescription>
            )}
          </Field>
        </DialogBody>
        <Footer busy={add.isPending} submitLabel={t('pasteSubmit')} />
      </form>
    </Dialog>
  );
}
