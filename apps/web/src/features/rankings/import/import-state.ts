import {
  DEFAULT_CHOICES,
  type ImportField,
  type ImportSource,
  type MappingRowProblem,
  type ReviewChoices,
  type StepId,
} from './import-model';
import type { components } from '@/lib/api/schema';
import type { CsvHead } from '@/lib/csv/csv-head';

type LocationRef = components['schemas']['LocationRef'];

export type Device = 'desktop' | 'mobile' | 'both';
export type CsvHeadOk = Extract<CsvHead, { kind: 'ok' }>;

/** What the Upload step has: the source, its content and the defaults for rows that leave them out. */
export interface UploadValues {
  source: ImportSource;
  file: File | null;
  head: CsvHeadOk | null;
  paste: string;
  /** The project's location unless the person picks another. */
  location: LocationRef | null;
  languageCode: string | null;
  /** `null` is the project's default device. */
  device: Device | null;
  tagsVocabulary: string | null;
  topicVocabulary: string | null;
}

/** Why a file was not taken, or why the step cannot go on without one. */
export type FileProblem =
  | 'not_csv'
  | 'too_large'
  | 'not_utf8'
  | 'empty'
  | 'header_too_long'
  | 'duplicate_headers'
  | 'no_rows'
  | 'unreadable'
  | 'required';

/** Why the API refused a vocabulary of the defaults. */
export type VocabularyProblem = 'not_allowed' | 'unknown';
/** What the API said of the vocabulary chosen for tags and for topics; `null` for one it took. */
export type VocabularyProblems = Readonly<Record<'tags' | 'topic', VocabularyProblem | null>>;
export const NO_VOCABULARY_PROBLEMS: VocabularyProblems = { tags: null, topic: null };

export interface UploadErrors {
  file: FileProblem | null;
  /** `too_long`: more than the API takes in one request (a million characters, and a body of 1 MB). */
  paste: 'required' | 'too_long' | null;
  /** A paste with tabs holds tags, which need a vocabulary. */
  tagsVocabulary: boolean;
  /** The API refused the vocabulary chosen for a paste's tags. */
  tagsVocabularyProblem: VocabularyProblem | null;
}

export const NO_UPLOAD_ERRORS: UploadErrors = {
  file: null,
  paste: null,
  tagsVocabulary: false,
  tagsVocabularyProblem: null,
};

/** What the Map step shows as wrong: asked once Continue found a problem, and what the API answered. */
export interface MapProblems {
  /** Continue checked the mapping, so the problems it finds show and follow every change. */
  checked: boolean;
  /** Problems the API reported for a header, which show until the mapping changes. */
  server: Readonly<Record<string, MappingRowProblem>>;
  /** Vocabularies the API refused, which show until another is chosen. */
  vocabulary: VocabularyProblems;
}

export const NO_MAP_PROBLEMS: MapProblems = { checked: false, server: {}, vocabulary: NO_VOCABULARY_PROBLEMS };

/** An import that cannot go on: the person starts again. `slow` is a read that was given up on. */
export type Ended = 'expired' | 'failed' | 'gone' | 'slow';

/** What the Upload step sent, to tell a Continue that changed nothing from one that needs a new import. */
export interface Submitted {
  source: ImportSource;
  file: File | null;
  paste: string;
  /** The options as sent, as text. */
  options: string;
}

export interface ImportState {
  values: UploadValues;
  importId: string | null;
  submitted: Submitted | null;
  step: StepId;
  completed: ReadonlySet<StepId>;
  mapping: Readonly<Record<string, ImportField>>;
  mapProblems: MapProblems;
  choices: ReviewChoices;
  /** 0 to 100 while the file goes up; `null` otherwise. */
  uploadProgress: number | null;
  uploadErrors: UploadErrors;
  /** A message of the server that belongs to no field, shown at the top of the step. */
  alert: string | null;
  ended: Ended | null;
  /** The API's code of a failure (`ended` is `failed`), which says why in words; `null` when it gave none. */
  endedCode: string | null;
  /** Continue is at work on the API (an upload, a new reading, the write): the steps hold still. */
  working: boolean;
}

export function initialValues(location: LocationRef | null, languageCode: string | null): UploadValues {
  return {
    source: 'upload',
    file: null,
    head: null,
    paste: '',
    location,
    languageCode,
    device: null,
    tagsVocabulary: null,
    topicVocabulary: null,
  };
}

export function initialState(values: UploadValues): ImportState {
  return {
    values,
    importId: null,
    submitted: null,
    step: 'upload',
    completed: new Set(),
    mapping: {},
    mapProblems: NO_MAP_PROBLEMS,
    choices: DEFAULT_CHOICES,
    uploadProgress: null,
    uploadErrors: NO_UPLOAD_ERRORS,
    alert: null,
    ended: null,
    endedCode: null,
    working: false,
  };
}

export type ImportAction =
  | { type: 'values'; patch: Partial<UploadValues> }
  | { type: 'file'; file: File; head: CsvHeadOk }
  | { type: 'file-problem'; problem: FileProblem }
  | { type: 'upload-errors'; errors: UploadErrors }
  | { type: 'mapping'; header: string; field: ImportField | null }
  | { type: 'map-problems'; problems: MapProblems }
  | { type: 'choices'; patch: Partial<ReviewChoices> }
  | { type: 'step'; step: StepId }
  | { type: 'passed'; step: StepId }
  | { type: 'imported'; importId: string; submitted: Submitted }
  /** The import has other defaults and the same source: it is read again, and the mapping stays. */
  | { type: 'resubmitted'; submitted: Submitted }
  /** The API reads the import again (a new mapping): what was reviewed and confirmed is of the old reading. */
  | { type: 'reparsed' }
  /** The mapping the Map step starts from, or the one the API now has. */
  | { type: 'mapping-set'; mapping: Readonly<Record<string, ImportField>> }
  | { type: 'working'; on: boolean }
  | { type: 'progress'; percent: number | null }
  | { type: 'alert'; message: string | null }
  | { type: 'ended'; reason: Ended; code: string | null }
  /** Back to an empty Upload step with these values: the defaults, or the ones to keep when starting again. */
  | { type: 'reset'; values: UploadValues };

/** The steps that passed, less Review and Confirm: the rows they showed were of a reading that is over. */
const withoutReviewed = (completed: ReadonlySet<StepId>): ReadonlySet<StepId> =>
  new Set([...completed].filter((step) => step !== 'review' && step !== 'confirm'));

/**
 * The dialog's state changes in one place, so a step never shows what another has moved past: a new file
 * clears the problems of the old one, a new mapping clears what the server said about the last, and a new
 * import starts with the choices of none.
 */
export function importReducer(state: ImportState, action: ImportAction): ImportState {
  switch (action.type) {
    case 'values':
      return {
        ...state,
        values: { ...state.values, ...action.patch },
        // The API's word on a vocabulary is about the one that was chosen: another choice clears it
        mapProblems: {
          ...state.mapProblems,
          vocabulary: {
            tags: 'tagsVocabulary' in action.patch ? null : state.mapProblems.vocabulary.tags,
            topic: 'topicVocabulary' in action.patch ? null : state.mapProblems.vocabulary.topic,
          },
        },
        uploadErrors: NO_UPLOAD_ERRORS,
        alert: null,
      };
    case 'file':
      return {
        ...state,
        values: { ...state.values, file: action.file, head: action.head },
        uploadErrors: NO_UPLOAD_ERRORS,
        alert: null,
      };
    case 'file-problem':
      return {
        ...state,
        values: { ...state.values, file: null, head: null },
        uploadErrors: { ...NO_UPLOAD_ERRORS, file: action.problem },
        alert: null,
      };
    case 'upload-errors':
      return { ...state, uploadErrors: action.errors };
    case 'mapping': {
      const others = Object.fromEntries(Object.entries(state.mapping).filter(([header]) => header !== action.header));
      return {
        ...state,
        mapping: action.field === null ? others : { ...others, [action.header]: action.field },
        mapProblems: { ...state.mapProblems, server: {} },
        alert: null,
      };
    }
    case 'map-problems':
      return { ...state, mapProblems: action.problems };
    case 'choices':
      return { ...state, choices: { ...state.choices, ...action.patch } };
    case 'step':
      return { ...state, step: action.step, alert: null };
    case 'passed':
      return { ...state, completed: new Set([...state.completed, action.step]) };
    case 'imported':
      return {
        ...state,
        importId: action.importId,
        submitted: action.submitted,
        mapping: {},
        mapProblems: NO_MAP_PROBLEMS,
        choices: DEFAULT_CHOICES,
        completed: new Set(),
        uploadProgress: null,
        alert: null,
        ended: null,
        endedCode: null,
      };
    case 'resubmitted':
      return { ...state, submitted: action.submitted, completed: withoutReviewed(state.completed), alert: null };
    case 'reparsed':
      return { ...state, completed: withoutReviewed(state.completed) };
    case 'mapping-set':
      return { ...state, mapping: action.mapping, mapProblems: NO_MAP_PROBLEMS, alert: null };
    case 'working':
      return { ...state, working: action.on, alert: action.on ? null : state.alert };
    case 'progress':
      return { ...state, uploadProgress: action.percent };
    case 'alert':
      return { ...state, alert: action.message };
    case 'ended':
      return { ...state, ended: action.reason, endedCode: action.code, uploadProgress: null };
    case 'reset':
      return initialState(action.values);
  }
}
