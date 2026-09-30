import type { Role } from '@/lib/api/types';

/**
 * The development fixtures: one workspace, Digibranders, with five projects and one user per role. Every
 * mock handler and test reads them from here, so a screen shows the same people and projects wherever it
 * is opened. The values are test values for this app only.
 */

/** The password of every fixture user. */
export const MOCK_PASSWORD = 'correct-horse-battery';
/** The second-factor code that the fixture users with two-factor on accept. */
export const MOCK_TOTP_CODE = '246810';
/** A recovery code those users accept instead. */
export const MOCK_RECOVERY_CODE = 'ABCD-EFGH-JKMN';
/** Emailed tokens the handlers accept: a password reset, an email verification and an invitation. */
export const MOCK_TOKENS = {
  reset: 'mock-reset-token',
  verifyEmail: 'mock-verify-token',
  invitation: 'mock-invitation-token',
} as const;

export const MOCK_WORKSPACE = {
  workspace_id: '0192d1a8-7e8b-7c3a-9f3e-3b5a2c1d4e5f',
  name: 'Digibranders',
  slug: 'digibranders',
} as const;

export interface MockProjectSeed {
  readonly project_id: string;
  readonly name: string;
  readonly slug: string;
  readonly host: string;
  readonly timezone: string;
}

export const MOCK_PROJECTS: readonly MockProjectSeed[] = [
  {
    project_id: '0192d1a8-9a01-7b44-8c2d-1f0e9d8c7b01',
    name: 'Fynix',
    slug: 'fynix',
    host: 'fynix.digital',
    timezone: 'Europe/Berlin',
  },
  {
    project_id: '0192d1a8-9a01-7b44-8c2d-1f0e9d8c7b02',
    name: 'Cleanstart',
    slug: 'cleanstart',
    host: 'cleanstart.com',
    timezone: 'America/New_York',
  },
  {
    project_id: '0192d1a8-9a01-7b44-8c2d-1f0e9d8c7b03',
    name: 'Eventus Security',
    slug: 'eventus-security',
    host: 'eventussecurity.com',
    timezone: 'Asia/Kolkata',
  },
  {
    project_id: '0192d1a8-9a01-7b44-8c2d-1f0e9d8c7b04',
    name: 'Oyechats',
    slug: 'oyechats',
    host: 'oyechats.com',
    timezone: 'Asia/Kolkata',
  },
  {
    project_id: '0192d1a8-9a01-7b44-8c2d-1f0e9d8c7b05',
    name: 'Firstfold',
    slug: 'firstfold',
    host: 'firstfold.io',
    timezone: 'Europe/London',
  },
];

export interface MockUserSeed {
  readonly user_id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly two_factor_enabled: boolean;
  readonly is_platform_operator: boolean;
  /** `null` is every project; a list limits the member to those projects. */
  readonly project_ids: readonly string[] | null;
}

const [fynix, cleanstart] = MOCK_PROJECTS;

export const MOCK_USERS: readonly MockUserSeed[] = [
  {
    user_id: '0192d1a8-5b10-7c01-9a11-000000000001',
    name: 'Ana Brandt',
    email: 'ana@digibranders.test',
    role: 'owner',
    two_factor_enabled: true,
    is_platform_operator: true,
    project_ids: null,
  },
  {
    user_id: '0192d1a8-5b10-7c01-9a11-000000000002',
    name: 'Tomás Rivera',
    email: 'tomas@digibranders.test',
    role: 'admin',
    two_factor_enabled: false,
    is_platform_operator: false,
    project_ids: null,
  },
  {
    user_id: '0192d1a8-5b10-7c01-9a11-000000000003',
    name: 'Priya Natarajan',
    email: 'priya@digibranders.test',
    role: 'editor',
    two_factor_enabled: false,
    is_platform_operator: false,
    project_ids: null,
  },
  {
    user_id: '0192d1a8-5b10-7c01-9a11-000000000004',
    name: 'Jonas Lindqvist',
    email: 'jonas@digibranders.test',
    role: 'analyst',
    two_factor_enabled: false,
    is_platform_operator: false,
    project_ids: [fynix?.project_id ?? '', cleanstart?.project_id ?? ''],
  },
  {
    user_id: '0192d1a8-5b10-7c01-9a11-000000000005',
    name: 'Mei Chen',
    email: 'mei@digibranders.test',
    role: 'viewer',
    two_factor_enabled: false,
    is_platform_operator: false,
    project_ids: null,
  },
  {
    user_id: '0192d1a8-5b10-7c01-9a11-000000000006',
    name: 'Kwame Mensah',
    email: 'kwame@digibranders.test',
    role: 'billing',
    two_factor_enabled: false,
    is_platform_operator: false,
    project_ids: null,
  },
];

/**
 * The person the fixture invitation is for. They have no account until they register with the invitation
 * token; they can then sign in with the password they chose, in the same browser session.
 */
export const MOCK_INVITED_USER: MockUserSeed = {
  user_id: '0192d1a8-5b10-7c01-9a11-0000000000ff',
  name: 'Lena Vogel',
  email: 'lena@digibranders.test',
  role: 'editor',
  two_factor_enabled: false,
  is_platform_operator: false,
  project_ids: null,
};

/** The fixture user with `role`. Every role has one. */
export function mockUser(role: Role): MockUserSeed {
  const user = MOCK_USERS.find((candidate) => candidate.role === role);
  if (!user) throw new Error(`No fixture user has the role ${role}`);
  return user;
}

/** The moment the fixtures were created, so dates in mocks do not change from run to run. */
export const MOCK_CREATED_AT = '2026-06-01T09:00:00Z';
