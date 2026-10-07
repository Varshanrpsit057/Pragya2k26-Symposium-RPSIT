import { useEffect, useState } from 'react';
import { site } from '../../content/site';
import { API_BASE } from '../../lib/api';
import { RegistrationError, type StatusResult } from '../../lib/registration';
import { checkStatus, passDownloadUrl, type OwnRegistration } from '../../lib/registrationClient';
import { Modal } from '../modal/Modal';
import { SpecularButton } from '../ui/SpecularButton';
import './RegistrationModal.css';

/** The registration API, or null while online registration is switched off. */
const API: string | null = site.registration.endpoint ? API_BASE : null;

const STATE_LABEL: Record<StatusResult['status'], string> = {
  PENDING: 'Pending verification',
  APPROVED: 'Approved',
  REJECTED: 'Not approved',
};

const errorMessage = (error: unknown) =>
  error instanceof RegistrationError ? error.message : 'Something went wrong. Please try again.';

interface StatusModalProps {
  /** The registration to show (from the private status link); null keeps the window closed. */
  own: OwnRegistration | null;
  onClose: () => void;
}

/** Where a participant's registration stands; the pass download appears only once approved. */
export function StatusModal({ own, onClose }: StatusModalProps) {
  return (
    <Modal open={own !== null} onClose={onClose} labelledBy="status-title" className="reg-modal">
      {/* A fresh view for every link opened. */}
      {own && <StatusView key={`${own.registrationId}.${own.key}`} own={own} onClose={onClose} />}
    </Modal>
  );
}

function StatusView({ own, onClose }: { own: OwnRegistration; onClose: () => void }) {
  const [result, setResult] = useState<StatusResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [passState, setPassState] = useState<'idle' | 'working'>('idle');
  const [passError, setPassError] = useState('');

  // Bumped by Refresh to ask the server again.
  const [checks, setChecks] = useState(0);
  useEffect(() => {
    let active = true;
    checkStatus(own, { apiBase: API }).then(
      (found) => {
        if (!active) return;
        setResult(found);
        setError('');
        setLoading(false);
      },
      (failure: unknown) => {
        if (!active) return;
        setError(errorMessage(failure));
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [own, checks]);

  const refresh = () => {
    setLoading(true);
    setChecks((count) => count + 1);
  };

  // The server checks the approval and hands out a link that works for one minute.
  const downloadPass = async () => {
    setPassState('working');
    setPassError('');
    try {
      window.location.assign(await passDownloadUrl(own, { apiBase: API }));
    } catch (failure) {
      setPassError(errorMessage(failure));
    } finally {
      setPassState('idle');
    }
  };

  return (
    <div className="reg-done" role="status" aria-busy={loading}>
      <h2 id="status-title" className="reg__title">
        Registration status
      </h2>
      <p className="reg-done__id">
        <span>Registration ID</span>
        <strong>{own.registrationId}</strong>
      </p>

      {result ? (
        <>
          <p className={`reg-state reg-state--${result.status.toLowerCase()}`}>{STATE_LABEL[result.status]}</p>
          <p className="reg-done__mail">
            {result.status === 'PENDING' &&
              'The organisers have not verified your payment yet. Once your registration is approved, your participant pass (PDF) and a confirmation email are sent to you.'}
            {result.status === 'APPROVED' &&
              'Your registration is confirmed. Your participant pass has been emailed to you, and you can also download it here.'}
            {result.status === 'REJECTED' &&
              `Your registration was not approved${result.reason ? `: ${result.reason}` : '.'} Please contact the organisers if you think this is a mistake.`}
          </p>
          {result.status === 'APPROVED' &&
            (result.passAvailable ? (
              <div className="reg-done__pass">
                <SpecularButton onClick={downloadPass} busy={passState === 'working'}>
                  {passState === 'working' ? 'Preparing your pass…' : 'Download participant pass (PDF)'}
                </SpecularButton>
                {passError && (
                  <p className="reg-done__pass-error" role="alert">
                    {passError}
                  </p>
                )}
              </div>
            ) : (
              <p className="reg-done__next">Your participant pass is being prepared. Please check again in a few minutes.</p>
            ))}
        </>
      ) : (
        <p className="reg-done__mail">{loading ? 'Checking your registration…' : error}</p>
      )}
      {result && error && (
        <p className="reg-done__pass-error" role="alert">
          {error}
        </p>
      )}

      <div className="reg-done__actions">
        <SpecularButton variant="ghost" onClick={refresh} busy={loading}>
          Refresh
        </SpecularButton>
        <SpecularButton onClick={onClose}>Close</SpecularButton>
      </div>
    </div>
  );
}
