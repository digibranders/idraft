'use client';

import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactElement } from 'react';
import { z } from 'zod';

import { ConfirmStep } from './confirm-step';
import {
  NO_COUNTS,
  importDefaults,
  isMappingCurrent,
  mappedTwiceRows,
  readingProgress,
  sameSubmission,
  startingMapping,
  submissionOf,
  uploadErrorsOf,
} from './import-flow';
import {
  CANCEL_IMPORT,
  CHANGE_IMPORT,
  CONFIRM_IMPORT,
  CREATE_IMPORT,
  DIALOG_POLL_MS,
  conflictRowActions,
  importKey,
  importQueryOptions,
  readRows,
  rowsKey,
  settledImport,
  uploadPath,
  useImport,
} from './import-queries';
import {
  OUTCOMES,
  confirmPlan,
  importPhase,
  mappingProblems,
  outcomeSummary,
  stepsOf,
  type KeywordImport,
  type Outcome,
  type StepId,
} from './import-model';
import {
  importReducer,
  initialState,
  initialValues,
  type Ended,
  type ImportState,
  type Submitted,
  type UploadValues,
} from './import-state';
import { MappingStep } from './mapping-step';
import { ReviewStep, type RowsState } from './review-step';
import { UploadStep } from './upload-step';
import type { ProjectDefaults } from '../add-keywords/add-keywords-dialog';
import type { ProjectScope } from '../rankings-queries';
import { useVocabularyList } from '../taxonomy-queries';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { StepperDialog } from '@/components/ui/stepper-dialog';
import { isApiProblem } from '@/lib/api/problem';
import { uploadForm } from '@/lib/api/upload';
import { formatInteger } from '@/lib/format';

/** The rows each outcome lists in Review; the report holds all of them. */
const ROWS_SHOWN = 20;
/** The most row actions one request carries. */
const ROW_ACTIONS_PER_REQUEST = 1000;
const UPLOAD_ANSWER = z.object({ data: z.object({ import_id: z.string() }) });

type Verdict = 'ok' | 'invalid';

export interface ImportDialogProps {
  scope: ProjectScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Confirm started the write: Rankings follows it in its header. */
  onConfirmed: (importId: string) => void;
  /** The project's location and language, which the file's rows start with. */
  defaults: ProjectDefaults;
}

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

/**
 * Import keywords (16-drawers-dialogs-popovers.md section 4.6, 10-forms.md section 15): a `StepperDialog`
 * with Upload, Map columns (files only), Review and Confirm. The steps draw what the state holds; this
 * component sends the requests and moves between the steps. Nothing is written until the last step, and
 * closing before that stops the import. Back keeps every earlier choice.
 */
export function ImportDialog({ scope, open, onOpenChange, onConfirmed, defaults }: ImportDialogProps): ReactElement {
  const t = useTranslations('rankings.import');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const path = { workspace_id: scope.workspaceId, project_id: scope.projectId };

  const start = useMemo(
    () => initialValues(defaults.location, defaults.languageCode ?? 'en'),
    [defaults.location, defaults.languageCode],
  );
  const startValues = useRef(start);
  const [state, dispatch] = useReducer(importReducer, start, initialState);
  // What the handlers below see: the state as it is when they run, not when they were made
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
    startValues.current = start;
  });
  // Work the dialog started ends with it: a closed dialog moves nothing and fires nothing
  const session = useRef({ controller: new AbortController() });
  // A confirm on its way started the write; closing then must not cancel it
  const confirming = useRef(false);

  const vocabularies = useVocabularyList(scope, open);
  const current = useImport(scope, state.importId, DIALOG_POLL_MS);
  const imported = current.data;
  const phase = imported === undefined ? null : importPhase(imported.status);
  const counts = imported?.counts ?? NO_COUNTS;
  const summary = outcomeSummary(counts, imported?.quota ?? null);
  const plan = confirmPlan(counts, state.choices);

  const rowQueries = useQueries({
    queries: OUTCOMES.map((outcome) => ({
      queryKey: [...rowsKey(scope, state.importId ?? 'none'), outcome],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        readRows(scope, state.importId ?? '', outcome, ROWS_SHOWN, signal),
      enabled: state.step === 'review' && state.importId !== null && phase === 'ready' && counts[outcome] > 0,
      // The rows of a preview do not change until the mapping does, which drops them
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });
  const rows: Partial<Record<Outcome, RowsState>> = {};
  OUTCOMES.forEach((outcome, index) => {
    const query = rowQueries[index];
    if (query === undefined) return;
    rows[outcome] =
      query.data !== undefined
        ? { status: 'ready', rows: query.data, total: counts[outcome] }
        : query.isError
          ? { status: 'error' }
          : { status: 'loading' };
  });

  const createImport = useMutation(CREATE_IMPORT);
  const changeImport = useMutation(CHANGE_IMPORT);
  const confirmImport = useMutation(CONFIRM_IMPORT);
  const { mutate: cancelImport } = useMutation(CANCEL_IMPORT);

  /** The words for what the API refused or did not answer; `null` for a wait that was cut short on purpose. */
  const problemText = (error: unknown): string | null => {
    if (isAbort(error)) return null;
    if (isApiProblem(error, 'payload_too_large')) return t('uploadTooLarge');
    if (isApiProblem(error, 'unsupported_media_type')) return t('uploadType');
    if (isApiProblem(error, 'storage_unavailable')) return t('storageUnavailable');
    if (isApiProblem(error, 'forbidden')) return t('forbidden');
    if (isApiProblem(error, 'quota_exceeded')) {
      return t('quotaExceeded', {
        used: formatInteger(error.number('used') ?? 0),
        limit: formatInteger(error.number('limit') ?? 0),
        requested: formatInteger(error.number('requested') ?? 0),
      });
    }
    return t('requestFailed');
  };
  const fail = (error: unknown): Verdict => {
    const message = problemText(error);
    if (message !== null) dispatch({ type: 'alert', message });
    return 'invalid';
  };
  const end = (reason: Ended): Verdict => {
    dispatch({ type: 'ended', reason });
    return 'invalid';
  };

  /** Stops an import that has not started writing. The answer does not matter: previews expire by themselves. */
  const stopImport = useCallback(
    (importId: string): void => {
      const known = queryClient.getQueryData<KeywordImport>(importKey(scope, importId));
      const status = known === undefined ? null : importPhase(known.status);
      if (status !== null && status !== 'reading' && status !== 'needs_mapping' && status !== 'ready') return;
      cancelImport({
        params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId, import_id: importId } },
      });
    },
    [queryClient, scope, cancelImport],
  );

  /** Back to an empty first step, and the end of every request and wait the dialog had going. */
  const abandon = useCallback((): void => {
    const held = latest.current;
    session.current.controller.abort();
    session.current.controller = new AbortController();
    if (held.importId !== null && !confirming.current) stopImport(held.importId);
    latest.current = initialState(startValues.current);
    dispatch({ type: 'reset', values: startValues.current });
  }, [stopImport]);

  // A dialog the route closes (the Back button of the browser) is abandoned as one the person closed
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) abandon();
    wasOpen.current = open;
  }, [open, abandon]);

  const settle = (importId: string): Promise<KeywordImport> =>
    settledImport(queryClient, importKey(scope, importId), session.current.controller.signal);

  /** What the dialog does with an import that finished reading: on to the next step, or why not. */
  const arrive = (read: KeywordImport, held: ImportState, fresh: boolean): Verdict => {
    const from = held.step;
    const values = held.values;
    const next = importPhase(read.status);
    if (next === 'failed') return end('failed');
    if (next === 'expired') return end('expired');
    if (next === 'gone') return end('gone');
    if (next !== 'ready' && next !== 'needs_mapping') return fail(new Error(`Unexpected import status ${read.status}`));
    if (values.source === 'paste') {
      if (next === 'needs_mapping') {
        if (read.error_code === 'tags_vocabulary_missing') {
          dispatch({ type: 'upload-errors', errors: { file: null, paste: null, tagsVocabulary: true } });
          return 'invalid';
        }
        return fail(new Error(`Unexpected mapping problem ${read.error_code ?? 'none'}`));
      }
      dispatch({ type: 'passed', step: from });
      return 'ok';
    }
    const mapping = fresh ? startingMapping(read, values.head?.headers ?? []) : held.mapping;
    if (fresh) dispatch({ type: 'mapping-set', mapping });
    if (next === 'needs_mapping') {
      // The API names what is missing; the same check, made here, puts it on the row that needs it
      const found = mappingProblems(mapping, {
        tagsVocabulary: values.tagsVocabulary,
        topicVocabulary: values.topicVocabulary,
      });
      if (found.form === null && Object.keys(found.rows).length === 0) {
        return fail(new Error(`Unexpected mapping problem ${read.error_code ?? 'none'}`));
      }
      dispatch({ type: 'map-problems', problems: { checked: true, server: {} } });
      // From Upload the person goes to Map to fix it; from Map they stay there
      if (from === 'map') return 'invalid';
    }
    dispatch({ type: 'passed', step: from });
    return 'ok';
  };

  /** Sends the file or the paste and answers the new import's id. */
  const createFrom = async (values: UploadValues, signal: AbortSignal): Promise<string> => {
    const body = importDefaults(values);
    if (values.source === 'paste') {
      const answer = await createImport.mutateAsync({
        params: { path },
        body: { source: 'paste', paste: values.paste, defaults: body },
      });
      return answer.data.import_id;
    }
    if (values.file === null) throw new Error('The upload has no file');
    const form = new FormData();
    form.set('file', values.file);
    form.set('options', JSON.stringify({ defaults: body }));
    const answer = UPLOAD_ANSWER.parse(
      await uploadForm(uploadPath(scope), form, {
        signal,
        onProgress: ({ loaded, total }) =>
          dispatch({
            type: 'progress',
            percent: total === null || total === 0 ? null : Math.min(100, Math.round((loaded / total) * 100)),
          }),
      }),
    );
    return answer.data.import_id;
  };

  const continueUpload = async (): Promise<Verdict> => {
    const held = latest.current;
    const missing = uploadErrorsOf(held.values);
    if (missing !== null) {
      dispatch({ type: 'upload-errors', errors: missing });
      return 'invalid';
    }
    if (held.ended !== null) return 'invalid';
    const { signal } = session.current.controller;
    const submitted: Submitted = submissionOf(held.values);
    dispatch({ type: 'working', on: true });
    try {
      let importId = held.importId;
      const fresh = importId === null || !sameSubmission(held.submitted, submitted);
      if (fresh) {
        // Another file or other defaults than the import was made from: it is replaced
        if (importId !== null) stopImport(importId);
        importId = await createFrom(held.values, signal);
        dispatch({ type: 'progress', percent: null });
        await queryClient.fetchQuery(importQueryOptions(scope, importId));
        if (signal.aborted) return 'invalid';
        dispatch({ type: 'imported', importId, submitted });
      }
      if (importId === null) return 'invalid';
      const read = await settle(importId);
      return arrive(read, { ...held, importId }, fresh);
    } catch (error) {
      // A dialog closed meanwhile has nothing to show an error on
      return signal.aborted ? 'invalid' : fail(error);
    } finally {
      if (!signal.aborted) dispatch({ type: 'working', on: false });
      if (!signal.aborted) dispatch({ type: 'progress', percent: null });
    }
  };

  const continueMap = async (): Promise<Verdict> => {
    const held = latest.current;
    if (held.ended !== null || held.importId === null) return 'invalid';
    const importId = held.importId;
    const chosen = { tagsVocabulary: held.values.tagsVocabulary, topicVocabulary: held.values.topicVocabulary };
    const found = mappingProblems(held.mapping, chosen);
    dispatch({ type: 'map-problems', problems: { checked: true, server: {} } });
    if (found.form !== null || Object.keys(found.rows).length > 0) return 'invalid';
    const known = queryClient.getQueryData<KeywordImport>(importKey(scope, importId));
    if (known !== undefined && importPhase(known.status) === 'ready' && isMappingCurrent(known, held.mapping, chosen)) {
      dispatch({ type: 'passed', step: 'map' });
      return 'ok';
    }
    const { signal } = session.current.controller;
    dispatch({ type: 'working', on: true });
    try {
      // The rows listed were of the old reading
      queryClient.removeQueries({ queryKey: rowsKey(scope, importId) });
      const answer = await changeImport.mutateAsync({
        params: { path: { ...path, import_id: importId } },
        body: { column_mapping: held.mapping, defaults: importDefaults(held.values) },
      });
      if (signal.aborted) return 'invalid';
      queryClient.setQueryData(importKey(scope, importId), answer.data);
      return arrive(await settle(importId), held, false);
    } catch (error) {
      if (signal.aborted) return 'invalid';
      if (isApiProblem(error, 'validation_failed')) {
        const twice = mappedTwiceRows(error.errors, held.mapping);
        if (Object.keys(twice).length > 0) {
          dispatch({ type: 'map-problems', problems: { checked: true, server: twice } });
          return 'invalid';
        }
      }
      return fail(error);
    } finally {
      if (!signal.aborted) dispatch({ type: 'working', on: false });
    }
  };

  const continueConfirm = async (): Promise<Verdict> => {
    const held = latest.current;
    if (held.ended !== null || held.importId === null) return 'invalid';
    const importId = held.importId;
    const known = queryClient.getQueryData<KeywordImport>(importKey(scope, importId));
    if (known === undefined) return 'invalid';
    // The button is disabled over the limit, and the step says why; this is for a read that came in since
    if (outcomeSummary(known.counts, known.quota).overQuota > 0) return 'invalid';
    const chosen = confirmPlan(known.counts, held.choices);
    const { signal } = session.current.controller;
    dispatch({ type: 'working', on: true });
    try {
      if (chosen.unarchive > 0) {
        // Every archived row of the file, page by page, goes back to the keyword's own place
        const actions = await conflictRowActions(scope, importId);
        for (let at = 0; at < actions.length; at += ROW_ACTIONS_PER_REQUEST) {
          if (signal.aborted) return 'invalid';
          await changeImport.mutateAsync({
            params: { path: { ...path, import_id: importId } },
            body: { row_actions: actions.slice(at, at + ROW_ACTIONS_PER_REQUEST) },
          });
        }
      }
      if (signal.aborted) return 'invalid';
      confirming.current = true;
      const started = await confirmImport.mutateAsync({
        params: { path: { ...path, import_id: importId } },
        body: { duplicate_action: chosen.duplicateAction },
      });
      // The answer is the import writing: what the header reads first, instead of the preview it still holds
      queryClient.setQueryData(importKey(scope, importId), started.data);
      // The write has started: the header follows it, and closing the dialog now stops nothing
      onConfirmed(importId);
      abandon();
      onOpenChange(false);
      return 'ok';
    } catch (error) {
      if (signal.aborted) return 'invalid';
      if (isApiProblem(error, 'invalid_state_transition')) {
        const over = await endedState(importId);
        if (over !== null) return end(over);
      }
      return fail(error);
    } finally {
      confirming.current = false;
      if (!signal.aborted) dispatch({ type: 'working', on: false });
    }
  };

  /**
   * Why an import cannot be confirmed any more, from what it is now. A read that fails says nothing more
   * than the refusal did, which the caller shows.
   */
  const endedState = async (importId: string): Promise<Ended | null> => {
    try {
      const read = await queryClient.fetchQuery({ ...importQueryOptions(scope, importId), staleTime: 0 });
      const next = importPhase(read.status);
      return next === 'expired' || next === 'gone' || next === 'failed' ? next : null;
    } catch {
      return null;
    }
  };

  const onContinue = (): Promise<Verdict> => {
    const step = latest.current.step;
    if (step === 'upload') return continueUpload();
    if (step === 'map') return continueMap();
    if (step === 'review') {
      dispatch({ type: 'passed', step: 'review' });
      return Promise.resolve('ok');
    }
    return continueConfirm();
  };

  const close = (): void => {
    abandon();
    onOpenChange(false);
  };

  const startAgain = (): void => {
    // Nothing left to stop: the import is over. The options stay, the file goes.
    session.current.controller.abort();
    session.current.controller = new AbortController();
    dispatch({ type: 'reset', values: { ...state.values, file: null, head: null } });
  };

  const ids = stepsOf(state.values.source);
  const steps = ids.map((id): { id: StepId; label: string } => ({ id, label: t(`steps.${id}`) }));
  const vocabularyList = vocabularies.data?.data ?? [];
  const mapProblems = mappingProblems(state.mapping, {
    tagsVocabulary: state.values.tagsVocabulary,
    topicVocabulary: state.values.topicVocabulary,
  });
  const shownProblems = {
    form: state.mapProblems.checked ? mapProblems.form : null,
    rows: { ...(state.mapProblems.checked ? mapProblems.rows : {}), ...state.mapProblems.server },
  };

  // How far an upload has gone, or the reading of it: the Upload step's bar
  const reading = state.working && state.uploadProgress === null;
  const read = reading ? readingProgress(imported?.operation.progress) : null;
  const progress = state.uploadProgress ?? (reading ? (read?.percent ?? 0) : null);
  const progressText =
    state.uploadProgress !== null
      ? t('uploadProgress', { percent: state.uploadProgress })
      : !reading
        ? null
        : read === null
          ? t('reading')
          : t('readingRows', { done: formatInteger(read.done), total: formatInteger(read.total) });

  const retryRows = (): void => {
    rowQueries.forEach((query) => {
      if (query.isError) void query.refetch();
    });
  };

  return (
    <StepperDialog<StepId>
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else close();
      }}
      title={t('title')}
      steps={steps}
      current={state.step}
      completed={state.completed}
      onStepChange={(step) => dispatch({ type: 'step', step })}
      onContinue={onContinue}
      finalLabel={t('confirmButton', { count: plan.create + plan.unarchive })}
      finalDisabled={summary.overQuota > 0 || state.ended !== null}
      labels={{
        steps: t('stepsLabel'),
        close: common('close'),
        back: t('back'),
        cancel: common('cancel'),
        continue: t('continue'),
        completed: t('completed'),
      }}
      discard={{
        title: t('discardTitle'),
        description: t('discardDescription'),
        keepEditingLabel: t('discardKeep'),
        discardLabel: t('discardConfirm'),
      }}
    >
      {state.ended !== null ? (
        <>
          <FormAlert message={t(state.ended)} tabIndex={-1} live={false} />
          <div>
            <Button variant="secondary" onClick={startAgain}>
              {t('startAgain')}
            </Button>
          </div>
        </>
      ) : (
        <>
          {state.alert === null || state.step === 'map' ? null : (
            <FormAlert message={state.alert} tabIndex={-1} live={false} />
          )}
          {state.step === 'upload' ? (
            <UploadStep
              values={state.values}
              onChange={(patch) => dispatch({ type: 'values', patch })}
              onFileChecked={(checked) =>
                dispatch(
                  'problem' in checked
                    ? { type: 'file-problem', problem: checked.problem }
                    : { type: 'file', ...checked },
                )
              }
              errors={state.uploadErrors}
              progress={progress}
              progressText={progressText}
              busy={state.working}
              vocabularies={vocabularyList}
            />
          ) : null}
          {state.step === 'map' && state.values.head !== null ? (
            <MappingStep
              headers={state.values.head.headers}
              samples={state.values.head.samples}
              mapping={state.mapping}
              onMappingChange={(header, field) => dispatch({ type: 'mapping', header, field })}
              tagsVocabulary={state.values.tagsVocabulary}
              topicVocabulary={state.values.topicVocabulary}
              onVocabularyChange={(kind, id) =>
                dispatch({ type: 'values', patch: kind === 'tags' ? { tagsVocabulary: id } : { topicVocabulary: id } })
              }
              vocabularies={vocabularyList}
              problems={shownProblems}
              alert={state.alert}
              busy={state.working}
            />
          ) : null}
          {state.step === 'review' ? (
            <ReviewStep
              summary={summary}
              quota={imported?.quota ?? null}
              choices={state.choices}
              onChoicesChange={(patch) => dispatch({ type: 'choices', patch })}
              rows={rows}
              limit={ROWS_SHOWN}
              onRetryRows={retryRows}
            />
          ) : null}
          {state.step === 'confirm' ? <ConfirmStep plan={plan} overQuota={summary.overQuota} /> : null}
        </>
      )}
    </StepperDialog>
  );
}
