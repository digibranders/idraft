/**
 * The generated component schemas the app names, under their API names. Import from here, not from
 * ./schema, so a rename in the OpenAPI document breaks one file.
 */
import type { components } from './schema';

type Schemas = components['schemas'];

export type Me = Schemas['Me'];
export type MeMembership = Schemas['MeMembership'];
export type Role = Schemas['Role'];
export type Problem = Schemas['Problem'];
export type ValidationItem = Schemas['ValidationItem'];
export type SessionItem = Schemas['SessionItem'];

/** Runtime lists from the OpenAPI enums: a form checks a slug against them before it asks the API. */
export { reservedProjectSlugValues, reservedWorkspaceSlugValues, roleValues } from './schema';
