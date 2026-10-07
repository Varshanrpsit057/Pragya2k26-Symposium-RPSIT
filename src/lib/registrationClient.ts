/**
 * Browser side of registration:
 *
 *   1. POST /api/uploads    the server hands out a private, short-lived S3 upload
 *   2. the payment screenshot goes straight to S3 (never through the API, so its size is no problem)
 *   3. POST /api/register   the details; the server checks them against the uploaded screenshot
 *
 * Then /api/status and /api/pass let the participant follow their registration with their
 * private key (the form's submission id). The pass is only ever handed out once approved.
 */
import { apiUrl } from './api';
import {
  ACCEPTED_SCREENSHOT_TYPES,
  RegistrationError,
  normalisePhone,
  resolvedDepartment,
  tidy,
  type RegistrationFailure,
  type RegistrationInput,
  type RegistrationPayload,
  type RegistrationStatus,
  type RegistrationSuccess,
  type StatusResult,
  type UploadTicket,
} from './registration';

export interface RegistrationResult {
  registrationId: string;
  /** ISO 8601, from the server. */
  registeredAt: string;
  status: RegistrationStatus;
  duplicate: boolean;
  /** The participant's private key for their status and pass; null for an earlier registration. */
  key: string | null;
}

interface RequestOptions {
  /** The API's address; null while online registration is switched off. */
  apiBase: string | null;
  fetchImpl?: typeof fetch;
  /** Gives up waiting for the server after this long. */
  timeoutMs?: number;
  /** Waits before trying again when the server is busy or unreachable; one retry per entry. */
  retryDelaysMs?: readonly number[];
}

interface SubmitOptions extends RequestOptions {
  submissionId: string;
}

export interface OwnRegistration {
  registrationId: string;
  key: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const UNREACHABLE = "Couldn't reach the registration server. Check your connection and try again.";
const BUSY = 'The registration server is very busy right now. Please wait a minute and try again. You will not be registered twice.';
const NOT_CONNECTED = 'Online registration is not connected yet. Please try again later or contact the organisers.';
const UPLOAD_FAILED = 'Your payment screenshot could not be uploaded. Check your connection and try again.';

/** A gateway answering for an API that is down or restarting (not our own JSON). */
const isGatewayError = (status: number) => status === 502 || status === 503 || status === 504;

/** The server's Retry-After (seconds), kept short so the visitor is never left waiting long. */
const retryAfterMs = (response: Response, fallback: number) => {
  const seconds = Number(response.headers.get('Retry-After'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 10_000) : fallback;
};

/**
 * POSTs JSON to the API and resolves with its answer once it succeeds. A busy server
 * (503), a gateway error or a dropped connection is retried; the server's own refusals
 * (duplicate, invalid field, not found) are not.
 */
async function postJson<T extends { success: true }>(
  url: string,
  body: unknown,
  { fetchImpl = fetch, timeoutMs = 60_000, retryDelaysMs = [2_000, 5_000] }: Omit<RequestOptions, 'apiBase'>,
): Promise<T> {
  const text = JSON.stringify(body);
  for (let attempt = 0; ; attempt += 1) {
    const retryDelay = retryDelaysMs[attempt];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text,
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        throw new RegistrationError(
          'The server is taking longer than usual. Please press Submit again in a moment — you will not be registered twice.',
        );
      }
      if (retryDelay !== undefined) {
        await sleep(retryDelay);
        continue;
      }
      throw new RegistrationError(UNREACHABLE);
    }

    const data = (await response.json().catch(() => null)) as T | RegistrationFailure | null;
    clearTimeout(timer);

    if (response.ok && data?.success) return data as T;
    // Busy or starting up: worth another try. Not set up at all: say so straight away.
    if (response.status === 503 && retryDelay !== undefined && data?.success === false && data.code !== 'NOT_CONFIGURED') {
      await sleep(retryAfterMs(response, retryDelay));
      continue;
    }
    // A gateway in front of the API answered instead of it: down, restarting or throttling.
    const fromGateway = typeof data?.success !== 'boolean';
    if (fromGateway && (isGatewayError(response.status) || response.status === 429)) {
      if (retryDelay !== undefined) {
        await sleep(retryAfterMs(response, retryDelay));
        continue;
      }
      throw new RegistrationError(response.status === 429 ? BUSY : UNREACHABLE);
    }

    const failure = data && !data.success ? data : null;
    throw new RegistrationError(failure?.error || 'The registration could not be saved. Please try again.', {
      code: failure?.code,
      fieldErrors: failure?.fieldErrors,
    });
  }
}

/** Sends the screenshot to the private S3 upload the server handed out. */
async function uploadScreenshot(
  ticket: UploadTicket,
  file: Blob,
  { fetchImpl = fetch, retryDelaysMs = [2_000, 5_000] }: Omit<RequestOptions, 'apiBase'>,
) {
  for (let attempt = 0; ; attempt += 1) {
    const form = new FormData();
    for (const [name, value] of Object.entries(ticket.fields)) form.append(name, value);
    // S3 reads the fields first: the file goes last.
    form.append('file', file);
    let refused = false;
    try {
      const response = await fetchImpl(ticket.url, { method: 'POST', body: form });
      if (response.ok) return;
      refused = response.status < 500;
    } catch {
      // A dropped connection: try again below.
    }
    if (refused) {
      const message = 'Your payment screenshot could not be uploaded. Please choose a PNG or JPG image of 5 MB or less.';
      throw new RegistrationError(message, { fieldErrors: { screenshot: message } });
    }
    const delay = retryDelaysMs[attempt];
    if (delay === undefined) throw new RegistrationError(UPLOAD_FAILED);
    await sleep(delay);
  }
}

/**
 * Sends a registration and resolves once the server has stored it (as PENDING, until an
 * organiser checks the payment). Retries use the same submission id, which the server
 * uses to make sure nobody is registered twice.
 */
export async function submitRegistration(
  input: RegistrationInput,
  { apiBase, submissionId, ...options }: SubmitOptions,
): Promise<RegistrationResult> {
  if (apiBase === null) throw new RegistrationError(NOT_CONNECTED);
  if (!input.screenshot) {
    throw new RegistrationError('Upload a screenshot of your payment.', {
      fieldErrors: { screenshot: 'Upload a screenshot of your payment.' },
    });
  }

  const screenshot = await prepareScreenshot(input.screenshot);
  if (!(ACCEPTED_SCREENSHOT_TYPES as readonly string[]).includes(screenshot.type)) {
    const message = 'Please upload the screenshot as a PNG or JPG image.';
    throw new RegistrationError(message, { fieldErrors: { screenshot: message } });
  }

  const ticket = await postJson<{ success: true } & UploadTicket>(
    apiUrl(apiBase, '/api/uploads'),
    { contentType: screenshot.type, size: screenshot.blob.size },
    options,
  );
  await uploadScreenshot(ticket, screenshot.blob, options);

  const payload: RegistrationPayload = {
    submissionId,
    participant: {
      name: tidy(input.name),
      department: resolvedDepartment(input),
      college: tidy(input.college),
      year: input.year,
      phone: normalisePhone(input.phone),
      email: input.email.trim(),
    },
    events: [...new Set(input.events)],
    transactionId: input.transactionId.trim(),
    upload: { id: ticket.uploadId },
  };
  const data = await postJson<RegistrationSuccess>(apiUrl(apiBase, '/api/register'), payload, { timeoutMs: 120_000, ...options });
  return {
    registrationId: data.registrationId,
    registeredAt: data.registeredAt,
    status: data.status,
    duplicate: Boolean(data.duplicate),
    key: data.duplicate ? null : submissionId,
  };
}

/** Where a participant's own registration stands. */
export async function checkStatus(own: OwnRegistration, { apiBase, ...options }: RequestOptions): Promise<StatusResult> {
  if (apiBase === null) throw new RegistrationError(NOT_CONNECTED);
  return postJson<StatusResult>(apiUrl(apiBase, '/api/status'), own, options);
}

/** A short-lived download link for the participant's pass; the server refuses it until approval. */
export async function passDownloadUrl(own: OwnRegistration, { apiBase, ...options }: RequestOptions): Promise<string> {
  if (apiBase === null) throw new RegistrationError(NOT_CONNECTED);
  const { url } = await postJson<{ success: true; url: string }>(apiUrl(apiBase, '/api/pass'), own, options);
  return url;
}

/**
 * Shrinks a phone screenshot to at most 1600px on its longest side as JPEG, so uploads
 * stay small on mobile data. Falls back to the original file if the browser cannot.
 */
export async function prepareScreenshot(file: File, maxSide = 1600): Promise<{ name: string; type: string; blob: Blob }> {
  const name = file.name.replace(/\.[^.]+$/, '') || 'payment';
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('could not encode');
    return { name: `${name}.jpg`, type: 'image/jpeg', blob };
  } catch {
    return { name: file.name, type: file.type, blob: file };
  }
}
