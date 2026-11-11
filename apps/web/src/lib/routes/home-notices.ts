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

/**
 * The one way the Google callback reaches `/`: it could not tell which project the person was connecting for
 * (a wrong, used or expired state), so it sends `/?integration_error=invalid_state` (backend
 * `IntegrationService.complete`). Every other failure comes back to the project's own Integrations page.
 */
export const isIntegrationFailure = (value: string | null | undefined): value is 'invalid_state' =>
  value === 'invalid_state';
