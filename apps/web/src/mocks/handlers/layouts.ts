import { HttpResponse, type HttpHandler } from 'msw';
import { z } from 'zod';

import { workspaceCaller } from './access';
import { jsonCookie, readJsonCookie } from '../cookie-json';
import { invalid, invalidField, mock, noContent, problem } from '../respond';
import { LAYOUTS_COOKIE } from '../session';
import type { Problem, Schemas, ValidationItem } from '@/lib/api/types';
import {
  ENGINES,
  LIMITS,
  SCREENS,
  WIDTHS,
  cardType,
  numberType,
  type LayoutSource,
  type ScreenDefinition,
} from '@/lib/layouts';

/**
 * Team and personal page layouts (contract C12a, backend `api/layouts/`): what a member sees on a screen
 * (personal, else team default, else the built-in one), the `ETag` and `If-Match` that guard a save, and the
 * checks a document passes in the API's order (shape, size, then the catalog of `lib/layouts/catalog.ts`).
 * What a browser saved is kept in the layouts cookie.
 */

/** The largest document the API stores (`DOCUMENT_MAX_BYTES`). */
const DOCUMENT_MAX_BYTES = 16 * 1024;
const SCREEN_KEY = /^[a-z_]+(\.[a-z_]+)?$/;
const IF_MATCH_MAX = 128;
// Pydantic's `printable`: no control, format or line and paragraph separator characters
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

const ID = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
const CATALOG_KEY = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/);
const OPTION_KEY = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_]+$/);
const OPTION_VALUE = z
  .string()
  .max(256)
  .refine((value) => !UNPRINTABLE.test(value));
/** Only the engines the API accepts: `google_ai_overview` is refused until slice 2. */
const ENGINE = z.enum(ENGINES.map((engine) => engine.code));

const DOCUMENT = z.strictObject({
  schema: z.literal(1),
  numbers: z
    .array(z.strictObject({ id: ID, metric: CATALOG_KEY, engine: ENGINE.nullish() }))
    .max(LIMITS.numbers)
    .nullish(),
  cards: z
    .array(
      z.strictObject({
        id: ID,
        type: CATALOG_KEY,
        width: z.enum(WIDTHS).nullish(),
        options: z.record(OPTION_KEY, OPTION_VALUE).nullish(),
      }),
    )
    .max(LIMITS.cards)
    .nullish(),
});
type ParsedDocument = z.infer<typeof DOCUMENT>;

const ROW = z.object({
  id: z.string(),
  // Kept as stored JSON; read back through `DOCUMENT` so a hand edited cookie is never trusted
  document: z.record(z.string(), z.unknown()),
  updated_at: z.string(),
  updated_by: z.object({ user_id: z.string(), name: z.string() }),
});
type Row = z.infer<typeof ROW>;
const STATE = z.object({
  /** `<user_id>|<screen>` to the person's layout. */
  personal: z.record(z.string(), ROW),
  /** Screen to the team default. */
  team: z.record(z.string(), ROW),
});
type State = z.infer<typeof STATE>;
const EMPTY_STATE: State = { personal: {}, team: {} };

type Param = string | readonly string[] | undefined;
type Cookies = Readonly<Record<string, string>>;
type Answer = HttpResponse<Schemas['ResolvedLayoutResponse'] | Problem>;

const readState = (cookies: Cookies): State => readJsonCookie(cookies, LAYOUTS_COOKIE, STATE, EMPTY_STATE);

const pathOf = (path: readonly PropertyKey[]): string => path.map(String).join('.');
const bodyItem = (path: string, code: string, message: string): ValidationItem => ({
  location: 'body',
  path,
  code,
  message,
});

/** The `code` Pydantic gives the failures of a request model, from the zod issue of the same check. */
function pydanticCode(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'unrecognized_keys':
      return 'extra_forbidden';
    case 'invalid_type':
      if (issue.input === undefined) return 'missing';
      if (issue.expected === 'object') return issue.path.length === 0 ? 'model_attributes_type' : 'dict_type';
      return issue.expected === 'array' ? 'list_type' : 'string_type';
    case 'too_big':
      return issue.origin === 'array' ? 'too_long' : 'string_too_long';
    case 'too_small':
      return 'string_too_short';
    case 'invalid_format':
    case 'invalid_key':
      return 'string_pattern_mismatch';
    case 'invalid_value':
      return issue.input === undefined ? 'missing' : 'literal_error';
    default:
      return 'value_error';
  }
}

/** The field errors of a body that is not a layout document (`extra_forbidden`, `too_long`, `literal_error`...). */
function shapeErrors(body: unknown): { document: ParsedDocument } | { errors: ValidationItem[] } {
  const parsed = DOCUMENT.safeParse(body, { reportInput: true });
  if (parsed.success) return { document: parsed.data };
  return {
    errors: parsed.error.issues.flatMap((issue) =>
      issue.code === 'unrecognized_keys'
        ? issue.keys.map((key) =>
            bodyItem(pathOf([...issue.path, key]), 'extra_forbidden', 'Extra inputs are not permitted'),
          )
        : [bodyItem(pathOf(issue.path), pydanticCode(issue), issue.message)],
    ),
  };
}

/** What the catalog allows of `document` on `screen`: the checks of `catalog.py` `document_errors`. */
function catalogErrors(screen: ScreenDefinition, document: ParsedDocument): ValidationItem[] {
  const { zones } = screen;
  const errors: ValidationItem[] = [];
  const numbers = document.numbers ?? [];
  if (numbers.length > 0 && !zones.numbers) {
    errors.push(bodyItem('numbers', 'not_on_screen', 'This screen has no headline numbers.'));
  } else {
    numbers.forEach((number, index) => {
      const at = `numbers.${String(index)}`;
      const type = numberType(number.metric);
      if (type?.screens.includes(screen.key) !== true) {
        errors.push(bodyItem(`${at}.metric`, 'not_in_catalog', 'Not a number of this screen.'));
      } else if (type.perEngine && number.engine == null) {
        errors.push(bodyItem(`${at}.engine`, 'required', 'An AI number names its engine.'));
      } else if (!type.perEngine && number.engine != null) {
        errors.push(bodyItem(`${at}.engine`, 'not_applicable', 'Only AI numbers name an engine.'));
      }
    });
  }
  const cards = document.cards ?? [];
  if (cards.length > 0 && !zones.cards) {
    errors.push(bodyItem('cards', 'not_on_screen', 'This screen has no cards.'));
  } else {
    cards.forEach((card, index) => {
      const at = `cards.${String(index)}`;
      const type = cardType(card.type);
      if (type?.screens.includes(screen.key) !== true) {
        errors.push(bodyItem(`${at}.type`, 'not_in_catalog', 'Not a card of this screen.'));
      } else if (card.width != null && !(zones.widths && type.widths.includes(card.width))) {
        errors.push(bodyItem(`${at}.width`, 'width_not_allowed', 'Not a width this card takes here.'));
      }
    });
  }
  return errors;
}

/** The document as stored: the members a client left out or sent as null are not kept. */
const compact = (document: ParsedDocument): ParsedDocument => ({
  schema: 1,
  ...(document.numbers == null
    ? {}
    : {
        numbers: document.numbers.map((number) => ({
          id: number.id,
          metric: number.metric,
          ...(number.engine == null ? {} : { engine: number.engine }),
        })),
      }),
  ...(document.cards == null
    ? {}
    : {
        cards: document.cards.map((card) => ({
          id: card.id,
          type: card.type,
          ...(card.width == null ? {} : { width: card.width }),
          ...(card.options == null ? {} : { options: card.options }),
        })),
      }),
});

/** The document as the API answers it: every member there, null when absent. */
const served = (document: ParsedDocument): Schemas['LayoutDocument'] => ({
  schema: 1,
  numbers: document.numbers?.map((number) => ({ ...number, engine: number.engine ?? null })) ?? null,
  cards: document.cards?.map((card) => ({ ...card, width: card.width ?? null, options: card.options ?? null })) ?? null,
});

/**
 * The stored document of `row` when it is still a layout of `screen`; a damaged or outdated one counts as
 * absent, so a person falls back to the next layout and `team_document` is null (contract C12a).
 */
function usable(screen: ScreenDefinition, row: Row | undefined): ParsedDocument | null {
  if (row === undefined) return null;
  const checked = shapeErrors(row.document);
  return 'document' in checked && catalogErrors(screen, checked.document).length === 0 ? checked.document : null;
}

const partOf = (row: Row | undefined): string => (row === undefined ? '-' : `${row.id}:${row.updated_at}`);
/** Opaque like the API's hash: it covers the caller's personal row and the team row of the screen. */
const etagOf = (personal: Row | undefined, team: Row | undefined): string => `"${partOf(personal)}|${partOf(team)}"`;

interface Rows {
  personal: Row | undefined;
  team: Row | undefined;
}

const rowsOf = (state: State, userId: string, screen: ScreenDefinition): Rows => ({
  personal: state.personal[`${userId}|${screen.key}`],
  team: state.team[screen.key],
});

/** The layout that counts for a caller: their own, else the team default, else none (the built-in one). */
interface Winner {
  source: LayoutSource;
  document: ParsedDocument | null;
  row: Row | undefined;
}

function answer(screen: ScreenDefinition, { personal, team }: Rows, setCookie?: string): Answer {
  const personalDocument = usable(screen, personal);
  const teamDocument = usable(screen, team);
  const winner: Winner =
    personalDocument !== null
      ? { source: 'personal', document: personalDocument, row: personal }
      : teamDocument !== null
        ? { source: 'team', document: teamDocument, row: team }
        : { source: 'builtin', document: null, row: undefined };
  const layout: Schemas['ResolvedLayout'] = {
    screen: screen.key,
    source: winner.source,
    document: winner.document === null ? null : served(winner.document),
    team_default_exists: teamDocument !== null,
    team_document: teamDocument === null ? null : served(teamDocument),
    updated_at: winner.row?.updated_at ?? null,
    updated_by: winner.row?.updated_by ?? null,
  };
  return HttpResponse.json(
    { data: layout },
    {
      headers: {
        etag: etagOf(personal, team),
        'cache-control': 'private, no-store',
        ...(setCookie === undefined ? {} : { 'set-cookie': setCookie }),
      },
    },
  );
}

/** The `screen` path parameter when it is not shaped like a screen key (`422`), as FastAPI checks it. */
const screenKeyErrors = (screen: Param): ValidationItem[] =>
  typeof screen === 'string' && screen.length <= 64 && SCREEN_KEY.test(screen)
    ? []
    : [{ location: 'path', path: 'screen', code: 'string_pattern_mismatch', message: 'Not a screen key.' }];

const screenOf = (screen: Param): ScreenDefinition | undefined =>
  Object.values(SCREENS).find((definition) => definition.key === screen);

/** `If-Match` as the API reads it: a value, at most 128 characters. */
const ifMatchErrors = (ifMatch: string | null): ValidationItem[] =>
  ifMatch !== null && ifMatch.length > IF_MATCH_MAX
    ? [{ location: 'header', path: 'If-Match', code: 'string_too_long', message: 'At most 128 characters.' }]
    : [];

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

/** The `GET`: the layout the caller sees, with the `ETag` a save sends back. */
function read(request: Request, cookies: Cookies, workspaceId: Param, screenParam: Param): Answer {
  const caller = workspaceCaller(request, cookies, workspaceId, { permission: null });
  if (caller instanceof Response) return caller;
  const pathErrors = screenKeyErrors(screenParam);
  if (pathErrors.length > 0) return invalid(request, pathErrors);
  const screen = screenOf(screenParam);
  if (screen === undefined) return problem(request, 'not_found');
  return answer(screen, rowsOf(readState(cookies), caller.session.user.user_id, screen));
}

/** Both `PUT` routes: the personal layout of the caller, or the team default (`team`). */
async function save(
  request: Request,
  cookies: Cookies,
  workspaceId: Param,
  screenParam: Param,
  team: boolean,
): Promise<Answer> {
  const caller = workspaceCaller(request, cookies, workspaceId, { permission: team ? 'layouts:manage' : null });
  if (caller instanceof Response) return caller;
  const ifMatch = request.headers.get('if-match');
  const body = await readBody(request);
  const shape = body === undefined ? { errors: [bodyItem('', 'json_invalid', 'Invalid JSON.')] } : shapeErrors(body);
  const errors = [
    ...screenKeyErrors(screenParam),
    ...ifMatchErrors(ifMatch),
    ...('errors' in shape ? shape.errors : []),
  ];
  if (errors.length > 0 || !('document' in shape)) return invalid(request, errors);
  // An unknown screen is only found after the values are checked, as the API's service does
  const screen = screenOf(screenParam);
  if (screen === undefined) return problem(request, 'not_found');

  const document = compact(shape.document);
  if (new TextEncoder().encode(JSON.stringify(document)).length > DOCUMENT_MAX_BYTES) {
    return invalidField(request, '', 'too_large', 'A layout is at most 16 KB.');
  }
  const found = catalogErrors(screen, document);
  if (found.length > 0) return invalid(request, found);

  const userId = caller.session.user.user_id;
  const state = readState(cookies);
  const rows = rowsOf(state, userId, screen);
  const target = team ? rows.team : rows.personal;
  if (ifMatch === null && target !== undefined) {
    return problem(request, 'precondition_failed', { detail: 'This layout exists: send its ETag in If-Match.' });
  }
  if (ifMatch !== null && ifMatch.trim() !== etagOf(rows.personal, rows.team)) {
    return problem(request, 'precondition_failed', { detail: 'This layout was changed somewhere else.' });
  }
  // The same document again writes nothing, so the ETag stays
  if (target !== undefined && JSON.stringify(target.document) === JSON.stringify(document)) return answer(screen, rows);

  const now = Date.now();
  const row: Row = {
    id: target?.id ?? `layout-${String(now)}`,
    document,
    updated_at: new Date(now).toISOString(),
    updated_by: { user_id: userId, name: caller.session.user.name },
  };
  const next: State = team
    ? { ...state, team: { ...state.team, [screen.key]: row } }
    : { ...state, personal: { ...state.personal, [`${userId}|${screen.key}`]: row } };
  const cookie = jsonCookie(LAYOUTS_COOKIE, next);
  if (cookie === null) {
    return problem(request, 'mock_state_full', {
      detail: `What this browser saved no longer fits in the mock state. Expire the ${LAYOUTS_COOKIE} cookie to start again from the built-in layouts.`,
    });
  }
  return answer(screen, rowsOf(next, userId, screen), cookie);
}

/** Both `DELETE` routes: `204` also when nothing was there. */
function remove(
  request: Request,
  cookies: Cookies,
  workspaceId: Param,
  screenParam: Param,
  team: boolean,
): HttpResponse<null> | HttpResponse<Problem> {
  const caller = workspaceCaller(request, cookies, workspaceId, { permission: team ? 'layouts:manage' : null });
  if (caller instanceof Response) return caller;
  const pathErrors = screenKeyErrors(screenParam);
  if (pathErrors.length > 0) return invalid(request, pathErrors);
  const screen = screenOf(screenParam);
  if (screen === undefined) return problem(request, 'not_found');

  const userId = caller.session.user.user_id;
  const state = readState(cookies);
  const key = team ? screen.key : `${userId}|${screen.key}`;
  const rows = team ? state.team : state.personal;
  if (!(key in rows)) return noContent();
  const rest = Object.fromEntries(Object.entries(rows).filter(([name]) => name !== key));
  const cookie = jsonCookie(LAYOUTS_COOKIE, team ? { ...state, team: rest } : { ...state, personal: rest });
  return noContent(cookie === null ? {} : { 'set-cookie': cookie });
}

const W = '/api/v1/workspaces/{workspace_id}';

export const layoutHandlers: HttpHandler[] = [
  mock('get', `${W}/layouts/{screen}`, ({ request, cookies, params }) =>
    read(request, cookies, params.workspace_id, params.screen),
  ),
  mock('put', `${W}/me/layouts/{screen}`, ({ request, cookies, params }) =>
    save(request, cookies, params.workspace_id, params.screen, false),
  ),
  mock('delete', `${W}/me/layouts/{screen}`, ({ request, cookies, params }) =>
    remove(request, cookies, params.workspace_id, params.screen, false),
  ),
  mock('put', `${W}/layouts/{screen}/default`, ({ request, cookies, params }) =>
    save(request, cookies, params.workspace_id, params.screen, true),
  ),
  mock('delete', `${W}/layouts/{screen}/default`, ({ request, cookies, params }) =>
    remove(request, cookies, params.workspace_id, params.screen, true),
  ),
];
