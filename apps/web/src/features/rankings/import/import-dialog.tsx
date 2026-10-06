'use client';

import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { z } from 'zod';

import { ConfirmStep } from './confirm-step';
import { useFailureText } from './import-failure';
import {
  NO_COUNTS,
  importDefaults,
  isMappingCurrent,
  mappedTwiceRows,
  readingProgress,
  repeatedHeaderRows,
  sameSource,
  sameSubmission,
  startingMapping,
  submissionOf,
  uploadErrorsOf,
  vocabularyProblemsOf,
} from './import-flow';
import {
  CANCEL_IMPORT,
  CHANGE_IMPORT,
  CONFIRM_IMPORT,
  CREATE_IMPORT,
  DIALOG_POLL_MS,
  READ_TIMEOUT_MS,
  ReadTimeoutError,
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
  selectableVocabularies,
  stepsOf,
  type ImportSource,
  type KeywordImport,
  type Outcome,
  type StepId,
} from './import-model';
import {
  NO_MAP_PROBLEMS,
  NO_UPLOAD_ERRORS,
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
import type { VocabularyListState } from './vocabulary-field';
import type { ProjectDefaults } from '../add-keywords/add-keywords-dialog';
import type { ProjectScope } from '../rankings-queries';
import { useVocabularyList } from '../taxonomy-queries';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { StepperDialog } from '@/components/ui/stepper-dialog';
import { isApiProblem } from '@/lib/api/problem';
import { uploadForm } from '@/lib/api/upload';
import { formatInteger } from '@/lib/format';
import { useMembership } from '@/lib/permissions';

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

/** The catalog key of the words for an import that cannot go on, other than a failure (told by its code). */
const ENDED_KEYS = {
  expired: 'expired',
  failed: 'failed',
  gone: 'gone',
  slow: 'readingSlow',
} as const satisfies Record<Ended, string>;

/** The code that says why an import failed: its own, or the one of its operation. */
const failureCodeOf = (read: KeywordImport): string | null => read.error_code ?? read.operation.error?.code ?? null;

/**
 * Import keywords (16-drawers-dialogs-popovers.md section 4.6, 10-forms.md section 15): a `StepperDialog`
 * with Upload, Map columns (files only), Review and Confirm. The steps draw what the state holds; this
 * component sends the requests and moves between the steps. Nothing is written until the last step, and
 * closing before that stops the import. Back keeps every earlier choice.
 */
export function ImportDialog({ scope, open, onOpenChange, onConfirmed, defaults }: ImportDialogProps): ReactElement {
  const t = useTranslations('rankings.import');
  const common = useTranslations('common');
  const failureText = useFailureText();
  const queryClient = useQueryClient();
  const membership = useMembership();
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
  // The import whose archived rows were last told to unarchive, which a later Confirm may have to take back
  const unarchiveSent = useRef<string | null>(null);
  // The import that needs no more stopping: the dialog closed on it, or its write started
  const abandoned = useRef<string | null>(null);
  // The dialog was closed and still holds what it showed, which it drops when it opens again
  const closed = useRef(false);
  // Where focus goes after Start again
  const [focusRequest, setFocusRequest] = useState(0);

  const vocabularies = useVocabularyList(scope, open);
  // A member limited to some projects may name only the vocabularies of a project (the API refuses the others)
  const vocabularyList = useMemo(
    () => selectableVocabularies(vocabularies.data?.data ?? [], membership.project_ids !== null),
    [vocabularies.data, membership.project_ids],
  );
  const vocabularyState: VocabularyListState =
    vocabularies.data !== undefined ? 'ready' : vocabularies.isError ? 'error' : 'loading';
  const vocabularyLoad = { state: vocabularyState, onRetry: () => void vocabularies.refetch() };
  // Polls with the tab hidden too: a file read in the background is waited for, not given up on
  const current = useImport(scope, state.importId, DIALOG_POLL_MS, true);
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
  // The upload goes through the mutation cache like every other write, so an answer that says the session is
  // gone is handled where all of them are handled
  const sendFile = useMutation({
    mutationFn: ({ form, signal }: { form: FormData; signal: AbortSignal }): Promise<unknown> =>
      uploadForm(uploadPath(scope), form, {
        signal,
        onProgress: ({ loaded, total }) =>
          dispatch({
            type: 'progress',
            percent: total === null || total === 0 ? null : Math.min(100, Math.round((loaded / total) * 100)),
          }),
      }),
  });

  /** The words for what the API refused or did not answer; `null` for a wait that was cut short on purpose. */
  const problemText = (error: unknown, source: ImportSource = 'upload'): string | null => {
    if (isAbort(error)) return null;
    // A paste goes in a JSON body of at most 1 MB, a file in an upload of at most 50 MB: each has its words
    if (isApiProblem(error, 'payload_too_large')) return source === 'paste' ? t('pasteTooLarge') : t('uploadTooLarge');
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
  const fail = (error: unknown, source: ImportSource = 'upload'): Verdict => {
    const message = problemText(error, source);
    if (message !== null) dispatch({ type: 'alert', message });
    return 'invalid';
  };
  const end = (reason: Ended, code: string | null = null): Verdict => {
    dispatch({ type: 'ended', reason, code });
    return 'invalid';
  };

  /**
   * What the API said of the vocabularies chosen, put on the choice it is about: on the Map step for a file, on
   * the Upload step for a paste's tags. `null` when the refusal is about something else.
   */
  const refuseVocabulary = (error: unknown, held: ImportState): Verdict | null => {
    if (!isApiProblem(error, 'validation_failed')) return null;
    const refused = vocabularyProblemsOf(error.errors);
    if (refused.tags === null && refused.topic === null) return null;
    if (held.values.source === 'paste' && held.step === 'upload' && refused.tags !== null) {
      dispatch({ type: 'upload-errors', errors: { ...NO_UPLOAD_ERRORS, tagsVocabularyProblem: refused.tags } });
      return 'invalid';
    }
    dispatch({ type: 'map-problems', problems: { ...NO_MAP_PROBLEMS, checked: true, vocabulary: refused } });
    // From Upload the choice is on the next step: the person is told here, and goes there to change it
    if (held.step === 'upload') {
      dispatch({
        type: 'alert',
        message:
          refused.tags === 'not_allowed' || refused.topic === 'not_allowed'
            ? t('vocabularyNotAllowed')
            : t('vocabularyUnknown'),
      });
    }
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

  /**
   * The end of a session: every request and wait the dialog had going stops, and the import it held is stopped.
   * What the dialog shows stays as it was (it is closing, and an empty first step would flash while it does);
   * it is dropped when the dialog opens again.
   */
  const abandon = useCallback((): void => {
    const held = latest.current;
    session.current.controller.abort();
    session.current.controller = new AbortController();
    // A close is seen twice (the handler, then the route's change of `open`): the import is stopped once
    if (held.importId !== null && held.importId !== abandoned.current && !confirming.current) {
      stopImport(held.importId);
    }
    abandoned.current = held.importId;
    closed.current = true;
  }, [stopImport]);

  // A screen that goes away with the dialog open ends its requests and waits and stops the import, as a close
  // does. A new controller on mount keeps Strict Mode's mount, unmount and mount from leaving an aborted one.
  const stopLatest = useRef(stopImport);
  useEffect(() => {
    stopLatest.current = stopImport;
  });
  useEffect(() => {
    // The holder is one object for the life of the dialog; only its controller is replaced
    const holder = session.current;
    holder.controller = new AbortController();
    return () => {
      holder.controller.abort();
      const held = latest.current;
      if (held.importId !== null && held.importId !== abandoned.current && !confirming.current) {
        stopLatest.current(held.importId);
      }
    };
  }, []);

  // A dialog the route closes (the Back button of the browser) is abandoned as one the person closed
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) abandon();
    wasOpen.current = open;
  }, [open, abandon]);

  // Opened again after a session: an empty first step, before it is seen
  useLayoutEffect(() => {
    if (!open || !closed.current) return;
    closed.current = false;
    abandoned.current = null;
    dispatch({ type: 'reset', values: startValues.current });
  }, [open]);

  const settle = (importId: string): Promise<KeywordImport> =>
    settledImport(queryClient, importKey(scope, importId), session.current.controller.signal, READ_TIMEOUT_MS, () =>
      queryClient.fetchQuery({ ...importQueryOptions(scope, importId), staleTime: 0 }),
    );

  /** What the dialog does with an import that finished reading: on to the next step, or why not. */
  const arrive = (read: KeywordImport, held: ImportState, fresh: boolean): Verdict => {
    const from = held.step;
    const values = held.values;
    const next = importPhase(read.status);
    if (next === 'failed') return end('failed', failureCodeOf(read));
    if (next === 'expired') return end('expired');
    if (next === 'gone') return end('gone');
    if (next !== 'ready' && next !== 'needs_mapping') return fail(new Error(`Unexpected import status ${read.status}`));
    if (values.source === 'paste') {
      if (next === 'needs_mapping') {
        if (read.error_code === 'tags_vocabulary_missing') {
          dispatch({ type: 'upload-errors', errors: { ...NO_UPLOAD_ERRORS, tagsVocabulary: true } });
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
      const blocked = found.form !== null || Object.keys(found.rows).length > 0;
      // From Map, a mapping the check finds sound and the API does not is not something the person can fix
      if (from === 'map' && !blocked) return fail(new Error(`Unexpected mapping problem ${read.error_code ?? 'none'}`));
      dispatch({ type: 'map-problems', problems: { ...NO_MAP_PROBLEMS, checked: true } });
      // From Map the person stays to fix it. From Upload they go there whatever the check says: a choice made on
      // Map and not sent yet (Back came first) may be what the import is waiting for.
      if (from === 'map') return 'invalid';
    }
    dispatch({ type: 'passed', step: from });
    return 'ok';
  };

  /** Sends the file or the paste and answers the new import's id; a paste's answer is the import itself. */
  const createFrom = async (values: UploadValues, signal: AbortSignal): Promise<string> => {
    const body = importDefaults(values);
    if (values.source === 'paste') {
      const answer = await createImport.mutateAsync({
        params: { path },
        body: { source: 'paste', paste: values.paste, defaults: body },
      });
      queryClient.setQueryData(importKey(scope, answer.data.import_id), answer.data);
      return answer.data.import_id;
    }
    if (values.file === null) throw new Error('The upload has no file');
    const form = new FormData();
    form.set('file', values.file);
    form.set('options', JSON.stringify({ defaults: body }));
    const answer = UPLOAD_ANSWER.parse(await sendFile.mutateAsync({ form, signal }));
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
      const unchanged = sameSubmission(held.submitted, submitted);
      // The same file or paste with other defaults is the same import, read again: nothing is sent twice
      const defaultsOnly = !unchanged && sameSource(held.submitted, submitted);
      const fresh = importId === null || (!unchanged && !defaultsOnly);
      if (fresh) {
        // Another file than the import was made from: it is replaced
        if (importId !== null) stopImport(importId);
        const made = await createFrom(held.values, signal);
        // Closed while it went up: the import exists, and nothing else would stop it
        if (signal.aborted) {
          stopImport(made);
          return 'invalid';
        }
        importId = made;
        dispatch({ type: 'progress', percent: null });
        dispatch({ type: 'imported', importId: made, submitted });
      } else if (defaultsOnly && importId !== null) {
        // The rows listed were of the old reading
        queryClient.removeQueries({ queryKey: rowsKey(scope, importId) });
        const answer = await changeImport.mutateAsync({
          params: { path: { ...path, import_id: importId } },
          body: { defaults: importDefaults(held.values) },
        });
        if (signal.aborted) return 'invalid';
        queryClient.setQueryData(importKey(scope, importId), answer.data);
        dispatch({ type: 'resubmitted', submitted });
      }
      if (importId === null) return 'invalid';
      const read = await settle(importId);
      return arrive(read, { ...held, importId }, fresh);
    } catch (error) {
      // A dialog closed meanwhile has nothing to show an error on
      if (signal.aborted) return 'invalid';
      if (error instanceof ReadTimeoutError) return end('slow');
      return refuseVocabulary(error, held) ?? fail(error, held.values.source);
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
    dispatch({ type: 'map-problems', problems: { ...NO_MAP_PROBLEMS, checked: true } });
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
      // What was reviewed and confirmed was of the reading that is over
      dispatch({ type: 'reparsed' });
      return arrive(await settle(importId), held, false);
    } catch (error) {
      if (signal.aborted) return 'invalid';
      if (error instanceof ReadTimeoutError) return end('slow');
      if (isApiProblem(error, 'validation_failed')) {
        const rows = {
          ...mappedTwiceRows(error.errors, held.mapping),
          ...repeatedHeaderRows(error.errors, held.mapping),
        };
        const refused = vocabularyProblemsOf(error.errors);
        if (Object.keys(rows).length > 0 || refused.tags !== null || refused.topic !== null) {
          dispatch({ type: 'map-problems', problems: { checked: true, server: rows, vocabulary: refused } });
          return 'invalid';
        }
        // Two keys that name one header, though no two columns do: the file is not one this step can map
        if (error.errors.some((item) => item.code === 'header_repeated')) {
          dispatch({ type: 'alert', message: t('headerRepeated') });
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
      // Archived keywords to unarchive: every archived row of the file, page by page. A Confirm that did not go
      // through may have sent them already, so a person who then chose to leave them archived sends the skip.
      const unarchiving = chosen.unarchive > 0;
      if (unarchiving || (known.counts.conflict > 0 && unarchiveSent.current === importId)) {
        const actions = await conflictRowActions(scope, importId, unarchiving ? 'merge' : 'skip', signal);
        // Marked before the first request: a batch may be applied on the API though its answer never arrives, and
        // a later choice to leave the keywords archived must still take them all back
        if (unarchiving) unarchiveSent.current = importId;
        for (let at = 0; at < actions.length; at += ROW_ACTIONS_PER_REQUEST) {
          if (signal.aborted) return 'invalid';
          const answer = await changeImport.mutateAsync({
            params: { path: { ...path, import_id: importId } },
            body: { row_actions: actions.slice(at, at + ROW_ACTIONS_PER_REQUEST) },
          });
          // The answer is the import as the actions leave it, with the quota they use
          queryClient.setQueryData(importKey(scope, importId), answer.data);
        }
        if (!unarchiving) unarchiveSent.current = null;
        const after = queryClient.getQueryData<KeywordImport>(importKey(scope, importId));
        // Unarchiving can take the import over the limit: the step says so, instead of the refusal of Confirm
        if (after !== undefined && outcomeSummary(after.counts, after.quota).overQuota > 0) return 'invalid';
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
      // An answer that comes after the dialog was closed has nobody to move
      if (signal.aborted) return 'invalid';
      abandon();
      onOpenChange(false);
      return 'ok';
    } catch (error) {
      if (signal.aborted) return 'invalid';
      if (isApiProblem(error, 'invalid_state_transition')) {
        const over = await endedState(importId);
        if (over !== null) return end(over.reason, over.code);
      }
      if (isApiProblem(error, 'forbidden')) {
        dispatch({ type: 'alert', message: t('confirmForbidden') });
        return 'invalid';
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
  const endedState = async (importId: string): Promise<{ reason: Ended; code: string | null } | null> => {
    try {
      const read = await queryClient.fetchQuery({ ...importQueryOptions(scope, importId), staleTime: 0 });
      const next = importPhase(read.status);
      if (next === 'expired') return { reason: 'expired', code: null };
      if (next === 'gone') return { reason: 'gone', code: null };
      return next === 'failed' ? { reason: 'failed', code: failureCodeOf(read) } : null;
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
    // The import is over, or was given up on: a read that never ended is stopped. The options stay, the file goes.
    if (state.importId !== null) stopImport(state.importId);
    session.current.controller.abort();
    session.current.controller = new AbortController();
    dispatch({ type: 'reset', values: { ...state.values, file: null, head: null } });
    setFocusRequest((count) => count + 1);
  };

  const ids = stepsOf(state.values.source);
  const steps = ids.map((id): { id: StepId; label: string } => ({ id, label: t(`steps.${id}`) }));
  const mapProblems = mappingProblems(state.mapping, {
    tagsVocabulary: state.values.tagsVocabulary,
    topicVocabulary: state.values.topicVocabulary,
  });
  const shownProblems = {
    form: state.mapProblems.checked ? mapProblems.form : null,
    rows: { ...(state.mapProblems.checked ? mapProblems.rows : {}), ...state.mapProblems.server },
    vocabulary: state.mapProblems.vocabulary,
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
          <FormAlert
            message={state.ended === 'failed' ? failureText(state.endedCode, t('failed')) : t(ENDED_KEYS[state.ended])}
            tabIndex={-1}
            live={false}
          />
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
              vocabularyList={vocabularyLoad}
              focusRequest={focusRequest}
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
              vocabularyList={vocabularyLoad}
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
