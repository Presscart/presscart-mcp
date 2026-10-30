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
      // Names only the request fields that failed validation, so the agent can fix its input without seeing backend text.
      const invalidFields = isRejectedRequest(response.status) ? getInvalidFields(body) : [];
      const reason = invalidFields.length > 0 ? `: invalid fields: ${invalidFields.join(', ')}` : '';
      throw new PresscartApiError(
        `Presscart API request failed: ${response.status} ${response.statusText}${reason}`,
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
const FIELD_NAME_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

function isRejectedRequest(status: number) {
  return status >= 400 && status < 500 && status !== 401 && status !== 403;
}

function getInvalidFields(body: unknown): string[] {
  const issues = isRecord(body) && isRecord(body.error) ? body.error.issues : undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tryParseJson(text: string): unknown {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
