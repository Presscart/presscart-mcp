import { PresscartApiError } from '../api.js';

export function formatServerError(error: unknown, options: { exposeMessage?: boolean } = {}) {
  if (error instanceof PresscartApiError) {
    if (error.status === 401 || error.status === 403) return 'Unauthorized';
    if (error.status === 404) return 'Presscart API resource not found';
    if (error.status === 504) return 'Presscart API request timed out';
    if (error.status >= 500) return 'Presscart API is unavailable';
    return error.message;
  }

  if (options.exposeMessage && error instanceof Error) {
    return error.message;
  }

  return 'Internal server error';
}
