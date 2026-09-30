/**
 * Why an invitation could not be accepted after sign-in. The sign-in step sends the person to
 * `/?invitation=<reason>`, and the home page says it (it is the one page both sides know).
 */
export const INVITATION_FAILURES = ['expired', 'invalid', 'suspended', 'unverified', 'failed'] as const;
export type InvitationFailure = (typeof INVITATION_FAILURES)[number];

export const isInvitationFailure = (value: string | null | undefined): value is InvitationFailure =>
  INVITATION_FAILURES.some((failure) => failure === value);

/** The home page, saying why the invitation could not be accepted. */
export const homeWithInvitationFailure = (failure: InvitationFailure): string => `/?invitation=${failure}`;
