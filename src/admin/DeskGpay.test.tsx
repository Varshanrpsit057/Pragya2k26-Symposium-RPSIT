import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminRegistration } from '../lib/admin';
import { ROLE_PERMISSIONS, type SessionInfo } from '../lib/staff';
import { AdminApp } from './AdminApp';

const desk: SessionInfo = {
  username: 'desk1',
  displayName: 'Desk One',
  role: 'DESK',
  kind: 'staff',
  eventIds: [],
  permissions: [...ROLE_PERMISSIONS.DESK],
  expiresAt: '2026-10-17T12:00:00.000Z',
  serverTime: '2026-10-17T04:00:00.000Z',
  phase: 'onsite',
  eventDayStarted: true,
  schedule: { onlineClosesAt: '2026-10-16T23:59:00', onsiteOpensAt: '2026-10-17T00:00:00', onsiteClosesAt: '2026-10-18T00:00:00' },
  fees: { gatePass: 100, perEvent: 50 },
  passByEmail: false,
  deskNumber: null,
};

/** Registered at the desk to pay by GPay from Student login; the student has uploaded the screenshot. */
const pending: AdminRegistration = {
  registrationId: '262005',
  source: 'ONSITE',
  status: 'PENDING',
  submittedAt: '2026-10-17T04:00:00.000Z',
  approvedAt: null,
  rejectedAt: null,
  reviewedBy: null,
  rejectionReason: null,
  cancelled: null,
  createdBy: 'desk1',
  deskNumber: null,
  teamName: null,
  participant: {
    name: 'Kavin S',
    department: 'Computer Science and Engineering (CSE)',
    college: 'Sona College of Technology, Salem',
    year: '2nd Year',
    phone: '9840011111',
    email: 'kavin@example.com',
  },
  technicalEvents: [],
  discontinuedEvents: [],
  eventCount: 0,
  feePerEvent: 50,
  payableAtVenue: 0,
  payment: { amount: 100, transactionId: '' },
  gatePass: { status: 'AWAITING_VERIFICATION', method: 'UPI', amount: 100, reference: null, verifiedBy: null, verifiedAt: null },
  events: [],
  proofs: [{ id: 'abc123def456', kind: 'GATE_PASS', label: 'Gate pass ₹100', transactionId: 'UTR44556677', uploadedAt: '2026-10-17T04:05:00.000Z' }],
  payments: [],
  screenshot: null,
  pdfStatus: 'NOT_STARTED',
  pdfGeneratedAt: null,
  pdfError: null,
  emailStatus: 'NOT_SENT',
  emailSentAt: null,
  emailError: null,
  emailAttempts: 0,
  driveLinks: { payment: null, pass: null },
  sheet: { synced: true, error: null },
  processing: false,
};

const approved: AdminRegistration = {
  ...pending,
  status: 'APPROVED',
  approvedAt: '2026-10-17T04:06:00.000Z',
  reviewedBy: 'desk1',
  payment: { amount: 100, transactionId: 'UTR44556677' },
  gatePass: { status: 'VERIFIED', method: 'UPI', amount: 100, reference: 'UTR44556677', verifiedBy: 'desk1', verifiedAt: '2026-10-17T04:06:00.000Z' },
  pdfStatus: 'GENERATED',
};

/** Answers like the API for a desk laptop, and records what is sent. */
function api(registrations: AdminRegistration[], answers: Record<string, unknown> = {}) {
  sessionStorage.setItem('pragya-admin-session', 'x'.repeat(43));
  const sent: { url: string; body: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.body) sent.push({ url, body: JSON.parse(String(init.body)) });
    const answer = Object.entries(answers).find(([suffix]) => url.endsWith(suffix))?.[1];
    const body = answer ?? (url.endsWith('/api/admin/session') ? desk : url.endsWith('/api/admin/registrations') ? { registrations } : {});
    return new Response(JSON.stringify({ success: true, ...body }), { headers: { 'Content-Type': 'application/json' } });
  });
  return sent;
}

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the desk form saves itself', () => {
  it('keeps what was typed as a draft: a reload loses nothing, and Clear removes it', async () => {
    api([]);
    const first = render(<AdminApp />);
    fireEvent.click(await screen.findByRole('button', { name: '+ New registration' }));
    let dialog = screen.getByRole('dialog', { name: 'New registration' });
    fireEvent.change(within(dialog).getByLabelText('Name with initial'), { target: { value: 'Kavin S' } });
    fireEvent.change(within(dialog).getByLabelText(/^Phone/), { target: { value: '9840011111' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /COGNIX/ }));
    fireEvent.click(within(dialog).getByRole('radio', { name: 'GPay / UPI' }));
    expect(within(dialog).getByText(/Draft saved/)).toBeInTheDocument();

    // The page reloads (or the window was closed): the form comes back as it was.
    first.unmount();
    render(<AdminApp />);
    fireEvent.click(await screen.findByRole('button', { name: '+ New registration' }));
    dialog = screen.getByRole('dialog', { name: 'New registration' });
    expect(within(dialog).getByText(/Restored the form you were filling in/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Name with initial')).toHaveValue('Kavin S');
    expect(within(dialog).getByLabelText(/^Phone/)).toHaveValue('9840011111');
    expect(within(dialog).getByRole('checkbox', { name: /COGNIX/ })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: 'GPay / UPI' })).toBeChecked();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));
    expect(within(dialog).getByLabelText('Name with initial')).toHaveValue('');
    expect(localStorage.getItem('pragya-desk-draft:desk1')).toBeNull();
  });
});

describe('a desk GPay paid from Student login', () => {
  it('registers the student first, then waits for their screenshot on the same screen', async () => {
    const sent = api([], { '/api/admin/onsite': { registration: { ...pending, proofs: [] }, replayed: false } });
    render(<AdminApp />);
    fireEvent.click(await screen.findByRole('button', { name: '+ New registration' }));
    const dialog = screen.getByRole('dialog', { name: 'New registration' });
    const form = within(dialog).getByRole('form', { name: 'New on-site registration' });
    fireEvent.change(within(form).getByLabelText('Name with initial'), { target: { value: 'Kavin S' } });
    fireEvent.click(within(form).getByRole('radio', { name: 'GPay / UPI' }));
    fireEvent.submit(form);

    const waiting = await screen.findByRole('dialog', { name: 'Registered: GPay payment next' });
    expect(sent.find((call) => call.url === '/api/admin/onsite')?.body).toMatchObject({ payment: { method: 'UPI', studentPays: true } });
    // The ID in its parts (26 · 2 · 005), with what they mean.
    expect(waiting.querySelector('.adm-success__id')).toHaveTextContent(/^262005$/);
    expect(within(waiting).getAllByText('26').length).toBeGreaterThan(0);
    expect(within(waiting).getByText('2026 · registration desk · participant 5')).toBeInTheDocument();
    expect(within(waiting).getByRole('list', { name: 'What the student does' })).toHaveTextContent(/Sign in with Registration ID 262005 and phone 9840011111/);
    expect(within(waiting).getByText("Waiting for the student's screenshot…")).toBeInTheDocument();
    expect(within(waiting).getByRole('button', { name: 'Approve payment' })).toBeDisabled();
    // Registered: the draft is gone.
    expect(localStorage.getItem('pragya-desk-draft:desk1')).toBeNull();
  });

  it('approves on the waiting screen, then shows the ID without any pass button (the pass is the student’s)', async () => {
    api([], {
      '/api/admin/onsite': { registration: pending, replayed: false },
      '/proofs/abc123def456': { url: 'https://bucket.s3.test/proofs/262005/abc123def456.png' },
      '/approve': { registration: approved },
    });
    render(<AdminApp />);
    fireEvent.click(await screen.findByRole('button', { name: '+ New registration' }));
    const form = within(screen.getByRole('dialog', { name: 'New registration' })).getByRole('form', { name: 'New on-site registration' });
    fireEvent.click(within(form).getByRole('radio', { name: 'GPay / UPI' }));
    fireEvent.submit(form);
    const waiting = await screen.findByRole('dialog', { name: 'Registered: GPay payment next' });
    expect(await within(waiting).findByRole('img', { name: 'GPay payment screenshot for 262005' })).toBeInTheDocument();
    fireEvent.click(within(waiting).getByRole('checkbox', { name: /I have checked the screenshot/ }));
    fireEvent.click(within(waiting).getByRole('button', { name: 'Approve payment' }));

    const done = await screen.findByRole('dialog', { name: 'Registered' });
    expect(done.querySelector('.adm-success__id')).toHaveTextContent(/^262005$/);
    expect(within(done).getByText(/No pass for desk registrations: the student shows this Registration ID at each event/)).toBeInTheDocument();
    expect(within(done).queryByRole('button', { name: /Download pass/ })).toBeNull();
    expect(within(done).getByRole('button', { name: 'Register the next student' })).toBeInTheDocument();
  });

  it('shows the student’s screenshot big and approves it with the transaction ID typed from it', async () => {
    const sent = api([pending], {
      '/proofs/abc123def456': { url: 'https://bucket.s3.test/proofs/262005/abc123def456.png' },
      '/approve': { registration: approved },
    });
    render(<AdminApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verify GPay' }));
    const record = screen.getByRole('dialog', { name: /262005 · Kavin S/ });
    const shot = await within(record).findByRole('img', { name: 'GPay payment screenshot for 262005' });
    expect(shot).toHaveAttribute('src', 'https://bucket.s3.test/proofs/262005/abc123def456.png');
    // Zoom in to read it.
    fireEvent.click(within(record).getByRole('button', { name: 'Zoom in' }));
    expect(within(record).getByRole('button', { name: 'Make smaller' })).toBeInTheDocument();

    const utr = within(record).getByLabelText(/Transaction ID from the screenshot/);
    expect(utr).toHaveValue('UTR44556677');
    const approve = within(record).getByRole('button', { name: 'Approve payment' });
    expect(approve).toBeDisabled();
    fireEvent.change(utr, { target: { value: 'utr 4455 6677' } });
    fireEvent.click(within(record).getByRole('checkbox', { name: /I have checked the screenshot: ₹100 was paid to Mrs Jayanthi Parthasarathy/ }));
    fireEvent.click(approve);

    expect(await within(record).findByText(/₹100 · GPay at desk · verified by desk1/)).toBeInTheDocument();
    expect(within(record).queryByRole('button', { name: /Download pass/ })).toBeNull();
    expect(sent.find((call) => call.url.endsWith('/approve'))).toEqual({ url: '/api/admin/registrations/262005/approve', body: { payment: { method: 'UPI', reference: 'UTR44556677' } } });
  });
});

describe('one phone number, one registration', () => {
  it('says at once, while typing, that a phone or email is already registered, and offers that registration instead', async () => {
    api([pending]);
    render(<AdminApp />);
    expect(await screen.findByRole('button', { name: '262005' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ New registration' }));
    const dialog = screen.getByRole('dialog', { name: 'New registration' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Cash' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /I have received ₹100 in cash/ }));
    const register = within(dialog).getByRole('button', { name: 'Register and record ₹100' });
    expect(register).toBeEnabled();

    // The same number however it is typed.
    fireEvent.change(within(dialog).getByLabelText(/^Phone/), { target: { value: '+91 98400 11111' } });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('This phone number is already registered: 262005 · Kavin S.');
    expect(register).toBeDisabled();
    expect(within(dialog).getByText(/Already registered as 262005/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^Phone/), { target: { value: '9840022222' } });
    expect(register).toBeEnabled();
    fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: ' KAVIN@example.com ' } });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('This email is already registered: 262005 · Kavin S.');
    expect(register).toBeDisabled();

    // Open that registration instead (the typed form stays as a draft).
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open 262005' }));
    expect(await screen.findByRole('dialog', { name: /262005 · Kavin S/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'New registration' })).toBeNull();
    expect(localStorage.getItem('pragya-desk-draft:desk1')).toContain('9840022222');
  });
});

describe('payments in the record', () => {
  it('shows each payment with the student’s screenshot and transaction ID, the one entered when approving, and who approved it', async () => {
    const withRecords: AdminRegistration = {
      ...approved,
      payments: [
        {
          kind: 'GATE_PASS',
          label: 'Gate pass ₹100',
          amount: 100,
          status: 'PAID',
          method: 'UPI',
          screenshot: { source: 'STUDENT_LOGIN', proofId: 'abc123def456', uploadedAt: '2026-10-17T04:05:00.000Z' },
          uploadedBy: 'Kavin S',
          studentTransactionId: 'UTR44556677',
          approvedTransactionId: 'UTR44556677',
          approvedBy: 'desk1',
          approvedAt: '2026-10-17T04:06:00.000Z',
          approvedAtDesk: null,
        },
        {
          kind: 'cognix',
          label: 'COGNIX ₹50',
          amount: 50,
          status: 'PAID',
          method: 'CASH',
          screenshot: null,
          uploadedBy: null,
          studentTransactionId: null,
          approvedTransactionId: null,
          approvedBy: 'cognix-lead',
          approvedAt: '2026-10-17T06:00:00.000Z',
          approvedAtDesk: null,
        },
      ],
    };
    api([withRecords], { '/proofs/abc123def456': { url: 'https://bucket.s3.test/proofs/262005/abc123def456.png' } });
    render(<AdminApp />);
    fireEvent.click(await screen.findByRole('button', { name: '262005' }));
    const record = screen.getByRole('dialog', { name: /262005 · Kavin S/ });
    const gate = within(record).getByRole('article', { name: 'Gate pass ₹100 payment' });
    expect(gate).toHaveTextContent('Uploaded by the student, Kavin S, from Student login');
    expect(gate).toHaveTextContent('Transaction ID typed by the studentUTR44556677');
    expect(gate).toHaveTextContent("UTR44556677by desk1Matches the student's");
    fireEvent.click(within(gate).getByRole('button', { name: 'View' }));
    expect(await within(gate).findByRole('img', { name: 'Gate pass ₹100 screenshot for 262005' })).toBeInTheDocument();
    const cash = within(record).getByRole('article', { name: 'COGNIX ₹50 payment' });
    expect(cash).toHaveTextContent('None: paid in cash');
    expect(cash).toHaveTextContent('Received bycognix-lead');
    // Shown once: not again under other screenshots.
    expect(within(record).queryByText('Other screenshots from the student')).toBeNull();
  });
});
