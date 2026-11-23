import { isRecord } from './utils/is-record.js';

type QueryValue = string | number | boolean | undefined | null;

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export type TokenSessionResponse =
  | {
      source: 'api_token';
      team_id: string;
      token_type: string;
      scopes: string[];
      pro_pricing_enabled: boolean;
    };

export type PresscartApiCredential =
  | string
  | {
      bearerToken: string;
      oauthGrantId?: string;
    };

export class PresscartApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'PresscartApiError';
    this.status = status;
    this.body = body;
  }
}

export class PresscartApiClient {
  private readonly credential: {
    bearerToken: string;
    oauthGrantId?: string;
  };

  constructor(
    private readonly baseUrl: string,
    credential: PresscartApiCredential,
    private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
  ) {
    this.credential =
      typeof credential === 'string'
        ? { bearerToken: credential }
        : credential;
  }

  async get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(path, { method: 'GET' }, query);
  }

  async post<T>(path: string, body?: unknown, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(
      path,
      {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      },
      query
    );
  }

  async postForm<T>(
    path: string,
    formData: FormData,
    query?: Record<string, QueryValue>
  ): Promise<T> {
    return this.request<T>(
      path,
      {
        method: 'POST',
        body: formData,
      },
      query
    );
  }

  async put<T>(path: string, body?: unknown, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(
      path,
      {
        method: 'PUT',
        body: body ? JSON.stringify(body) : undefined,
      },
      query
    );
  }

  async patch<T>(path: string, body?: unknown, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(
      path,
      {
        method: 'PATCH',
        body: body ? JSON.stringify(body) : undefined,
      },
      query
    );
  }

  async delete<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' }, query);
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    query?: Record<string, QueryValue>
  ): Promise<T> {
    const url = new URL(path, ensureTrailingSlash(this.baseUrl));

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue;
        url.searchParams.set(key, String(value));
      }
    }

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(this.requestTimeoutMs),
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.credential.bearerToken}`,
          ...(this.credential.oauthGrantId
            ? { 'x-presscart-oauth-grant-id': this.credential.oauthGrantId }
            : {}),
          ...(init.body && !(init.body instanceof FormData)
            ? { 'Content-Type': 'application/json' }
            : {}),
        },
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new PresscartApiError('Presscart API request timed out', 504, null);
      }

      throw error;
    }

    const text = await response.text();
    const body = tryParseJson(text);

    if (!response.ok) {
      throw new PresscartApiError(
        `Presscart API request failed: ${response.status} ${response.statusText}${getClientErrorReason(response.status, body)}`,
        response.status,
        body
      );
    }

    return body as T;
  }
}

function isTimeoutError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

function ensureTrailingSlash(url: string) {
  return url.endsWith('/') ? url : `${url}/`;
}

const MAX_INVALID_FIELDS = 5;
const MAX_ERROR_REASON_LENGTH = 300;
const FIELD_NAME_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const ERROR_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const SENSITIVE_ERROR_TEXT =
  /(authorization\s*[:=]|bearer\s+[a-z0-9._\-]+|sk_(live|test)_[a-z0-9]+|eyj[a-z0-9_-]{20,}\.[a-z0-9_-]+\.|postgres(ql)?:\/\/|password\s*[:=]|api[_-]?key\s*[:=]|x-presscart-)/i;

function getClientErrorReason(status: number, body: unknown): string {
  if (status !== 400 && status !== 409) return '';

  const parts: string[] = [];
  const code = getSafeErrorCode(body);
  const meta = getSafeErrorMeta(body);
  const message = getSafeErrorMessage(body);
  const invalidFields = getInvalidFields(body);

  if (code) parts.push(`code ${code}`);
  if (meta) parts.push(meta);
  if (message) parts.push(message);
  if (invalidFields.length > 0) parts.push(`invalid fields: ${invalidFields.join(', ')}`);
  if (parts.length === 0) return '';

  const reason = parts.join('; ');
  const clipped =
    reason.length > MAX_ERROR_REASON_LENGTH
      ? `${reason.slice(0, MAX_ERROR_REASON_LENGTH - 3).trimEnd()}...`
      : reason;
  return `: ${clipped}`;
}

function readErrorField(body: unknown, key: string): unknown {
  if (!isRecord(body)) return undefined;
  if (isRecord(body.error) && body.error[key] !== undefined) return body.error[key];
  return body[key];
}

function getSafeErrorMessage(body: unknown): string | null {
  const message = readErrorField(body, 'message');
  if (typeof message !== 'string') return null;

  const trimmed = message.replace(/\s+/g, ' ').trim();
  if (!trimmed || SENSITIVE_ERROR_TEXT.test(trimmed)) return null;
  return trimmed;
}

function getSafeErrorCode(body: unknown): string | null {
  const code = readErrorField(body, 'code');
  return typeof code === 'string' && ERROR_CODE_PATTERN.test(code) ? code : null;
}

const ORDER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE_NUMBER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function getSafeErrorMeta(body: unknown): string | null {
  const meta = readErrorField(body, 'meta');
  if (!isRecord(meta)) return null;

  const parts: string[] = [];
  if (typeof meta.order_id === 'string' && ORDER_ID_PATTERN.test(meta.order_id)) {
    parts.push(`order_id ${meta.order_id}`);
  }
  if (
    typeof meta.reference_number === 'string' &&
    REFERENCE_NUMBER_PATTERN.test(meta.reference_number)
  ) {
    parts.push(`reference_number ${meta.reference_number}`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

function getInvalidFields(body: unknown): string[] {
  const issues = readErrorField(body, 'issues');
  if (!Array.isArray(issues)) return [];

  const fields = new Set<string>();
  for (const issue of issues) {
    const field = isRecord(issue) ? getFieldPath(issue.path) : null;
    if (field) fields.add(field);
    if (fields.size === MAX_INVALID_FIELDS) break;
  }
  return [...fields];
}

function getFieldPath(path: unknown): string | null {
  if (!Array.isArray(path) || path.length === 0) return null;

  const segments = path.map(segment =>
    (typeof segment === 'string' && FIELD_NAME_PATTERN.test(segment)) ||
    (typeof segment === 'number' && Number.isInteger(segment) && segment >= 0)
      ? String(segment)
      : null
  );
  return segments.every(segment => segment !== null) ? segments.join('.') : null;
}


function tryParseJson(text: string): unknown {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
