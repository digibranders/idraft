/** The fields of a project that its forms share (19 section 3.3, `ProjectCreate` and `ProjectUpdate`). */

/** The API's limit on a project name. */
export const MAX_PROJECT_NAME_LENGTH = 120;

/** The weekdays as the API numbers them: 0 is Sunday (backend `schemas/projects.py`). */
export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

/** The API's default deep check day: Monday. */
export const DEFAULT_DEEP_CHECK_WEEKDAY = 1;

/** The select's value for "no default language", which the API takes as `null`. */
export const NO_LANGUAGE = 'none';
