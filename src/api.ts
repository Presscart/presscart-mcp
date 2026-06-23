type QueryValue = string | number | boolean | undefined | null;

export type TokenSessionResponse =
  | {
      source: 'api_token';
      team_id: string;
      token_type: string;
      scopes: string[];
      pro_pricing_enabled: boolean;
    }
  | {
      source: 'oauth';
      oauth_client_id: string;
      oauth_grant_id: string;
      scopes: string[];
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
  constructor(
    private readonly baseUrl: string,
    private readonly apiToken: string
  ) {}

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

    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.apiToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });

    const text = await response.text();
    const body = tryParseJson(text);

    if (!response.ok) {
      throw new PresscartApiError(
        `Presscart API request failed: ${response.status} ${response.statusText}`,
        response.status,
        body
      );
    }

    return body as T;
  }
}

function ensureTrailingSlash(url: string) {
  return url.endsWith('/') ? url : `${url}/`;
}

function tryParseJson(text: string): unknown {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
