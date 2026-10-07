/**
 * Calls Google's REST APIs (Sheets, Drive, Gmail) with an OAuth access token from the
 * saved refresh token. Rate limits (429), temporary errors (5xx) and dropped connections
 * are retried with exponential backoff, a bounded number of times.
 */

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export class GoogleApiError extends Error {
  constructor(
    message: string,
    /** HTTP status; 0 when no response arrived. */
    readonly status: number,
    readonly reason: string | undefined,
    /** Worth trying again (rate limit, temporary error, dropped connection). */
    readonly retryable: boolean,
    /** Google may have done the request even though it failed (5xx, dropped connection). */
    readonly ambiguous: boolean,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

export interface RequestOptions {
  /** Used in error messages and logs, e.g. 'Drive upload'. */
  label: string;
  /**
   * Safe to repeat even if the first attempt may have gone through (reads, updates of a
   * fixed range, uploads whose duplicates are cleaned up). Appends and email sends are not.
   */
  idempotent: boolean;
  /** 'json' parses the answer; 'none' ignores it. */
  parse?: 'json' | 'none';
  timeoutMs?: number;
  attempts?: number;
}

interface ClientOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

/** Google's "slow down" answers that arrive as 403 rather than 429. */
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'RESOURCE_EXHAUSTED']);

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class GoogleClient {
  private token: { value: string; expiresAt: number } | null = null;
  private refreshing: Promise<string> | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(
    private readonly credentials: GoogleCredentials,
    options: ClientOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  /** A valid access token, refreshed a minute before it expires (one refresh at a time). */
  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refresh(): Promise<string> {
    let lastError: GoogleApiError | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: this.credentials.clientId,
            client_secret: this.credentials.clientSecret,
            refresh_token: this.credentials.refreshToken,
            grant_type: 'refresh_token',
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        lastError = new GoogleApiError('Google sign-in: network error', 0, 'network', true, false);
        await this.sleep(this.backoff(attempt));
        continue;
      }
      const body = (await response.json().catch(() => ({}))) as {
        access_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      };
      if (response.ok && body.access_token) {
        this.token = { value: body.access_token, expiresAt: this.now() + (body.expires_in ?? 3600) * 1000 };
        return body.access_token;
      }
      if (body.error === 'invalid_grant' || body.error === 'invalid_client' || body.error === 'unauthorized_client') {
        throw new GoogleApiError(
          `Google sign-in no longer works (${body.error}): run npm run google:auth and put the new token in the GOOGLE_REFRESH_TOKEN secret`,
          401,
          body.error,
          false,
          false,
        );
      }
      lastError = new GoogleApiError(
        `Google sign-in: ${body.error_description || body.error || response.statusText}`,
        response.status,
        body.error,
        response.status === 429 || response.status >= 500,
        false,
      );
      if (!lastError.retryable) throw lastError;
      await this.sleep(this.backoff(attempt));
    }
    throw lastError ?? new GoogleApiError('Google sign-in failed', 0, undefined, false, false);
  }

  /** ~0.5 s, 1 s, 2 s, 4 s ... with jitter so parallel retries spread out; never above 8 s. */
  private backoff(attempt: number): number {
    const base = Math.min(8_000, 500 * 2 ** attempt);
    return Math.round(base * (0.5 + this.random() * 0.5));
  }

  async request<T = unknown>(url: string, init: RequestInit, options: RequestOptions): Promise<T> {
    const { label, idempotent, parse = 'json', timeoutMs = 30_000, attempts = 4 } = options;
    let renewedToken = false;

    for (let attempt = 0; ; attempt += 1) {
      const token = await this.accessToken();
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${token}`);

      let error: GoogleApiError;
      try {
        const response = await this.fetchImpl(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
        if (response.ok) {
          if (parse === 'none') {
            await response.body?.cancel();
            return undefined as T;
          }
          return (await response.json()) as T;
        }
        // An expired or revoked token: get a fresh one once, without using up an attempt.
        if (response.status === 401 && !renewedToken) {
          renewedToken = true;
          this.token = null;
          attempt -= 1;
          continue;
        }
        error = await toApiError(label, response);
      } catch (thrown) {
        if (thrown instanceof GoogleApiError) throw thrown;
        const timedOut = thrown instanceof Error && (thrown.name === 'TimeoutError' || thrown.name === 'AbortError');
        error = new GoogleApiError(`${label}: ${timedOut ? 'timed out' : 'network error'}`, 0, timedOut ? 'timeout' : 'network', true, true);
      }

      const lastAttempt = attempt + 1 >= attempts;
      if (!error.retryable || lastAttempt || (error.ambiguous && !idempotent)) throw error;
      await this.sleep(this.backoff(attempt));
    }
  }
}

async function toApiError(label: string, response: Response): Promise<GoogleApiError> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string; status?: string; errors?: { reason?: string }[] };
  } | null;
  const status = response.status;
  const reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status;
  const message = body?.error?.message ?? response.statusText;
  const rateLimited = status === 429 || (status === 403 && reason !== undefined && RATE_LIMIT_REASONS.has(reason));
  const retryable = rateLimited || status >= 500;
  return new GoogleApiError(`${label}: ${message}`, status, reason, retryable, status >= 500);
}

/** A short, safe description for logs and the sheet's Notes column (never tokens or headers). */
export function describeError(error: unknown): string {
  if (error instanceof GoogleApiError) return `${error.message}${error.status ? ` (HTTP ${error.status})` : ''}`.slice(0, 300);
  if (error instanceof Error) return error.message.slice(0, 300);
  return 'Unknown error';
}
