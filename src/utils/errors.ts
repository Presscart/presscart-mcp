import { PresscartApiError } from '../api.js';

export function formatServerError(error: unknown) {
  if (error instanceof PresscartApiError) {
    return `${error.message}\n${JSON.stringify(error.body, null, 2)}`;
  }

  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}
