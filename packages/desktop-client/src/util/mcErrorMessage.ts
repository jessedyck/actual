// [fork:mc D-016] A readable message for a failed `send`. Handlers reject
// with a plain `{ type, message }` object rather than an Error, so
// `String(error)` would show "[object Object]".
import { t } from 'i18next';

export function mcErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message !== ''
  ) {
    return error.message;
  }
  return t('Something went wrong. Please try again.');
}
