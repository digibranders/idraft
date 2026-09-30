/** The notices the sign-in page shows for `?notice=`, and nothing else a link could put there. */
export const SIGN_IN_NOTICES = ['passwordReset', 'accountCreated', 'sessionExpired'] as const;
export type SignInNotice = (typeof SIGN_IN_NOTICES)[number];

export const isSignInNotice = (value: string | null): value is SignInNotice =>
  SIGN_IN_NOTICES.some((notice) => notice === value);
