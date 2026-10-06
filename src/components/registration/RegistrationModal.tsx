import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import { events as allEvents, eventsByCategory } from '../../content/events';
import { site } from '../../content/site';
import type { EventCategory, SymposiumEvent } from '../../content/types';
import {
  DEPARTMENTS,
  EMPTY_REGISTRATION,
  OTHER_DEPARTMENT,
  REGISTRATION_FIELDS,
  RegistrationError,
  YEARS_OF_STUDY,
  buildRegistrationRecord,
  feeSummary,
  isRegistrationClosed,
  newSubmissionId,
  rupees,
  validateField,
  validateRegistration,
  type RegistrationErrors,
  type RegistrationField,
  type RegistrationInput,
} from '../../lib/registration';
import { submitRegistration, type RegistrationResult } from '../../lib/registrationClient';
import { formatIst, parseEventStart } from '../../lib/countdown';
import { Modal } from '../modal/Modal';
import { SearchSelect } from '../ui/SearchSelect';
import { SpecularButton } from '../ui/SpecularButton';
import './RegistrationModal.css';

interface RegistrationModalProps {
  open: boolean;
  /** The event card the visitor came from, if any: it is pre-selected. */
  event?: SymposiumEvent;
  /** Changes on every opening, so each one can pre-select its event. */
  request?: number;
  /** Registration had closed when the window was opened. */
  closed?: boolean;
  onClose: () => void;
}

type Status = 'editing' | 'submitting' | 'error' | 'success';
type TextField = Exclude<RegistrationField, 'screenshot' | 'events'>;

const TEXT_FIELDS: readonly TextField[] = [
  'name',
  'department',
  'departmentOther',
  'year',
  'college',
  'phone',
  'email',
  'transactionId',
];

/** The registration server: same site by default, or another address set at build time. */
const ENDPOINT: string | null = import.meta.env.VITE_REGISTRATION_API_URL || site.registration.endpoint;

const fieldId = (field: RegistrationField) => `reg-${field}`;

const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const CATEGORY_TITLES: Record<EventCategory, string> = {
  technical: 'Technical Events',
  'non-technical': 'Non-Technical Events',
};

/** Read at the moment it is called (e.g. on submit), not when the form was opened. */
const registrationClosedNow = () => isRegistrationClosed(site.registration.closesAt, Date.now());

function closedMessage(): string {
  const { closesAt } = site.registration;
  const end = closesAt ? parseEventStart(closesAt) : null;
  return `Online registration for ${site.name} ${site.year} closed${end ? ` on ${formatIst(end)}` : ''}.`;
}

// Runs before paint in the browser; harmless no-op during server rendering.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** The one registration form for the whole site, in a window. */
export function RegistrationModal({ open, event, request = 0, closed = false, onClose }: RegistrationModalProps) {
  const [values, setValues] = useState<RegistrationInput>(EMPTY_REGISTRATION);
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [checked, setChecked] = useState<Partial<Record<RegistrationField, boolean>>>({});
  const [status, setStatus] = useState<Status>('editing');
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [passState, setPassState] = useState<'idle' | 'working' | 'error'>('idle');
  const [seenRequest, setSeenRequest] = useState(request);
  const formRef = useRef<HTMLFormElement>(null);
  const previewRef = useRef<string | null>(null);
  /** One id per filled-in form, re-sent on every retry so the server never registers it twice. */
  const submissionRef = useRef<string | null>(null);
  /** The latest form state, for handlers that stay the same from one render to the next. */
  const latest = useRef({ values, checked });
  useIsomorphicLayoutEffect(() => {
    latest.current = { values, checked };
  });

  const { gatePassFee, eventFee, payment } = site.registration;
  const fees = { gatePass: gatePassFee, perEvent: eventFee };
  const summary = feeSummary(values.events, fees);

  const hasDraft =
    values.events.length > 0 || values.screenshot !== null || TEXT_FIELDS.some((field) => values[field].trim() !== '');
  // Reloading or leaving the page would lose the form (or interrupt a submission): ask first.
  const guardLeaving = open && (status === 'submitting' || (status !== 'success' && !closed && hasDraft));
  useEffect(() => {
    if (!guardLeaving) return;
    const warn = (unloadEvent: BeforeUnloadEvent) => {
      unloadEvent.preventDefault();
      unloadEvent.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [guardLeaving]);

  // Opened from an event card: add that event to the selection (once per opening).
  if (request !== seenRequest) {
    setSeenRequest(request);
    if (event && !values.events.includes(event.id)) {
      setValues({ ...values, events: [...values.events, event.id] });
      setErrors((current) => ({ ...current, events: undefined }));
    }
  }

  // Release the preview's object URL when the form goes away.
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const update = (field: RegistrationField, next: RegistrationInput) => {
    setValues(next);
    // Once a field has been checked, re-check it as the visitor corrects it.
    if (checked[field]) setErrors((current) => ({ ...current, [field]: validateField(field, next) }));
  };

  const setText = (field: TextField) => (changeEvent: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    update(field, { ...values, [field]: changeEvent.target.value });

  // Leaving a field checks what was typed; an untouched empty field (e.g. when the window is
  // closed) is only flagged after a submit attempt.
  const check = (field: TextField) => () => {
    if (!submitted && !values[field].trim()) return;
    setChecked((current) => ({ ...current, [field]: true }));
    setErrors((current) => ({ ...current, [field]: validateField(field, values) }));
  };

  // Choosing Other shows a field to type the department; choosing any other department hides
  // that field again and forgets what was typed in it.
  const chooseDepartment = (department: string) => {
    const other = department === OTHER_DEPARTMENT;
    const next = { ...values, department, departmentOther: other ? values.departmentOther : '' };
    setValues(next);
    setChecked((current) => ({ ...current, department: true, departmentOther: other && current.departmentOther }));
    setErrors((current) => ({
      ...current,
      department: validateField('department', next),
      departmentOther: other ? current.departmentOther : undefined,
    }));
  };

  // The same function on every render, so the event list is not redrawn on each keystroke.
  const toggleEvent = useCallback((id: string) => {
    const { values: current, checked: wasChecked } = latest.current;
    const events = current.events.includes(id) ? current.events.filter((selected) => selected !== id) : [...current.events, id];
    const next = { ...current, events };
    setValues(next);
    if (wasChecked.events) setErrors((found) => ({ ...found, events: validateField('events', next) }));
  }, []);

  const chooseScreenshot = (file: File | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    previewRef.current = url;
    setPreview(url);
    const next = { ...values, screenshot: file };
    setValues(next);
    setChecked((current) => ({ ...current, screenshot: true }));
    setErrors((current) => ({ ...current, screenshot: validateField('screenshot', next) }));
  };

  const reset = () => {
    chooseScreenshot(null);
    setValues(EMPTY_REGISTRATION);
    setErrors({});
    setChecked({});
    setSubmitted(false);
    setStatus('editing');
    setSubmitError('');
    setResult(null);
    setPassState('idle');
    submissionRef.current = null;
  };

  // The same participant pass the email carries, made here so it can be saved straight away.
  // The PDF code is loaded only when it is asked for.
  const downloadPass = async () => {
    if (!result || passState === 'working') return;
    setPassState('working');
    try {
      const [{ buildPassPdf, passData, passFileName }, logo] = await Promise.all([
        import('../../lib/pass'),
        fetch('/images/rpsit-logo-pass.jpg').then((response) => {
          if (!response.ok) throw new Error('logo');
          return response.arrayBuffer();
        }),
      ]);
      const record = buildRegistrationRecord(values, allEvents, fees);
      const pdf = await buildPassPdf(
        passData({ registrationId: result.registrationId, registeredAt: result.registeredAt, record, eventIds: values.events }),
        logo,
      );
      const url = URL.createObjectURL(new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = passFileName(result.registrationId);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setPassState('idle');
    } catch {
      setPassState('error');
    }
  };

  const close = () => {
    onClose();
    // A finished registration starts fresh next time; a draft is kept.
    if (status === 'success') reset();
  };

  const handleSubmit = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    if (status === 'submitting') return;

    setSubmitted(true);
    const found = validateRegistration(values);
    setErrors(found);
    setChecked(Object.fromEntries(REGISTRATION_FIELDS.map((field) => [field, true])));
    const firstInvalid = REGISTRATION_FIELDS.find((field) => found[field]);
    if (firstInvalid) {
      formRef.current?.querySelector<HTMLElement>(`#${fieldId(firstInvalid)}`)?.focus();
      return;
    }

    // The form may have been open since before the closing time.
    if (registrationClosedNow()) {
      setSubmitError(closedMessage());
      setStatus('error');
      return;
    }

    setStatus('submitting');
    setSubmitError('');
    submissionRef.current ??= newSubmissionId();
    try {
      const saved = await submitRegistration(values, { endpoint: ENDPOINT, submissionId: submissionRef.current });
      setResult(saved);
      setStatus('success');
    } catch (error) {
      const serverFieldErrors = error instanceof RegistrationError ? error.fieldErrors : undefined;
      if (serverFieldErrors && Object.keys(serverFieldErrors).length > 0) {
        // The server found a problem with particular fields: mark them like the form does.
        setErrors((current) => ({ ...current, ...serverFieldErrors }));
        setSubmitError('');
        const first = REGISTRATION_FIELDS.find((field) => serverFieldErrors[field]);
        if (first) formRef.current?.querySelector<HTMLElement>(`#${fieldId(first)}`)?.focus();
      } else {
        setSubmitError(error instanceof RegistrationError ? error.message : 'Something went wrong. Please try again.');
      }
      setStatus('error');
    }
  };

  const errorCount = REGISTRATION_FIELDS.filter((field) => errors[field]).length;
  const selectedNames = allEvents.filter((item) => values.events.includes(item.id)).map((item) => item.name);

  const inputProps = (field: TextField) => ({
    id: fieldId(field),
    name: field,
    value: values[field],
    onChange: setText(field),
    onBlur: check(field),
    required: true,
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `${fieldId(field)}-error` : undefined,
  });

  return (
    <Modal
      open={open}
      onClose={close}
      labelledBy="registration-title"
      locked
      keepMounted
      initialFocus={`#${fieldId('name')}`}
      className="reg-modal"
    >
      {closed && status !== 'success' ? (
        <div className="reg-done" role="status">
          <span className="reg-done__badge reg-done__badge--closed" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24">
              <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </g>
            </svg>
          </span>
          <h2 id="registration-title" className="reg__title">
            Registration closed
          </h2>
          <p className="reg__lead">{closedMessage()} Thank you for your interest.</p>
          <div className="reg-done__actions">
            <SpecularButton onClick={close}>Close</SpecularButton>
          </div>
        </div>
      ) : status === 'success' && result ? (
        <div className="reg-done" role="status">
          <span className="reg-done__badge" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 24 24">
              <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h2 id="registration-title" className="reg__title">
            Registration Successfully Completed!
          </h2>
          <p className="reg-done__id">
            <span>Registration ID</span>
            <strong>{result.registrationId}</strong>
          </p>
          <p className="reg__lead">
            Your registration details and payment screenshot have been successfully received.
          </p>
          <p className="reg-done__mail">
            {result.duplicate
              ? 'You were already registered with this email and transaction ID, so no second registration was made. Your participant pass was emailed when you first registered.'
              : `Your participant pass (PDF) and a confirmation email are being sent to your registered email address, ${values.email.trim()}. If it is not in your inbox within a few minutes, check your Spam folder and mark it "Not spam".`}
          </p>
          <dl className="reg-done__summary">
            <div>
              <dt>Transaction ID</dt>
              <dd>{values.transactionId.trim()}</dd>
            </div>
            <div>
              <dt>Events</dt>
              <dd>{summary.eventCount}</dd>
            </div>
            <div>
              <dt>Bring on the day</dt>
              <dd>{rupees(summary.eventTotal)}</dd>
            </div>
          </dl>
          <p className="reg-done__events">{selectedNames.join(' · ')}</p>
          <p className="reg-done__next">
            Please keep your Registration ID for future reference. Kindly bring {rupees(summary.eventTotal)} for your{' '}
            {plural(summary.eventCount, 'event')} when you come to the college for the symposium.
          </p>
          {!result.duplicate && (
            <div className="reg-done__pass">
              <SpecularButton onClick={downloadPass} busy={passState === 'working'}>
                {passState === 'working' ? 'Preparing your pass…' : 'Download participant pass (PDF)'}
              </SpecularButton>
              {passState === 'error' && (
                <p className="reg-done__pass-error" role="alert">
                  The pass could not be prepared here. It is attached to your confirmation email.
                </p>
              )}
            </div>
          )}
          <div className="reg-done__actions">
            <SpecularButton variant="ghost" onClick={reset}>
              Register another person
            </SpecularButton>
            <SpecularButton onClick={close}>Done</SpecularButton>
          </div>
        </div>
      ) : (
        <>
          <header className="reg__head">
            <p className="reg__eyebrow">Gate pass &amp; event registration</p>
            <h2 id="registration-title" className="reg__title">
              {site.name} {site.year} Registration
            </h2>
            <p className="reg__lead">
              Fill in your details, choose your events, then pay the {rupees(gatePassFee)} gate pass fee and upload the
              payment screenshot.
            </p>
          </header>

          <form ref={formRef} className="reg" noValidate onSubmit={handleSubmit}>
            <fieldset className="reg__section">
              <legend className="reg__legend">
                <span className="reg__step" aria-hidden="true">1</span>
                Participant details
              </legend>
              <div className="reg__grid">
                <Field field="name" label="Name with initial" error={errors.name} wide>
                  <input {...inputProps('name')} type="text" autoComplete="name" placeholder="e.g. Varshan C" />
                </Field>
                <div className="reg-field-stack">
                  <Field field="department" label="Department" labelId="reg-department-label" error={errors.department}>
                    <SearchSelect
                      id={fieldId('department')}
                      labelId="reg-department-label"
                      options={DEPARTMENTS}
                      value={values.department}
                      onChange={chooseDepartment}
                      placeholder="Select your department"
                      searchPlaceholder="Search department..."
                      searchLabel="Search departments"
                      emptyText={(query) => `No department matches “${query}”. Choose Other to type your department.`}
                      invalid={Boolean(errors.department)}
                      describedBy={errors.department ? `${fieldId('department')}-error` : undefined}
                    />
                  </Field>
                  {values.department === OTHER_DEPARTMENT && (
                    <Field field="departmentOther" label="Please specify your department" error={errors.departmentOther}>
                      <input {...inputProps('departmentOther')} type="text" placeholder="Enter your department" />
                    </Field>
                  )}
                </div>
                <Field field="year" label="Year of study" error={errors.year}>
                  <select {...inputProps('year')}>
                    <option value="" disabled>
                      Choose your year
                    </option>
                    {YEARS_OF_STUDY.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field field="college" label="College" error={errors.college} wide>
                  <input {...inputProps('college')} type="text" autoComplete="organization" placeholder="Your college name" />
                </Field>
                <Field field="phone" label="Phone number" error={errors.phone}>
                  <input {...inputProps('phone')} type="tel" inputMode="tel" autoComplete="tel" placeholder="10-digit mobile number" />
                </Field>
                <Field field="email" label="Email ID" error={errors.email}>
                  <input {...inputProps('email')} type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" />
                </Field>
              </div>
            </fieldset>

            <EventPicker selected={values.events} error={errors.events} onToggle={toggleEvent} />

            <fieldset className="reg__section">
              <legend className="reg__legend">
                <span className="reg__step" aria-hidden="true">3</span>
                Gate Pass Payment
              </legend>

              <div className="reg-pay">
                <div className="reg-pay__amount">
                  <span className="reg-pay__label">Gate pass fee</span>
                  <span className="reg-pay__value">{rupees(gatePassFee)}</span>
                  <span className="reg-pay__per">per person</span>
                </div>
                <div className="reg-pay__how">
                  {payment.upiId ? (
                    <>
                      <p>
                        Pay {rupees(gatePassFee)} by UPI to <strong className="reg-pay__upi">{payment.upiId}</strong>
                        {payment.payee && <> ({payment.payee})</>}, then upload the screenshot and transaction ID below.
                      </p>
                      {payment.qrImage && (
                        <img className="reg-pay__qr" src={payment.qrImage} alt={`UPI QR code for ${payment.upiId}`} width="132" height="132" />
                      )}
                    </>
                  ) : (
                    <p>
                      Pay the {rupees(gatePassFee)} gate pass fee by UPI. The UPI ID and QR code for payment will be shared
                      here soon. After paying, upload the screenshot and transaction ID below.
                    </p>
                  )}
                  <p className="reg-pay__note">
                    Event registration fees ({rupees(eventFee)} per event) are collected on-site at the college. Upload the
                    screenshot of the {rupees(gatePassFee)} gate pass payment only.
                  </p>
                </div>
              </div>

              <div className="reg__grid">
                <div className={`reg-field reg-field--wide ${errors.screenshot ? 'has-error' : ''}`}>
                  <span className="reg-field__label" id="reg-screenshot-label">
                    Gate pass payment screenshot <span className="reg-field__req" aria-hidden="true">*</span>
                  </span>
                  <div
                    className="reg-upload"
                    data-dragging={dragging ? '' : undefined}
                    onDragOver={(dragEvent: DragEvent) => {
                      dragEvent.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(dragEvent: DragEvent) => {
                      dragEvent.preventDefault();
                      setDragging(false);
                      chooseScreenshot(dragEvent.dataTransfer.files[0] ?? null);
                    }}
                  >
                    <input
                      id={fieldId('screenshot')}
                      className="reg-upload__input"
                      type="file"
                      accept="image/*"
                      required
                      aria-labelledby="reg-screenshot-label"
                      aria-invalid={errors.screenshot ? true : undefined}
                      aria-describedby={errors.screenshot ? 'reg-screenshot-error' : 'reg-screenshot-hint'}
                      onChange={(changeEvent) => {
                        // Closing the file chooser without picking keeps the current image
                        // (some browsers report that as a change with no file); Remove clears it.
                        const file = changeEvent.target.files?.[0];
                        if (file) chooseScreenshot(file);
                        changeEvent.target.value = '';
                      }}
                    />
                    {values.screenshot && preview ? (
                      <div className="reg-upload__preview">
                        <img src={preview} alt="Preview of your payment screenshot" />
                        <div className="reg-upload__file">
                          <p className="reg-upload__name">{values.screenshot.name}</p>
                          <p className="reg-upload__size">{formatBytes(values.screenshot.size)}</p>
                          <div className="reg-upload__buttons">
                            <label htmlFor={fieldId('screenshot')} className="reg-upload__change">
                              Change image
                            </label>
                            <button type="button" className="reg-upload__remove" onClick={() => chooseScreenshot(null)}>
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <label htmlFor={fieldId('screenshot')} className="reg-upload__drop">
                        <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="16" rx="3" />
                            <circle cx="9" cy="10" r="1.8" />
                            <path d="M21 16l-5-5-8 8" />
                          </g>
                        </svg>
                        <span className="reg-upload__cta">Choose an image</span>
                        <span className="reg-upload__or">or drag it here</span>
                      </label>
                    )}
                  </div>
                  {errors.screenshot ? (
                    <p id="reg-screenshot-error" className="reg-field__error">
                      {errors.screenshot}
                    </p>
                  ) : (
                    <p id="reg-screenshot-hint" className="reg-field__hint">
                      The {rupees(gatePassFee)} gate pass payment. PNG or JPG, up to 5 MB.
                    </p>
                  )}
                </div>

                <Field
                  field="transactionId"
                  label="Transaction ID"
                  error={errors.transactionId}
                  hint="The UTR / reference number of the gate pass payment, shown in your payment app."
                  wide
                >
                  <input
                    {...inputProps('transactionId')}
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="e.g. 412345678901"
                    aria-describedby={`${fieldId('transactionId')}-${errors.transactionId ? 'error' : 'hint'}`}
                  />
                </Field>
              </div>
            </fieldset>

            {errorCount > 0 && (
              <p className="reg__alert" role="alert">
                {errorCount === 1 && errors.events
                  ? errors.events
                  : `Please fix ${errorCount === 1 ? 'the highlighted field' : `the ${errorCount} highlighted fields`} to continue.`}
              </p>
            )}
            {status === 'error' && submitError && (
              <p className="reg__alert" role="alert">
                {submitError}
              </p>
            )}

            <div className="reg__actions">
              <p className="reg__required">
                <span aria-hidden="true">*</span> All fields are required, with at least one event.
              </p>
              <SpecularButton type="submit" size="lg" busy={status === 'submitting'}>
                {status === 'submitting' ? 'Submitting…' : 'Submit Registration'}
              </SpecularButton>
            </div>
          </form>
        </>
      )}
    </Modal>
  );
}

interface FieldProps {
  field: RegistrationField;
  label: string;
  /** id for the label, when the control refers to it (e.g. a custom dropdown). */
  labelId?: string;
  error?: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}

interface EventPickerProps {
  selected: readonly string[];
  error?: string;
  onToggle: (id: string) => void;
}

/**
 * Step 2 of the form: the events and what they cost. Memoised, because it depends only on
 * the chosen events, so typing in the other fields leaves it alone.
 */
const EventPicker = memo(function EventPicker({ selected, error, onToggle }: EventPickerProps) {
  const { gatePassFee, eventFee } = site.registration;
  const summary = feeSummary(selected, { gatePass: gatePassFee, perEvent: eventFee });

  return (
    <fieldset
      className={`reg__section${error ? ' has-error' : ''}`}
      aria-describedby={error ? 'reg-events-error' : 'reg-events-hint'}
    >
      <legend className="reg__legend">
        <span className="reg__step" aria-hidden="true">2</span>
        Select Events <span className="reg-field__req" aria-hidden="true">*</span>
      </legend>
      <p id="reg-events-hint" className="reg__hint">
        Select the events you would like to participate in. Each event costs {rupees(eventFee)}.
      </p>

      <div className="reg-events">
        {(['technical', 'non-technical'] as const).map((category, groupIndex) => (
          <div key={category} className="reg-events__group" role="group" aria-labelledby={`reg-events-${category}`} data-category={category}>
            <h3 id={`reg-events-${category}`} className="reg-events__title">
              {CATEGORY_TITLES[category]}
              <span className="reg-events__count">
                {eventsByCategory(category).filter((item) => selected.includes(item.id)).length} selected
              </span>
            </h3>
            <ul className="reg-events__list">
              {eventsByCategory(category).map((item, index) => {
                const isSelected = selected.includes(item.id);
                const showSubtitle = item.subtitle && !item.name.toLowerCase().includes(item.subtitle.toLowerCase());
                return (
                  <li key={item.id}>
                    <label className={`reg-event${isSelected ? ' is-selected' : ''}`}>
                      <input
                        // The first box carries the section's id, so a failed submit can focus it.
                        id={groupIndex === 0 && index === 0 ? fieldId('events') : undefined}
                        className="reg-event__input"
                        type="checkbox"
                        name="events"
                        value={item.id}
                        checked={isSelected}
                        onChange={() => onToggle(item.id)}
                      />
                      <span className="reg-event__box" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24">
                          <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      <span className="reg-event__text">
                        <span className="reg-event__name">{item.name}</span>
                        {showSubtitle && <span className="reg-event__sub">{item.subtitle}</span>}
                      </span>
                      <span className="reg-event__fee">{rupees(eventFee)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {error && (
        <p id="reg-events-error" className="reg-field__error">
          {error}
        </p>
      )}

      <div className="reg-fees" aria-live="polite">
        <h3 className="reg-fees__title">Event Registration Summary</h3>
        <dl className="reg-fees__rows">
          <div>
            <dt>Selected events</dt>
            <dd>{summary.eventCount}</dd>
          </div>
          <div>
            <dt>Event fee</dt>
            <dd>
              {rupees(eventFee)} × {summary.eventCount}
            </dd>
          </div>
          <div className="reg-fees__total">
            <dt>Total event fee</dt>
            <dd>{rupees(summary.eventTotal)}</dd>
          </div>
        </dl>
        <p className="reg-fees__grand">
          <span>
            Total amount: {rupees(gatePassFee)} gate pass + {rupees(summary.eventTotal)} events
          </span>
          <strong>= {rupees(summary.grandTotal)}</strong>
        </p>
        <p className="reg-fees__split">
          {rupees(gatePassFee)} is paid online now · {rupees(summary.eventTotal)} is paid on-site at the college
        </p>
      </div>

      <div className="reg-note" role="note">
        <p className="reg-note__title">Kindly note</p>
        <p>
          The {rupees(gatePassFee)} registration amount is the gate pass fee. Each event requires an additional{' '}
          {rupees(eventFee)} on-site registration fee. Please select all the events you wish to participate in, and
          kindly bring the event registration amount with you when you come to the college for the symposium.
        </p>
        <p className="reg-note__personal" aria-live="polite">
          {summary.eventCount === 0
            ? "You haven't selected any events yet."
            : `You have selected ${plural(summary.eventCount, 'event')}. The event registration fee is ${rupees(summary.eventTotal)}. Kindly bring ${rupees(summary.eventTotal)} with you when you come to the college for the event.`}
        </p>
      </div>
    </fieldset>
  );
});

function Field({ field, label, labelId, error, hint, wide, children }: FieldProps) {
  const id = fieldId(field);
  return (
    <div className={['reg-field', wide && 'reg-field--wide', error && 'has-error'].filter(Boolean).join(' ')}>
      <label id={labelId} htmlFor={id} className="reg-field__label">
        {label} <span className="reg-field__req" aria-hidden="true">*</span>
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="reg-field__error">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="reg-field__hint">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
