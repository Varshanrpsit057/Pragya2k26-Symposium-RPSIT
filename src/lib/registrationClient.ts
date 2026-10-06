/** Browser side of registration: prepares the form and sends it to the registration server. */
import {
  ACCEPTED_SCREENSHOT_TYPES,
  RegistrationError,
  normalisePhone,
  resolvedDepartment,
  tidy,
  type EmailStatus,
  type RegistrationFailure,
  type RegistrationInput,
  type RegistrationPayload,
  type RegistrationSuccess,
  type ScreenshotUpload,
} from './registration';

export interface RegistrationResult {
  registrationId: string;
  /** ISO 8601, from the server. */
  registeredAt: string;
  emailStatus: EmailStatus;
  duplicate: boolean;
}

interface SubmitOptions {
  endpoint: string | null;
  submissionId: string;
  fetchImpl?: typeof fetch;
  /** Gives up waiting for the server after this long. */
  timeoutMs?: number;
  /** Waits before trying again when the server is busy or unreachable; one retry per entry. */
  retryDelaysMs?: readonly number[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const UNREACHABLE = "Couldn't reach the registration server. Check your connection and try again.";

/** A gateway answering for a registration server that is down or restarting (not our own JSON). */
const isGatewayError = (status: number) => status === 502 || status === 503 || status === 504;

/** The server's Retry-After (seconds), kept short so the visitor is never left waiting long. */
const retryAfterMs = (response: Response, fallback: number) => {
  const seconds = Number(response.headers.get('Retry-After'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 10_000) : fallback;
};

/**
 * Sends a registration to the registration server and resolves only once the server has
 * confirmed it is stored in Google Drive and Google Sheets.
 *
 * A busy server (503) or a dropped connection is retried automatically with the same
 * submission id, which the server uses to make sure nobody is registered twice.
 */
export async function submitRegistration(
  input: RegistrationInput,
  { endpoint, submissionId, fetchImpl = fetch, timeoutMs = 120_000, retryDelaysMs = [2_000, 5_000] }: SubmitOptions,
): Promise<RegistrationResult> {
  if (!endpoint) {
    throw new RegistrationError(
      'Online registration is not connected yet. Please try again later or contact the organisers.',
    );
  }
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
    screenshot,
  };
  const body = JSON.stringify(payload);

  for (let attempt = 0; ; attempt += 1) {
    const retryDelay = retryDelaysMs[attempt];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
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

    const data = (await response.json().catch(() => null)) as RegistrationSuccess | RegistrationFailure | null;
    clearTimeout(timer);

    if (response.ok && data?.success && data.registrationId) {
      return {
        registrationId: data.registrationId,
        registeredAt: data.registeredAt,
        emailStatus: data.emailStatus,
        duplicate: Boolean(data.duplicate),
      };
    }
    // Busy or starting up: worth another try. Not set up at all: say so straight away.
    if (response.status === 503 && retryDelay !== undefined && data?.success === false && data.code !== 'NOT_CONFIGURED') {
      await sleep(retryAfterMs(response, retryDelay));
      continue;
    }
    // A proxy in front of the server answered instead of it: the server is down or restarting.
    if (!data && isGatewayError(response.status)) {
      if (retryDelay !== undefined) {
        await sleep(retryDelay);
        continue;
      }
      throw new RegistrationError(UNREACHABLE);
    }

    const failure = data && !data.success ? data : null;
    throw new RegistrationError(failure?.error || 'The registration could not be saved. Please try again.', {
      code: failure?.code,
      fieldErrors: failure?.fieldErrors,
    });
  }
}

/**
 * Shrinks a phone screenshot to at most 1600px on its longest side as JPEG, so uploads
 * stay small on mobile data. Falls back to the original file if the browser cannot.
 */
export async function prepareScreenshot(file: File, maxSide = 1600): Promise<ScreenshotUpload> {
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
    return { name: `${name}.jpg`, type: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.85) };
  } catch {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    return { name: file.name, type: file.type, data };
  }
}
