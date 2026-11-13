'use client';

/**
 * The state of one customizable screen (docs/superpowers/plans/2026-11-13-ai-wp-15-layouts-core.md, section 2.6):
 * the layout read from the API, the mode, the draft with its history, the saves and the words said for each edit.
 * The grid, the frame and WP-16's controls only read this and call its actions.
 */
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  use,
  useCallback,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import { useLayoutAnnouncer } from './announcements';
import {
  layoutQueryKey,
  toResolved,
  type ApiResolvedLayout,
  type LayoutRead,
  type ResolvedLayoutView,
} from './layout-api';
import {
  INITIAL_LAYOUT_STATE,
  layoutReducer,
  type CardPart,
  type FocusRequest,
  type LayoutAction,
  type LayoutMode,
  type LayoutState,
} from './layout-state';
import type { CardRegistry } from './registry';
import { useLayout } from './use-layout';
import { isApiProblem, type ApiProblem } from '@/lib/api/problem';
import {
  SCREENS,
  addCard as draftAddCard,
  addNumber as draftAddNumber,
  canAddCard,
  cardAvailability,
  cardName,
  cardType,
  changeCount,
  duplicateCard as draftDuplicateCard,
  hideCard as draftHideCard,
  moveCard as draftMoveCard,
  moveNumber as draftMoveNumber,
  numberName,
  removeNumber as draftRemoveNumber,
  sameLayout,
  setCardOption as draftSetCardOption,
  setCardWidth as draftSetCardWidth,
  type Availability,
  type Capabilities,
  type CardItem,
  type EngineCode,
  type LayoutDocument,
  type NumberItem,
  type ScreenDefinition,
  type ScreenKey,
  type Width,
} from '@/lib/layouts';
import { useCan } from '@/lib/permissions';

export interface LayoutProviderProps {
  screen: ScreenKey;
  workspaceId: string;
  capabilities: Capabilities;
  registry: CardRegistry;
  children: ReactNode;
}

/** What a write came to; the save bar and the conflict dialog of WP-16 run on it. */
export type SaveOutcome =
  { kind: 'saved' } | { kind: 'unchanged' } | { kind: 'conflict' } | { kind: 'failed'; problem: ApiProblem | Error };

/**
 * Every edit answers whether it changed the draft (or the new id, null when refused). A refused edit says
 * nothing. An action always works on the draft and the history as they are now, so one kept from an earlier
 * render (the Undo of a toast) and two edits made in one event both do what they say. One write goes to the API
 * at a time: a second call while one is under way gets the outcome of the first.
 */
export interface LayoutActions {
  /** A no-op unless the layout was read. */
  enter(): void;
  /** Drops the draft; asking first is WP-16's (it reads `dirty`). */
  exit(): void;
  addCard(type: string, index?: number): string | null;
  /** Focus goes to the next card, else the previous, else the Add card slot. */
  hideCard(id: string): boolean;
  moveCard(id: string, toIndex: number, part?: CardPart): boolean;
  setCardWidth(id: string, width: Width): boolean;
  setCardOption(id: string, key: string, value: string): boolean;
  /** A copy right after the card, on the next free identity value; the id of the copy, null when refused. Focus goes to its handle. */
  duplicateCard(id: string): string | null;
  /** Says the number and asks focus for its handle in the numbers zone (`FocusRequest.zone`). */
  addNumber(metric: string, engine?: EngineCode, index?: number): string | null;
  /** Focus goes to the next number, else the previous, else the Add number slot (id null). */
  removeNumber(id: string): boolean;
  /** Says the new position; focus goes back to `part` of the number (the handle, or the More menu that moved it). */
  moveNumber(id: string, toIndex: number, part?: CardPart): boolean;
  /** Reset to default and presets. A draft that already shows `document` is left alone (no history entry). */
  replaceDraft(document: LayoutDocument, message: string): boolean;
  undo(): boolean;
  redo(): boolean;
  save(): Promise<SaveOutcome>;
  /**
   * "Keep mine": reads the layout again, then puts the draft with the ETag of that read. It writes the personal
   * layout only: after a `conflict` of `saveTeamDefault()`, WP-16 calls `saveTeamDefault()` again, which sends
   * the ETag the conflict has just read.
   */
  saveAnyway(): Promise<SaveOutcome>;
  /** "Load the other version": the layout as read after the conflict becomes the draft and the baseline. */
  loadRemote(): void;
  saveTeamDefault(): Promise<SaveOutcome>;
  removeTeamDefault(): Promise<SaveOutcome>;
  focused(): void;
}

export interface LayoutContextValue {
  screen: ScreenKey;
  definition: ScreenDefinition;
  status: 'loading' | 'ready' | 'error';
  /** A read is under way while there is a layout to show. */
  refetching: boolean;
  /** The built-in layout while loading or after a failed read. */
  resolved: ResolvedLayoutView;
  mode: LayoutMode;
  /** What renders: the draft in customize mode, else the resolved document. */
  document: LayoutDocument;
  /** Where customizing began (or was rebased); null in view mode. */
  baseline: LayoutDocument | null;
  /** What Reset goes to and what a draft is compared with: the team default document, else the built-in one. */
  defaultDocument: LayoutDocument;
  /** changeCount(baseline, draft); 0 in view mode. */
  changes: number;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** A write, or the read that "Keep mine" makes before it, is under way. */
  saving: boolean;
  /** The read succeeded; never after a failed read. */
  canCustomize: boolean;
  /** `layouts:manage`: the team default. */
  canManage: boolean;
  focus: FocusRequest | null;
  capabilities: Capabilities;
  registry: CardRegistry;
  availabilityOf(item: CardItem): Availability;
  /** View mode: the cards available here. Customize mode: every card the person may see, explained when unavailable. */
  shownCards: readonly CardItem[];
  actions: LayoutActions;
  retry(): void;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

const UNCHANGED: SaveOutcome = { kind: 'unchanged' };
const SAVED: SaveOutcome = { kind: 'saved' };
const CONFLICT: SaveOutcome = { kind: 'conflict' };
const AVAILABLE: Availability = { state: 'available' };

const cardsOf = (document: LayoutDocument): readonly CardItem[] => document.cards ?? [];
const numbersOf = (document: LayoutDocument): readonly NumberItem[] => document.numbers ?? [];

const builtinAnswer = (screen: ScreenKey): ApiResolvedLayout => ({
  screen,
  source: 'builtin',
  document: null,
  team_default_exists: false,
  team_document: null,
  updated_at: null,
  updated_by: null,
});

/** What Reset goes to: the team default document, else the built-in layout of the screen. */
const defaultOf = (view: ResolvedLayoutView, screen: ScreenKey): LayoutDocument =>
  view.teamDocument ?? structuredClone(SCREENS[screen].builtin);

const changesOf = (state: LayoutState): number =>
  state.baseline !== null && state.draft !== null ? changeCount(state.baseline, state.draft) : 0;

/** View mode: the cards available here. Customize mode: every card the person may see. */
function shownIn(
  document: LayoutDocument,
  customizing: boolean,
  availabilityOf: (item: CardItem) => Availability,
): readonly CardItem[] {
  return cardsOf(document).filter((item) => {
    const { state } = availabilityOf(item);
    return customizing ? state !== 'hidden' : state === 'available';
  });
}

function failureOf(error: unknown): SaveOutcome {
  if (isApiProblem(error, 'precondition_failed')) return CONFLICT;
  return { kind: 'failed', problem: error instanceof Error ? error : new Error(String(error)) };
}

/** An id no card or number of the document has: 8 characters of a random id after the prefix. */
function newId(prefix: 'c' | 'n', document: LayoutDocument): string {
  const taken = new Set([...cardsOf(document), ...(document.numbers ?? [])].map((item) => item.id));
  for (;;) {
    const id = `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
    if (!taken.has(id)) return id;
  }
}

function ScreenProvider({ screen, workspaceId, capabilities, registry, children }: LayoutProviderProps): ReactElement {
  const [state, dispatch] = useReducer(layoutReducer, INITIAL_LAYOUT_STATE);
  // The reducer state as of the last action. Every action reads and moves it, so what an action sees is never an
  // older render's draft; the reducer is pure, so React's own copy reaches the same state.
  const live = useRef<LayoutState>(state);
  const send = useCallback((action: LayoutAction): void => {
    live.current = layoutReducer(live.current, action);
    dispatch(action);
  }, []);
  const writing = useRef<Promise<SaveOutcome> | null>(null);
  const [rereading, setRereading] = useState(false);
  const queryClient = useQueryClient();
  const customizing = state.mode === 'customize';
  // A refetch on window focus or on reconnect would hand the next save the ETag of a layout the draft never saw
  const { query, savePersonal, removePersonal, saveTeam, removeTeam } = useLayout(workspaceId, screen, {
    refetch: !customizing,
  });
  const say = useLayoutAnnouncer();
  const canManage = useCan('layouts:manage');
  const definition = SCREENS[screen];

  const status = query.data !== undefined ? 'ready' : query.isError ? 'error' : 'loading';
  const resolved = useMemo(() => toResolved(query.data?.layout ?? builtinAnswer(screen), screen), [query.data, screen]);
  /** The ETag of the layout as read: what the next save sends as If-Match. */
  const etag = query.data?.etag ?? null;
  const defaultDocument = useMemo(() => defaultOf(resolved, screen), [resolved, screen]);
  // The draft only exists in customize mode, and a refetch never touches it
  const document = state.draft ?? resolved.document;
  const changes = changesOf(state);
  const saving =
    rereading || savePersonal.isPending || removePersonal.isPending || saveTeam.isPending || removeTeam.isPending;
  const { refetch } = query;
  const { mutateAsync: putPersonal } = savePersonal;
  const { mutateAsync: deletePersonal } = removePersonal;
  const { mutateAsync: putTeam } = saveTeam;
  const { mutateAsync: deleteTeam } = removeTeam;

  const availabilityOf = useMemo(
    () =>
      (item: CardItem): Availability => {
        const type = cardType(item.type);
        return type === undefined ? AVAILABLE : cardAvailability(type, capabilities);
      },
    [capabilities],
  );
  const shownCards = useMemo(
    () => shownIn(document, customizing, availabilityOf),
    [document, customizing, availabilityOf],
  );

  const actions = useMemo<LayoutActions>(() => {
    const edit = (next: LayoutDocument, focus?: FocusRequest): boolean => {
      // A write is putting the draft as it was: an edit now would be lost when the write ends the mode
      if (live.current.draft === null || writing.current !== null || next === live.current.draft) return false;
      send({ type: 'edit', next, focus });
      return true;
    };
    const finish = (): SaveOutcome => {
      send({ type: 'exit' });
      say.saved();
      return SAVED;
    };
    /** One write at a time: a second call while one is under way (a double click) gets that one's outcome. */
    const exclusive = (write: () => Promise<SaveOutcome>): Promise<SaveOutcome> => {
      if (writing.current !== null) return writing.current;
      const running = write().finally(() => {
        writing.current = null;
      });
      writing.current = running;
      return running;
    };

    /** The personal layout becomes the draft, or goes when the draft is the default again (the person follows it). */
    const writePersonal = async (view: ResolvedLayoutView, ifMatch: string | null): Promise<SaveOutcome> => {
      const { draft } = live.current;
      if (draft === null) return UNCHANGED;
      try {
        if (sameLayout(draft, defaultOf(view, screen))) await deletePersonal();
        else await putPersonal({ document: draft, etag: ifMatch });
      } catch (error) {
        return failureOf(error);
      }
      return finish();
    };

    return {
      enter: () => {
        if (status !== 'ready' || live.current.mode === 'customize') return;
        send({ type: 'enter', document: resolved.document });
        say.entered(definition.title);
      },
      exit: () => {
        send({ type: 'exit' });
      },
      addCard: (type, index) => {
        const { draft } = live.current;
        if (draft === null || !canAddCard(draft, type, screen)) return null;
        const id = newId('c', draft);
        const next = draftAddCard(draft, type, id, index);
        const cards = cardsOf(next);
        const card = cards.find((candidate) => candidate.id === id);
        if (card === undefined || !edit(next, { id, part: 'handle' })) return null;
        say.added({ card: cardName(card), position: cards.indexOf(card) + 1, total: cards.length });
        return id;
      },
      hideCard: (id) => {
        const { draft } = live.current;
        const card = draft === null ? undefined : cardsOf(draft).find((candidate) => candidate.id === id);
        if (draft === null || card === undefined) return false;
        const shown = shownIn(draft, true, availabilityOf);
        const at = shown.findIndex((candidate) => candidate.id === id);
        const neighbour = shown[at + 1] ?? shown[at - 1];
        if (!edit(draftHideCard(draft, id), { id: neighbour?.id ?? null, part: 'handle' })) return false;
        say.hidden(cardName(card));
        return true;
      },
      moveCard: (id, toIndex, part = 'handle') => {
        const { draft } = live.current;
        if (draft === null) return false;
        const next = draftMoveCard(draft, id, toIndex);
        if (!edit(next, { id, part })) return false;
        const cards = cardsOf(next);
        const card = cards.find((candidate) => candidate.id === id);
        if (card !== undefined)
          say.moved({ card: cardName(card), position: cards.indexOf(card) + 1, total: cards.length });
        return true;
      },
      setCardWidth: (id, width) => {
        const { draft } = live.current;
        if (draft === null) return false;
        const next = draftSetCardWidth(draft, id, width);
        if (!edit(next, { id, part: 'width' })) return false;
        const card = cardsOf(next).find((candidate) => candidate.id === id);
        if (card !== undefined) say.width({ card: cardName(card), width });
        return true;
      },
      setCardOption: (id, key, value) => {
        const { draft } = live.current;
        if (draft === null) return false;
        const next = draftSetCardOption(draft, id, key, value);
        // No focus request: the options popover is open and keeps focus in its radio group while a choice is made
        if (!edit(next)) return false;
        const card = cardsOf(next).find((candidate) => candidate.id === id);
        const option = card === undefined ? undefined : cardType(card.type)?.options[key];
        if (card !== undefined) {
          say.option({
            card: cardName(card),
            option: option?.label ?? key,
            value: option?.values.find((candidate) => candidate.value === value)?.label ?? value,
          });
        }
        return true;
      },
      duplicateCard: (id) => {
        const { draft } = live.current;
        if (draft === null) return null;
        const copyId = newId('c', draft);
        const next = draftDuplicateCard(draft, id, copyId);
        const cards = cardsOf(next);
        const copy = cards.find((candidate) => candidate.id === copyId);
        if (copy === undefined || !edit(next, { id: copyId, part: 'handle' })) return null;
        say.duplicated({ card: cardName(copy), position: cards.indexOf(copy) + 1, total: cards.length });
        return copyId;
      },
      addNumber: (metric, engine, index) => {
        const { draft } = live.current;
        if (draft === null) return null;
        const id = newId('n', draft);
        const next = draftAddNumber(draft, engine === undefined ? { id, metric } : { id, metric, engine }, index);
        const added = numbersOf(next).find((candidate) => candidate.id === id);
        if (added === undefined || !edit(next, { id, part: 'handle', zone: 'numbers' })) return null;
        say.numberAdded(numberName(added));
        return id;
      },
      removeNumber: (id) => {
        const { draft } = live.current;
        const numbers = draft === null ? [] : numbersOf(draft);
        const at = numbers.findIndex((candidate) => candidate.id === id);
        const removed = numbers[at];
        if (draft === null || removed === undefined) return false;
        const neighbour = numbers[at + 1] ?? numbers[at - 1];
        if (!edit(draftRemoveNumber(draft, id), { id: neighbour?.id ?? null, part: 'handle', zone: 'numbers' })) {
          return false;
        }
        say.numberRemoved(numberName(removed));
        return true;
      },
      moveNumber: (id, toIndex, part = 'handle') => {
        const { draft } = live.current;
        if (draft === null) return false;
        const next = draftMoveNumber(draft, id, toIndex);
        if (!edit(next, { id, part, zone: 'numbers' })) return false;
        const numbers = numbersOf(next);
        const moved = numbers.find((candidate) => candidate.id === id);
        if (moved !== undefined) {
          say.numberMoved({ number: numberName(moved), position: numbers.indexOf(moved) + 1, total: numbers.length });
        }
        return true;
      },
      replaceDraft: (replacement, message) => {
        const { draft } = live.current;
        if (draft === null || sameLayout(draft, replacement) || !edit(structuredClone(replacement))) return false;
        say.say(message);
        return true;
      },
      undo: () => {
        if (live.current.past.length === 0 || writing.current !== null) return false;
        send({ type: 'undo' });
        say.undone();
        return true;
      },
      redo: () => {
        if (live.current.future.length === 0 || writing.current !== null) return false;
        send({ type: 'redo' });
        say.redone();
        return true;
      },
      save: async () => {
        if (changesOf(live.current) === 0) return UNCHANGED;
        return exclusive(() => writePersonal(resolved, etag));
      },
      saveAnyway: async () =>
        exclusive(async () => {
          setRereading(true);
          try {
            const reread = await refetch();
            if (reread.isError || reread.data === undefined) {
              return failureOf(reread.error ?? new Error('The layout could not be read again'));
            }
            return await writePersonal(toResolved(reread.data.layout, screen), reread.data.etag);
          } finally {
            setRereading(false);
          }
        }),
      loadRemote: () => {
        send({ type: 'reload', document: resolved.document });
      },
      saveTeamDefault: async () => {
        if (live.current.draft === null) return UNCHANGED;
        return exclusive(async () => {
          const { draft } = live.current;
          if (draft === null) return UNCHANGED;
          try {
            await putTeam({ document: draft, etag });
            // The person's own layout would keep hiding the new team default
            if (resolved.source === 'personal') await deletePersonal();
          } catch (error) {
            return failureOf(error);
          }
          return finish();
        });
      },
      removeTeamDefault: async () =>
        exclusive(async () => {
          try {
            await deleteTeam();
          } catch (error) {
            return failureOf(error);
          }
          // The removal has read the layout again: what the person would see now is the new baseline
          const read = queryClient.getQueryData<LayoutRead>(layoutQueryKey(workspaceId, screen));
          if (changesOf(live.current) > 0) {
            send({ type: 'rebase', baseline: toResolved(read?.layout ?? builtinAnswer(screen), screen).document });
          } else {
            send({ type: 'exit' });
          }
          return SAVED;
        }),
      focused: () => {
        send({ type: 'focused' });
      },
    };
  }, [
    send,
    status,
    resolved,
    etag,
    screen,
    workspaceId,
    definition.title,
    availabilityOf,
    say,
    queryClient,
    refetch,
    putPersonal,
    deletePersonal,
    putTeam,
    deleteTeam,
  ]);

  const value = useMemo<LayoutContextValue>(
    () => ({
      screen,
      definition,
      status,
      refetching: query.isFetching && query.data !== undefined,
      resolved,
      mode: state.mode,
      document,
      baseline: state.baseline,
      defaultDocument,
      changes,
      dirty: changes > 0,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      saving,
      canCustomize: status === 'ready',
      canManage,
      focus: state.focus,
      capabilities,
      registry,
      availabilityOf,
      shownCards,
      actions,
      retry: () => {
        void refetch();
      },
    }),
    [
      screen,
      definition,
      status,
      query.isFetching,
      query.data,
      resolved,
      state.mode,
      state.baseline,
      state.past.length,
      state.future.length,
      state.focus,
      document,
      defaultDocument,
      changes,
      saving,
      canManage,
      capabilities,
      registry,
      availabilityOf,
      shownCards,
      actions,
      refetch,
    ],
  );

  return <LayoutContext value={value}>{children}</LayoutContext>;
}

/** One screen's layout. It starts again when the workspace or the screen changes, so no draft crosses over. */
export function LayoutProvider(props: LayoutProviderProps): ReactElement {
  return <ScreenProvider key={`${props.workspaceId}|${props.screen}`} {...props} />;
}

/** The provider of the nearest screen; throws outside one. */
export function useLayoutScreen(): LayoutContextValue {
  const value = use(LayoutContext);
  if (value === null) throw new Error('useLayoutScreen is used outside a LayoutProvider');
  return value;
}
