import type { RegistrationErrors } from '../src/lib/registration';

/** An answer the API gives on purpose: a status, a short code and a message for people. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors?: RegistrationErrors,
    /** Seconds the browser should wait before trying again. */
    readonly retryAfter?: number,
    /** Extra facts for the dashboard, e.g. the registration that already holds an email. */
    readonly details?: Record<string, string>,
  ) {
    super(message);
  }
}
