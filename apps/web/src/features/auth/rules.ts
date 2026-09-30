/** The limits the API applies to what the auth forms send (19 section 3.1). */

/** A new password has at least this many characters (`weak_password` with `too_short` below it). */
export const MIN_PASSWORD_LENGTH = 12;
/** A name has at most this many characters. */
export const MAX_NAME_LENGTH = 120;
/** A recovery code is short; anything longer was pasted from somewhere else. */
export const MAX_RECOVERY_CODE_LENGTH = 64;
/** An authenticator code has 6 digits. */
export const CODE_LENGTH = 6;
