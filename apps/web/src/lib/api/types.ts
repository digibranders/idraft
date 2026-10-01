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
export type Project = Schemas['Project'];
export type Workspace = Schemas['Workspace'];
export type Member = Schemas['Member'];
export type Invitation = Schemas['Invitation'];
export type DomainRef = Schemas['DomainRef'];
export type Entity = Schemas['Entity'];
export type EntityDetail = Schemas['EntityDetail'];
export type EntityRef = Schemas['EntityRef'];
export type Alias = Schemas['Alias'];
export type AliasInput = Schemas['AliasInput'];
export type EntityDomain = Schemas['EntityDomain'];
export type ProjectEntity = Schemas['ProjectEntity'];
export type ProjectDomain = Schemas['ProjectDomain'];
export type Location = Schemas['Location'];
export type Vocabulary = Schemas['Vocabulary'];
export type Term = Schemas['Term'];
export type TermNode = Schemas['TermNode'];
export type DomainCategory = Schemas['DomainCategory'];
export type AliasTestResult = Schemas['AliasTestResult'];

/** Runtime lists from the OpenAPI enums: a form checks a slug against them before it asks the API. */
export { reservedProjectSlugValues, reservedWorkspaceSlugValues, roleValues } from './schema';
