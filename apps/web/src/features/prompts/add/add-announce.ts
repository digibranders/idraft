/**
 * The announcer keys of the Add prompts dialog. Messages about one thing share a key, so the announcer speaks the
 * newest once (20-accessibility.md section 10.1), and none of these has a live region of its own.
 */
export const QUOTA_KEY = 'add-prompts-quota';
export const ERRORS_KEY = 'add-prompts-errors';
export const WARNINGS_KEY = 'add-prompts-warnings';
export const RESULT_KEY = 'add-prompts-result';
/** The counts of the check list: how many lines are new, tracked, repeated or cannot be added. */
export const CHECKS_KEY = 'add-prompts-checks';

/** Typing and the lint settle before the counts and the problems are spoken. */
export const ANNOUNCE_DELAY_MS = 800;
