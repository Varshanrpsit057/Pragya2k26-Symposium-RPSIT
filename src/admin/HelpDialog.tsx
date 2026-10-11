/**
 * Contact admin: on the sign-in page and in every dashboard section, and next to any error.
 * A short form (what is wrong, the student if any, a message) goes to the admins and the web
 * assistant team; their phone numbers are always shown too, for when nothing loads.
 */
import { useEffect, useState } from 'react';
import { HELP_CONTACTS } from '../content/helpContacts';
import { HELP_CATEGORIES, type HelpCategory, type HelpRequest } from '../lib/help';
import { myHelp, sendHelp } from './adminApi';
import { Dialog } from './Dialog';
import { messageOf, when } from './ui';

/** When this student coordinator last read the replies to their requests (this browser). */
const seenKey = (username: string) => `pragya-help-seen-${username}`;
export function repliesSeenAt(username: string): string {
  try {
    return localStorage.getItem(seenKey(username)) ?? '';
  } catch {
    return '';
  }
}
function markRepliesSeen(username: string) {
  try {
    localStorage.setItem(seenKey(username), new Date().toISOString());
  } catch {
    // Storage blocked: the badge shows until the reply is older than this session.
  }
}

export interface HelpContext {
  /** The dashboard section it happened in. */
  page?: string;
  category?: HelpCategory;
  /** The error the dashboard showed, put into the message. */
  error?: string;
  registrationId?: string;
}

interface HelpDialogProps {
  token: string | null;
  /** The signed-in student coordinator (named from their account); empty on the sign-in page. */
  signedInAs?: string;
  /** Their username, for their earlier requests and the replies to them. */
  username?: string;
  context?: HelpContext;
  onClose: () => void;
}

export function HelpDialog({ token, signedInAs, username, context = {}, onClose }: HelpDialogProps) {
  const [earlier, setEarlier] = useState<HelpRequest[]>([]);
  useEffect(() => {
    if (!token || !username) return;
    let active = true;
    myHelp(token).then(
      (requests) => {
        if (!active) return;
        setEarlier(requests);
        markRepliesSeen(username);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [token, username]);
  const [category, setCategory] = useState<HelpCategory>(context.category ?? (token ? 'OTHER' : 'SIGN_IN'));
  const [message, setMessage] = useState(context.error ? `The dashboard said: "${context.error}"\n` : '');
  const [registrationId, setRegistrationId] = useState(context.registrationId ?? '');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await sendHelp(
        {
          category,
          message: message.trim(),
          ...(registrationId.trim() && { registrationId: registrationId.trim() }),
          ...(context.page && { page: context.page }),
          ...(!token && { name: name.trim(), contact: contact.trim() }),
        },
        token,
      );
      setSent(true);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  const ready = message.trim().length >= 5 && (token !== null || name.trim().length >= 2);

  return (
    <Dialog title="Contact admin" subtitle="Tell the admins and the web assistant team what went wrong." onClose={onClose} size="small" confirmClose={!sent && message.trim().length > 20 ? 'Close without sending?' : null}>
      {sent ? (
        <div className="adm-help-sent" role="status">
          <p className="adm-help-sent__title">Sent. The team will look at it now.</p>
          <p className="adm-muted">If it is urgent, call one of the numbers below too.</p>
          <button className="adm-button adm-button--primary adm-button--big" type="button" onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <div className="adm-form">
          <label className="adm-field adm-form__wide">
            <span>What is the problem?</span>
            <select value={category} onChange={(event) => setCategory(event.target.value as HelpCategory)}>
              {(Object.entries(HELP_CATEGORIES) as [HelpCategory, string][]).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="adm-field adm-form__wide">
            <span>Registration ID of the student (if it is about one)</span>
            <input value={registrationId} onChange={(event) => setRegistrationId(event.target.value)} inputMode="numeric" placeholder="e.g. 262007" autoComplete="off" />
          </label>
          <label className="adm-field adm-form__wide">
            <span>What happened?</span>
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={4} maxLength={1000} placeholder="e.g. The college name of 262007 is wrong; it should be Sona College of Technology." autoFocus />
          </label>
          {token ? (
            <p className="adm-muted adm-form__wide">Sent as {signedInAs}.</p>
          ) : (
            <>
              <label className="adm-field">
                <span>Your name</span>
                <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
              </label>
              <label className="adm-field">
                <span>Your phone</span>
                <input value={contact} onChange={(event) => setContact(event.target.value)} inputMode="tel" autoComplete="tel" />
              </label>
            </>
          )}
          {error && (
            <p className="adm-error adm-form__wide" role="alert">
              Could not send: {error} Please call one of the numbers below.
            </p>
          )}
          <div className="adm-form__wide">
            <button className="adm-button adm-button--primary adm-button--big" type="button" disabled={!ready || busy} onClick={() => void submit()}>
              {busy ? 'Sending…' : 'Send to the admins'}
            </button>
          </div>
        </div>
      )}
      {earlier.length > 0 && (
        <section className="adm-help-earlier" aria-label="Your earlier requests">
          <p className="adm-help-call__title">Your earlier requests</p>
          <ul>
            {earlier.slice(0, 5).map((request) => (
              <li key={request.id}>
                <p>
                  <strong>{HELP_CATEGORIES[request.category]}</strong> <span className="adm-muted">{when(request.createdAt)} · {request.status === 'OPEN' ? 'open' : 'resolved'}</span>
                </p>
                <p className="adm-muted">{request.message}</p>
                {(request.replies ?? []).map((reply) => (
                  <p key={reply.at} className="adm-help-reply">
                    <strong>{reply.by}:</strong> {reply.text} <span className="adm-muted">({when(reply.at)})</span>
                  </p>
                ))}
                {(request.replies ?? []).length === 0 && <p className="adm-muted">No reply yet.</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {HELP_CONTACTS.length > 0 && (
        <aside className="adm-help-call" aria-label="Call for help">
          <p className="adm-help-call__title">Or call</p>
          <ul>
            {HELP_CONTACTS.map((person) => (
              <li key={person.phone}>
                <span>
                  {person.name} <span className="adm-muted">· {person.role}</span>
                </span>
                <span className="adm-inline">
                  <a className="adm-button adm-button--small" href={`tel:${person.phone.replace(/\s+/g, '')}`}>
                    Call {person.phone}
                  </a>
                  <a className="adm-button adm-button--small" href={`https://wa.me/${person.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">
                    WhatsApp
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </Dialog>
  );
}
