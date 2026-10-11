/**
 * One payment with its evidence, the same for admins, the desk and event leads: the screenshot
 * (who uploaded it and when, shown big on request), the transaction ID the student typed, and
 * the one the approving staff member entered, flagged when the two differ.
 */
import { useCallback, useState } from 'react';
import type { PaymentRecordView } from '../lib/admin';
import { rupees } from '../lib/registration';
import { proofUrl, screenshotUrl } from './adminApi';
import { Screenshot } from './Screenshot';
import { Badge, when } from './ui';

const STATUS: Record<PaymentRecordView['status'], { text: string; tone: 'good' | 'bad' | 'warn' | 'plain' }> = {
  PAID: { text: 'Paid', tone: 'good' },
  WAITING: { text: 'Screenshot waiting for approval', tone: 'warn' },
  UNPAID: { text: 'Not paid yet', tone: 'plain' },
  REJECTED: { text: 'Rejected', tone: 'bad' },
  CANCELLED: { text: 'Cancelled', tone: 'bad' },
};
const METHOD = { ONLINE_UPI: 'GPay online', UPI: 'GPay / UPI', CASH: 'Cash' } as const;
const same = (a: string, b: string) => a.replace(/\s+/g, '').toUpperCase() === b.replace(/\s+/g, '').toUpperCase();

interface PaymentRecordProps {
  record: PaymentRecordView;
  registrationId: string;
  token: string;
  onSignedOut: () => void;
  /** Show the screenshot at once (e.g. in a window opened just to see it). */
  showScreenshot?: boolean;
  /** The online form's screenshot needs the payment-check permission. */
  canSeeFormScreenshot?: boolean;
}

export function PaymentRecord({ record, registrationId, token, onSignedOut, showScreenshot = false, canSeeFormScreenshot = true }: PaymentRecordProps) {
  const [open, setOpen] = useState(showScreenshot);
  const shot = record.screenshot;
  const proofId = shot?.proofId ?? '';
  const loadForm = useCallback(() => screenshotUrl(token, registrationId), [token, registrationId]);
  const loadProof = useCallback(() => proofUrl(token, registrationId, proofId), [token, registrationId, proofId]);
  const viewable = shot !== null && (shot.source === 'STUDENT_LOGIN' || canSeeFormScreenshot);
  const status = STATUS[record.status];
  const match = record.studentTransactionId && record.approvedTransactionId ? same(record.studentTransactionId, record.approvedTransactionId) : null;

  return (
    <article className="adm-payrec" aria-label={`${record.label} payment`}>
      <header className="adm-payrec__head">
        <strong>{record.label}</strong>
        <Badge tone={status.tone}>{status.text}</Badge>
        {record.method && <span className="adm-muted">{METHOD[record.method]}</span>}
        <span className="adm-muted">{rupees(record.amount)}</span>
      </header>
      <dl className="adm-payrec__facts">
        <div>
          <dt>Screenshot</dt>
          <dd>
            {shot ? (
              <>
                Uploaded by the student, {record.uploadedBy}, {shot.source === 'ONLINE_FORM' ? 'with the online form' : 'from Student login'}, {when(shot.uploadedAt)}{' '}
                {viewable && (
                  <button type="button" className="adm-button adm-button--small" aria-expanded={open} onClick={() => setOpen(!open)}>
                    {open ? 'Hide' : 'View'}
                  </button>
                )}
              </>
            ) : record.method === 'CASH' ? (
              'None: paid in cash'
            ) : (
              'None'
            )}
          </dd>
        </div>
        <div>
          <dt>Transaction ID typed by the student</dt>
          <dd className="adm-mono">{record.studentTransactionId ?? '—'}</dd>
        </div>
        <div>
          <dt>Transaction ID entered when approving</dt>
          <dd>
            {record.approvedTransactionId ? (
              <span className="adm-inline">
                <span className="adm-mono">{record.approvedTransactionId}</span>
                {record.approvedBy && <span className="adm-muted">by {record.approvedBy}</span>}
                {match === true && <Badge tone="good">Matches the student's</Badge>}
                {match === false && <Badge tone="bad">Differs from the student's</Badge>}
              </span>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div>
          <dt>{record.status === 'REJECTED' ? 'Rejected by' : record.method === 'CASH' ? 'Received by' : 'Approved by'}</dt>
          <dd>{record.approvedBy ? `${record.approvedBy}${record.approvedAtDesk ? ` (desk ${record.approvedAtDesk})` : ''}, ${when(record.approvedAt)}` : '—'}</dd>
        </div>
      </dl>
      {open && viewable && <Screenshot load={shot.source === 'ONLINE_FORM' ? loadForm : loadProof} alt={`${record.label} screenshot for ${registrationId}`} onSignedOut={onSignedOut} />}
    </article>
  );
}
