import type { ErrorRequestHandler, Request } from 'express';

import { PresscartApiError } from './api.js';
import { OAuthSessionAuthError } from './oauth-http.js';
import { formatServerError } from './utils/errors.js';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export type HttpRouteErrorHandlerOptions = {
  logRouteError: (req: Request, statusCode: number, error: unknown) => void;
};

export function createHttpRouteErrorHandler(
  options: HttpRouteErrorHandlerOptions
): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    const statusCode = resolveErrorStatus(error);
    options.logRouteError(req, statusCode, error);
    const exposeMessage = error instanceof HttpError || error instanceof OAuthSessionAuthError;

    res.status(statusCode).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: formatServerError(error, { exposeMessage }),
      },
      id: null,
    });
  };
}

function resolveErrorStatus(error: unknown) {
  if (error instanceof HttpError) return error.statusCode;
  if (error instanceof OAuthSessionAuthError) return error.statusCode;
  if (error instanceof PresscartApiError && (error.status === 401 || error.status === 403)) {
    return 401;
  }
  return 500;
}
