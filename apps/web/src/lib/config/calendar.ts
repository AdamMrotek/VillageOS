/**
 * Shared calendar configuration — the static values that drive how dates are
 * laid out and formatted. Keeping these here gives a single source of truth so
 * the labels/format don't drift between calendar components.
 */

/** Locale used for all calendar date formatting. */
export const CALENDAR_LOCALE = "en-GB";

/** Single-letter weekday headers, Monday-first (M T W T F S S). */
export const WEEKDAY_LABELS_LETTER = ["M", "T", "W", "T", "F", "S", "S"];

/** Days in a week. */
export const DAYS_PER_WEEK = 7;

/** Weeks rendered in the month grid. */
export const MONTH_GRID_WEEKS = 6;

/** Total day cells in the month grid (6 weeks × 7 days). */
export const MONTH_GRID_DAYS = MONTH_GRID_WEEKS * DAYS_PER_WEEK;

/** Max event-type dots rendered under a single day cell. */
export const MAX_DOTS_PER_DAY = 3;

/** Intl options for the month/year header label, e.g. "May 2026". */
export const MONTH_LABEL_FORMAT: Intl.DateTimeFormatOptions = {
  month: "long",
  year: "numeric",
};

/** Intl options for a day + month label, e.g. "30 May". */
export const DAY_MONTH_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "long",
};

/** Intl options for an abbreviated weekday, e.g. "Sat". */
export const WEEKDAY_SHORT_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
};
