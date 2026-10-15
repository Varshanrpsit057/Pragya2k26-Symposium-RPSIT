/** The students' page talks to the fest API without signing in (server/fest.ts, "Students on their own phones"). */
import { API_BASE, apiUrl } from '../lib/api';
import type { StudentView } from '../lib/fest';

export interface PublicEvent {
  id: string;
  dept: string;
  name: string;
  subtitle: string;
  venue: string;
  time: string;
  fee: number;
  teamMin: number;
  teamMax: number;
}

export interface PublicInfo {
  open: boolean;
  /** Registration on phones (off: the page sends students to a desk). */
  selfRegistration: boolean;
  /** "My registration ID" by mobile number. */
  lookup: boolean;
  /** Paying the entry fee here by UPI (the QR code) as well as at the desk. */
  onlinePayment: boolean;
  closesAt: string | null;
  entryFee: number;
  departments: { code: string; name: string }[];
  events: PublicEvent[];
}

/** The payment step: the UPI QR code (a picture, or null) and the account it pays. */
export interface PaymentInfo {
  online: boolean;
  upiId: string;
  upiPayee: string;
  qr: string | null;
}

export interface SelfRegistration {
  submissionId: string;
  /** The department they register for (its desks and event coordinators see them). */
  dept: string;
  participant: { name: string; phone: string; email: string; college: string; branch: string; year: string; team: string };
  events: string[];
}

export class StudentApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

export const NO_CONNECTION = 'No connection. Check your mobile data and try again (what you typed is kept).';

async function call<T>(path: `/api/${string}`, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(API_BASE, path), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new StudentApiError(NO_CONNECTION, 'NETWORK', 0);
  }
  const data = (await response.json().catch(() => null)) as { success?: boolean; error?: string; code?: string; details?: Record<string, string> } | null;
  if (!response.ok || !data?.success) {
    const busy = response.status === 429 || response.status === 503;
    throw new StudentApiError(data?.error ?? (busy ? 'Many students are registering right now. Please try again in a moment.' : 'Something went wrong. Please try again.'), data?.code ?? `HTTP_${response.status}`, response.status, data?.details ?? {});
  }
  return data as T;
}

export const fetchInfo = () => call<PublicInfo>('/api/fest/info');
export const registerSelf = (body: SelfRegistration) => call<{ registration: StudentView }>('/api/fest/register', body).then((data) => data.registration);
/** Who is asking: the private key from the phone that registered, or (to look only) the ID and mobile number. */
export interface StudentPass {
  id: string;
  phone: string;
  key?: string;
}

const pass = ({ id, phone, key }: StudentPass) => (key ? { id, key } : { id, phone });
export const fetchMe = (who: StudentPass) => call<{ registration: StudentView }>('/api/fest/me', pass(who)).then((data) => data.registration);
export const changeMyEvents = (who: StudentPass, add: string[], remove: string[] = []) =>
  call<{ registration: StudentView }>('/api/fest/me/events', { ...pass(who), add, remove }).then((data) => data.registration);
export const sendMyPayment = (who: StudentPass, txn: string) => call<{ registration: StudentView }>('/api/fest/me/payment', { ...pass(who), txn }).then((data) => data.registration);
/** "My registration ID" on another phone: the mobile number finds the registrations (to look at). */
export const findMine = (phone: string) => call<{ registrations: StudentView[] }>('/api/fest/find', { phone }).then((data) => data.registrations);
/** A message to the web assist team (it arrives in the dashboard's Help requests): who they are and how to reach them. */
export const askAdmin = (form: { category: 'FIND_ID'; name: string; contact: string; page: string; message: string }) => call<{ id: string }>('/api/help', form).then((data) => data.id);
export const fetchPayment = () => call<PaymentInfo>('/api/fest/payment');
