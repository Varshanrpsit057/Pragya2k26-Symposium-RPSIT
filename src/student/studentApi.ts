/**
 * The student page's calls: whether it is on, the participant's view, and a link to their
 * pass. One small request each; the view is asked again every 30 s only while a desk student
 * waits for their GPay payment to be approved (for 10 minutes at most).
 */
import { API_BASE, apiUrl } from '../lib/api';
import type { UploadTicket } from '../lib/registration';
import type { StudentCredentials, StudentPortalState, StudentView } from '../lib/student';

export class StudentApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;

async function request<T>(path: `/api/${string}`, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(apiUrl(API_BASE, path), {
      signal: controller.signal,
      ...(body !== undefined && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new StudentApiError("Couldn't reach the server. Check your connection and try again.", 'UNREACHABLE', 0);
  } finally {
    clearTimeout(timer);
  }
  const data = (await response.json().catch(() => null)) as ({ success?: boolean; error?: string; code?: string } & T) | null;
  if (!response.ok || !data?.success) {
    throw new StudentApiError(data?.error ?? 'Something went wrong. Please try again in a minute.', data?.code ?? 'ERROR', response.status);
  }
  return data;
}

export const portalState = () => request<StudentPortalState>('/api/student/portal');
export const signIn = (credentials: StudentCredentials) => request<StudentView>('/api/student', credentials);
/**
 * A GPay screenshot of a payment made at the desk or a venue: a private upload to S3, then
 * attached to the student's record (what it was for, and the transaction ID if given).
 */
export async function uploadProof(credentials: StudentCredentials, file: File, kind: string, transactionId: string): Promise<StudentView> {
  const ticket = await request<UploadTicket>('/api/student/upload', { ...credentials, contentType: file.type, size: file.size });
  const form = new FormData();
  for (const [name, value] of Object.entries(ticket.fields)) form.append(name, value);
  // S3 reads the fields first: the file goes last.
  form.append('file', file);
  let uploaded: Response;
  try {
    uploaded = await fetch(ticket.url, { method: 'POST', body: form });
  } catch {
    throw new StudentApiError("Couldn't upload the screenshot. Check your connection and try again.", 'UNREACHABLE', 0);
  }
  if (!uploaded.ok) throw new StudentApiError('The screenshot could not be uploaded. Choose a PNG or JPG image of 5 MB or less.', 'UPLOAD_FAILED', uploaded.status);
  return request<StudentView>('/api/student/proof', { ...credentials, uploadId: ticket.uploadId, kind, transactionId });
}

export const passUrl = (credentials: StudentCredentials) => request<{ url: string }>('/api/student/pass', credentials).then((data) => data.url);
