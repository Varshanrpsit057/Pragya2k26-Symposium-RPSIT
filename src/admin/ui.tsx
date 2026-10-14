/** Small pieces shared by the dashboard's panels. */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { site } from '../content/site';
import { usePageVisible } from '../hooks/usePageVisible';
import type { EventFeeView, PaymentMethod } from '../lib/admin';
import { rupees, type RegistrationStatus } from '../lib/registration';
import { ApiFailure, SignedOut, type ReceivedPayment } from './adminApi';
import { isLocalCopy } from '../lib/localCopy';

const istFormat = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const istTime = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'medium' });

/** '17 Oct 2026, 9:30 am IST', or a dash. */
export const when = (iso: string | null | undefined) => (iso ? `${istFormat.format(new Date(iso))} IST` : '—');
export const clockTime = (ms: number) => istTime.format(new Date(ms));

export const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.');

/** Starts a download from a short-lived link without leaving the dashboard. */
export function download(url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  link.click();
}

/** Saves a file made in the browser (the Excel downloads). */
export function saveFile(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const STATUS_LABEL: Record<RegistrationStatus, string> = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };

export function StatusBadge({ status }: { status: RegistrationStatus }) {
  return <span className={`adm-badge adm-badge--${status.toLowerCase()}`}>{STATUS_LABEL[status]}</span>;
}

export function Badge({ tone, children }: { tone: 'good' | 'bad' | 'warn' | 'plain'; children: ReactNode }) {
  return <span className={`adm-badge adm-badge--${{ good: 'approved', bad: 'rejected', warn: 'pending', plain: 'plain' }[tone]}`}>{children}</span>;
}

const METHOD_LABEL: Record<PaymentMethod, string> = { CASH: 'Cash', UPI: 'GPay / UPI' };

export function FeeBadge({ fee }: { fee: EventFeeView }) {
  return fee.status === 'PAID' ? <Badge tone="good">Paid · {METHOD_LABEL[fee.method!]}</Badge> : <Badge tone="warn">Fee unpaid</Badge>;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="adm-section">
      <h3 className="adm-section__title">{title}</h3>
      <dl className="adm-facts">{children}</dl>
    </section>
  );
}

export function Fact({ label, value, tone }: { label: string; value: ReactNode; tone?: 'bad' | 'warn' }) {
  return (
    <div className={`adm-fact${tone ? ` adm-fact--${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** Opens Contact admin (in the dashboard shell) with this context, e.g. the error just shown. */
export const HELP_EVENT = 'pragya-contact-admin';
export const openHelp = (context: { error?: string; registrationId?: string; category?: 'SITE_DOWN' | 'SIGN_IN' | 'WRONG_DETAILS' | 'PAYMENT' | 'OTHER' } = {}) =>
  window.dispatchEvent(new CustomEvent(HELP_EVENT, { detail: context }));

/** An error from the server, with Contact admin one click away (the error goes into the message). */
export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = messageOf(error);
  return (
    <p className="adm-error" role="alert">
      {message}{' '}
      <button type="button" className="adm-link adm-error__help" onClick={() => openHelp({ error: message })}>
        Contact admin
      </button>
    </p>
  );
}

/** How often the lists refresh themselves while the tab is in view. */
export const LIVE_INTERVAL_MS = 15_000;

/**
 * Data that keeps itself up to date: loaded at once, then again every `intervalMs` while the
 * tab is visible (several laptops change the same records on the event day). `load` must be
 * stable (useCallback). A signed-out answer goes to `onSignedOut`.
 */
export function useLiveData<T>(load: () => Promise<T>, onSignedOut: () => void, intervalMs = LIVE_INTERVAL_MS) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const visible = usePageVisible();

  useEffect(() => {
    let active = true;
    load().then(
      (value) => {
        if (!active) return;
        setData(value);
        setError(null);
        setUpdatedAt(Date.now());
        setLoading(false);
      },
      (failure: unknown) => {
        if (!active) return;
        if (failure instanceof SignedOut) onSignedOut();
        else setError(failure);
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [load, tick, onSignedOut]);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(() => setTick((count) => count + 1), intervalMs);
    return () => window.clearInterval(timer);
  }, [visible, intervalMs]);

  const refresh = useCallback(() => {
    setLoading(true);
    setTick((count) => count + 1);
  }, []);

  return { data, setData, error, loading, updatedAt, refresh };
}

export function LiveStatus({ updatedAt, loading, onRefresh }: { updatedAt: number | null; loading: boolean; onRefresh: () => void }) {
  return (
    <span className="adm-live">
      <span className="adm-muted">{updatedAt ? `Live · updated ${clockTime(updatedAt)}` : 'Loading…'}</span>
      <button className="adm-button adm-button--small" type="button" onClick={onRefresh} disabled={loading}>
        {loading ? 'Loading…' : 'Refresh'}
      </button>
    </span>
  );
}

export interface PaymentDraft {
  method: PaymentMethod | '';
  reference: string;
  confirmed: boolean;
}

export const EMPTY_PAYMENT: PaymentDraft = { method: '', reference: '', confirmed: false };

export const paymentReady = (draft: PaymentDraft) => draft.method !== '' && draft.confirmed;

export const toReceivedPayment = (draft: PaymentDraft): ReceivedPayment => ({
  method: draft.method as PaymentMethod,
  ...(draft.method === 'UPI' && draft.reference.trim() && { reference: draft.reference.trim() }),
  confirmedReceived: draft.confirmed,
});

/**
 * Cash or UPI, with the QR and UPI ID to show the participant, and the box the staff member
 * ticks to confirm the money actually arrived. The server refuses a payment without it.
 */
export function PaymentFields({ amount, value, onChange, name }: { amount: number; value: PaymentDraft; onChange: (next: PaymentDraft) => void; name: string }) {
  const { payment } = site.registration;
  return (
    <fieldset className="adm-pay">
      <legend className="adm-pay__legend">Payment of {rupees(amount)}</legend>
      <div className="adm-pay__methods">
        {(['CASH', 'UPI'] as const).map((method) => (
          <label key={method} className="adm-radio">
            <input
              type="radio"
              name={name}
              checked={value.method === method}
              onChange={() => onChange({ method, reference: method === 'CASH' ? '' : value.reference, confirmed: false })}
            />
            <span>{METHOD_LABEL[method]}</span>
          </label>
        ))}
      </div>
      {value.method === 'UPI' && (
        <div className="adm-pay__upi">
          {payment.upiId && (
            <p>
              Pay {rupees(amount)} to <strong className="adm-mono">{payment.upiId}</strong>
              {payment.payee && <> ({payment.payee})</>}.
            </p>
          )}
          {payment.qrImage && <img className="adm-pay__qr" src={payment.qrImage} alt={`UPI QR code for ${payment.upiId ?? 'payment'}`} />}
          <label className="adm-field">
            <span>UPI reference (optional, for the record)</span>
            <input
              value={value.reference}
              maxLength={35}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => onChange({ ...value, reference: event.target.value.replace(/\s+/g, '') })}
            />
          </label>
        </div>
      )}
      {value.method && (
        <label className="adm-check adm-pay__confirm">
          <input type="checkbox" checked={value.confirmed} onChange={(event) => onChange({ ...value, confirmed: event.target.checked })} />
          <span>
            {value.method === 'CASH'
              ? `I have received ${rupees(amount)} in cash.`
              : `I have seen ${rupees(amount)} credited in the receiving account.`}{' '}
            <em className="adm-muted">A QR scan, screenshot or transaction ID alone is not proof of payment.</em>
          </span>
        </label>
      )}
    </fieldset>
  );
}

/** The registration that already holds an email, phone or reference, when the server names one. */
export const existingRegistrationOf = (error: unknown) => (error instanceof ApiFailure ? (error.details.registrationId ?? null) : null);

export function LocalCopyBanner() {
  if (!isLocalCopy()) return null;
  return (
    <p className="adm-local-copy" role="note">
      LOCAL TEST COPY on this computer: not the live site. Its accounts and data are separate from pragya2k26.online.
    </p>
  );
}
