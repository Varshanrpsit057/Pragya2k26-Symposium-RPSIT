/**
 * A ₹50 event fee the student paid by GPay from Student login, checked by the event's
 * coordinator at the venue: the screenshot big (with zoom), the transaction ID typed from it,
 * then approve and mark present in one press (or approve only). The same steps as the desk's
 * check of a ₹100 gate pass.
 */
import { useCallback, useState } from 'react';
import { site } from '../content/site';
import type { EventParticipant, FeeProofView } from '../lib/admin';
import { rupees } from '../lib/registration';
import { SignedOut, approveFeeScreenshot, proofUrl } from './adminApi';
import { Dialog } from './Dialog';
import { Screenshot } from './Screenshot';
import { ErrorNote, when } from './ui';

interface FeeScreenshotCheckProps {
  eventId: string;
  eventName: string;
  registrationId: string;
  name: string;
  amount: number;
  proof: FeeProofView;
  token: string;
  /** After approving: the participant as they stand now. */
  onDone: (participant: EventParticipant) => void;
  onClose: () => void;
  onSignedOut: () => void;
}

const UTR = /^[A-Z0-9]{6,35}$/;

export function FeeScreenshotCheck({ eventId, eventName, registrationId, name, amount, proof, token, onDone, onClose, onSignedOut }: FeeScreenshotCheckProps) {
  const { payment } = site.registration;
  const [reference, setReference] = useState(proof.transactionId ?? '');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState<'present' | 'only' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => proofUrl(token, registrationId, proof.id), [token, registrationId, proof.id]);
  const utr = reference.replace(/\s+/g, '').toUpperCase();
  const ready = checked && UTR.test(utr) && busy === null;

  const approve = async (markPresent: boolean) => {
    setBusy(markPresent ? 'present' : 'only');
    setError(null);
    try {
      onDone(await approveFeeScreenshot(token, eventId, registrationId, { proofId: proof.id, reference: utr, markPresent }));
    } catch (failure) {
      if (failure instanceof SignedOut) onSignedOut();
      else setError(failure);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog title={`${eventName} fee · ${registrationId} · ${name}`} subtitle={`GPay screenshot uploaded ${when(proof.uploadedAt)} from Student login`} onClose={onClose} size="full">
      <section className="adm-verify" aria-label={`Verify the ${eventName} fee`}>
        <div className="adm-verify__shot">
          <Screenshot load={load} alt={`${eventName} fee screenshot for ${registrationId}`} onSignedOut={onSignedOut} />
        </div>
        <div className="adm-verify__side">
          <div className="adm-verify__facts">
            <p>
              Amount: <strong>{rupees(amount)}</strong>
            </p>
            {payment.payee && (
              <p>
                Paid to: <strong>{payment.payee}</strong>
                {payment.upiId && <span className="adm-muted adm-mono"> ({payment.upiId})</span>}
              </p>
            )}
          </div>
          <label className="adm-field adm-field--big">
            <span>Transaction ID from the screenshot (UPI reference / UTR)</span>
            <input className="adm-mono" value={reference} maxLength={40} autoComplete="off" spellCheck={false} disabled={busy !== null} onChange={(event) => setReference(event.target.value)} />
            {proof.transactionId && <small className="adm-muted">Filled in from what the student typed: compare it with the screenshot.</small>}
            {reference.trim() !== '' && !UTR.test(utr) && <small className="adm-field__error">6–35 letters or digits, exactly as in the screenshot.</small>}
          </label>
          <label className="adm-check adm-check--big">
            <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
            <span>
              I have checked the screenshot: {rupees(amount)} was paid{payment.payee ? ` to ${payment.payee}` : ''}, today, and the transaction ID matches.
            </span>
          </label>
          <ErrorNote error={error} />
          <div className="adm-actions__row">
            <button className="adm-button adm-button--approve adm-button--big" type="button" disabled={!ready} onClick={() => void approve(true)}>
              {busy === 'present' ? 'Saving…' : `Approve ${rupees(amount)} and mark present`}
            </button>
            <button className="adm-button adm-button--big" type="button" disabled={!ready} onClick={() => void approve(false)}>
              {busy === 'only' ? 'Saving…' : `Approve ${rupees(amount)} only`}
            </button>
          </div>
          <p className="adm-muted">Wrong or unclear screenshot? Ask the student to pay you in cash or upload it again, and close this window.</p>
        </div>
      </section>
    </Dialog>
  );
}
