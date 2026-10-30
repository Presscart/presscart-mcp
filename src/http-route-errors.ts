import type { ErrorRequestHandler, Request } from 'express';

import { PresscartApiError } from './api.js';
import { OAuthSessionAuthError } from './oauth-http.js';
import { formatServerError } from './utils/errors.js';
import { isRecord } from './utils/is-record.js';

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
  resourceMetadataUrl?: string;
};

export function createHttpRouteErrorHandler(
  options: HttpRouteErrorHandlerOptions
): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    const statusCode = resolveErrorStatus(error);
    options.logRouteError(req, statusCode, error);
    const exposeMessage = error instanceof HttpError || error instanceof OAuthSessionAuthError;
    if (error instanceof OAuthSessionAuthError && options.resourceMetadataUrl !== undefined) {
      res.setHeader(
        'WWW-Authenticate',
        `Bearer error="invalid_token", error_description="${error.message}", resource_metadata="${options.resourceMetadataUrl}"`,
      );
    }

    res.status(statusCode).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: isBodyTooLarge(error)
          ? BODY_TOO_LARGE_MESSAGE
          : formatServerError(error, { exposeMessage }),
      },
      id: null,
    });
  };
}

// The SDK app parses JSON with express.json() defaults, which rejects bodies over 100 KB with this type.
const BODY_TOO_LARGE_MESSAGE =
  'The request is larger than the 100 KB the MCP connection accepts. For a large file, ask the user to upload it in the Presscart dashboard instead.';

function isBodyTooLarge(error: unknown) {
  return isRecord(error) && error.type === 'entity.too.large';
}

function resolveErrorStatus(error: unknown) {
  if (error instanceof HttpError) return error.statusCode;
  if (isBodyTooLarge(error)) return 413;
  if (error instanceof OAuthSessionAuthError) return error.statusCode;
  if (error instanceof PresscartApiError && (error.status === 401 || error.status === 403)) {
    return 401;
  }
  return 500;
}
