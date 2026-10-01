'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode } from 'react';

import { refreshEntities, wordAlias, type Alias, type AliasInput, type ProjectScope } from './entity-queries';
import { MODE_KEY } from './labels';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel, Fieldset } from '@/components/ui/field';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';

const ADD = apiMutation('post', '/api/v1/workspaces/{workspace_id}/entities/{entity_id}/aliases');
const CHANGE = apiMutation('patch', '/api/v1/workspaces/{workspace_id}/entities/{entity_id}/aliases/{alias_id}');

export type MatchMode = AliasInput['match_mode'];
export const MATCH_MODES: readonly MatchMode[] = ['word_boundary', 'exact_case', 'substring', 'regex'];
const MAX_ALIAS_LENGTH = 200;

export interface AliasDialogProps {
  scope: ProjectScope;
  entityId: string;
  entityName: string;
  /** `'new'` adds an alias; an alias edits it; `null` keeps the dialog closed. */
  alias: Alias | 'new' | null;
  onClose: () => void;
}

/**
 * Add or change one alias (20 section 5.19.6): the text, how it is matched, and three switches that narrow
 * it. A regular expression is checked by the API (RE2), and its message is shown on the field.
 */
export function AliasDialog({ alias, ...props }: AliasDialogProps): ReactNode {
  if (alias === null) return null;
  return <AliasForm key={alias === 'new' ? 'new' : alias.alias_id} alias={alias} {...props} />;
}

function AliasForm({
  scope,
  entityId,
  entityName,
  alias,
  onClose,
}: Omit<AliasDialogProps, 'alias'> & { alias: Alias | 'new' }): ReactNode {
  const t = useTranslations('entitySettings.aliases');
  const common = useTranslations('common');
  const discard = useTranslations('account.discard');
  const queryClient = useQueryClient();
  const add = useMutation(ADD);
  const change = useMutation(CHANGE);
  const textInput = useRef<HTMLInputElement>(null);
  const initial = alias === 'new' ? null : alias;
  const [text, setText] = useState(initial?.alias ?? '');
  const [mode, setMode] = useState<MatchMode>(initial?.match_mode ?? 'word_boundary');
  const [caseSensitive, setCaseSensitive] = useState(initial?.case_sensitive ?? false);
  const [negative, setNegative] = useState(initial?.is_negative ?? false);
  const [needsContext, setNeedsContext] = useState(initial?.requires_context ?? false);
  const [submitted, setSubmitted] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const busy = add.isPending || change.isPending;
  // A word alias loses surrounding spaces, as the API trims it; spaces in a pattern are part of it
  const trimmed = mode === 'regex' ? text : text.trim();
  const blank = text.trim() === '';
  const localError = blank
    ? t('textRequired')
    : trimmed.length > MAX_ALIAS_LENGTH
      ? t('textTooLong', { max: MAX_ALIAS_LENGTH })
      : null;
  const shownError = textError ?? (submitted ? localError : null);
  const values: AliasInput = {
    alias: trimmed,
    match_mode: mode,
    case_sensitive: caseSensitive,
    language_code: initial?.language_code ?? null,
    is_negative: negative,
    requires_context: needsContext,
  };
  const dirty =
    initial === null
      ? !blank
      : trimmed !== initial.alias ||
        mode !== initial.match_mode ||
        caseSensitive !== initial.case_sensitive ||
        negative !== initial.is_negative ||
        needsContext !== initial.requires_context;

  const submit = async (): Promise<void> => {
    setSubmitted(true);
    setTextError(null);
    if (localError !== null) {
      textInput.current?.focus();
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
        await add.mutateAsync({
          params: { path: { workspace_id: scope.workspaceId, entity_id: entityId } },
          body: values,
        });
      } else {
        await change.mutateAsync({
          params: { path: { workspace_id: scope.workspaceId, entity_id: entityId, alias_id: initial.alias_id } },
          body: values,
        });
      }
    } catch (error) {
      if (isApiProblem(error, 'duplicate')) {
        setTextError(t('duplicate', { name: entityName }));
        textInput.current?.focus();
        return;
      }
      if (isApiProblem(error, 'validation_failed')) {
        const regex = error.errors.find((item) => item.code === 'invalid_regex');
        if (regex !== undefined) {
          setTextError(t('invalidRegex'));
          textInput.current?.focus();
          return;
        }
      }
      setAlert(isApiProblem(error, 'not_found') ? t('gone') : t('saveFailed'));
      return;
    }
    refreshEntities(queryClient, scope);
    toast({ type: 'success', title: t(initial === null ? 'added' : 'changed', { alias: trimmed }) });
    onClose();
  };

  const modeOptions = MATCH_MODES.map((value) => ({
    value,
    label: t(`modes.${MODE_KEY[value]}`),
    description: t(`modeHints.${MODE_KEY[value]}`),
  }));

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
          title={initial === null ? t('addTitle', { name: entityName }) : t('editTitle')}
          closeLabel={common('close')}
        />
        <DialogBody>
          {alert === null ? null : <FormAlert message={alert} />}
          <Field invalid={shownError !== null}>
            <FieldLabel>{t('text')}</FieldLabel>
            <Input
              ref={textInput}
              aria-required
              autoComplete="off"
              spellCheck={false}
              className={mode === 'regex' ? 'type-mono' : undefined}
              value={text}
              onValueChange={(value) => {
                setText(value);
                setTextError(null);
              }}
            />
            {shownError === null ? (
              <FieldDescription>{mode === 'regex' ? t('regexHint') : t('textHint')}</FieldDescription>
            ) : (
              <FieldError message={shownError} />
            )}
          </Field>
          <Field width="medium">
            <FieldLabel>{t('mode')}</FieldLabel>
            <Select<MatchMode> value={mode} onValueChange={setMode} placeholder={t('mode')} options={modeOptions} />
          </Field>
          <Fieldset legend={t('options')}>
            <Checkbox
              checked={caseSensitive}
              onCheckedChange={setCaseSensitive}
              label={t('caseSensitive')}
              description={t('caseSensitiveHint')}
            />
            <Checkbox
              checked={negative}
              onCheckedChange={setNegative}
              label={t('negative')}
              description={t('negativeHint', { name: entityName })}
            />
            <Checkbox
              checked={needsContext}
              onCheckedChange={setNeedsContext}
              label={t('context')}
              description={t('contextHint')}
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
              {initial === null ? t('add') : common('save')}
            </Button>
          }
        />
      </form>
    </Dialog>
  );
}

/** The API takes up to 200 aliases in one request (19 section 3.4). */
const MAX_ALIAS_BATCH = 200;

export interface PasteAliasesDialogProps {
  scope: ProjectScope;
  entityId: string;
  entityName: string;
  /** The entity's aliases now: a pasted line that repeats one is left out rather than refused. */
  existing: readonly string[];
  open: boolean;
  onClose: () => void;
}

/** "Paste several": one alias per line, each matched on whole words in any case, added in one request. */
export function PasteAliasesDialog({ open, ...props }: PasteAliasesDialogProps): ReactNode {
  return open ? <PasteAliasesForm {...props} /> : null;
}

function PasteAliasesForm({
  scope,
  entityId,
  entityName,
  existing,
  onClose,
}: Omit<PasteAliasesDialogProps, 'open'>): ReactNode {
  const t = useTranslations('entitySettings.aliases');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const add = useMutation(ADD);
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  // Each name once whatever its case, and none the entity already has (the API refuses those)
  const known = new Set(existing.map((alias) => alias.toLocaleLowerCase()));
  const typed = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const lines = typed.filter((line) => {
    const key = line.toLocaleLowerCase();
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });
  const left = typed.length - lines.length;
  const localError =
    lines.length === 0
      ? typed.length > 0
        ? t('pasteAllKnown')
        : t('pasteRequired')
      : lines.length > MAX_ALIAS_BATCH
        ? t('pasteTooMany', { max: MAX_ALIAS_BATCH })
        : lines.some((line) => line.length > MAX_ALIAS_LENGTH)
          ? t('textTooLong', { max: MAX_ALIAS_LENGTH })
          : null;

  const submit = async (): Promise<void> => {
    setSubmitted(true);
    if (localError !== null || add.isPending) return;
    setAlert(null);
    try {
      await add.mutateAsync({
        params: { path: { workspace_id: scope.workspaceId, entity_id: entityId } },
        body: { items: lines.map(wordAlias) },
      });
    } catch (error) {
      setAlert(isApiProblem(error, 'duplicate') ? t('pasteDuplicate', { name: entityName }) : t('saveFailed'));
      return;
    }
    refreshEntities(queryClient, scope);
    toast({
      type: 'success',
      title: t('pasted', { count: lines.length }),
      ...(left > 0 ? { description: t('pasteLeftOut', { count: left }) } : {}),
    });
    onClose();
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
        <DialogHeader title={t('pasteTitle', { name: entityName })} closeLabel={common('close')} />
        <DialogBody>
          {alert === null ? null : <FormAlert message={alert} />}
          <Field invalid={submitted && localError !== null}>
            <FieldLabel>{t('pasteLabel')}</FieldLabel>
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t('pastePlaceholder')}
              counter={lines.length > 0 ? t('pasteCount', { count: lines.length }) : null}
              counterOver={lines.length > MAX_ALIAS_BATCH}
              submitOnModEnter
            />
            {submitted && localError !== null ? (
              <FieldError message={localError} />
            ) : (
              <FieldDescription>{t('pasteHint')}</FieldDescription>
            )}
          </Field>
        </DialogBody>
        <DialogFooter
          secondary={
            <DialogClose>
              <Button type="button" variant="secondary" disabled={add.isPending}>
                {common('cancel')}
              </Button>
            </DialogClose>
          }
          primary={
            <Button type="submit" variant="primary" loading={add.isPending}>
              {t('pasteSubmit')}
            </Button>
          }
        />
      </form>
    </Dialog>
  );
}
