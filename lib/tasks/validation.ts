export const TITLE_REQUIRED = "Title is required" as const;
export const TITLE_TOO_LONG = "Title must be at most 200 characters" as const;
export const TITLE_MAX = 200;

export type TitleValidationError = typeof TITLE_REQUIRED | typeof TITLE_TOO_LONG;

/** Returns the fixed error text for an invalid title, or null when valid. */
export function validateTitle(title: string): TitleValidationError | null {
  if (title.trim() === "") return TITLE_REQUIRED;
  if ([...title].length > TITLE_MAX) return TITLE_TOO_LONG;
  return null;
}
