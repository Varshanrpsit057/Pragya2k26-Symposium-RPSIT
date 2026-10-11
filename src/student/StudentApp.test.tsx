import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudentView } from '../lib/student';
import { StudentApp } from './StudentApp';

const view: StudentView = {
  registrationId: '262001',
  name: 'Nila R',
  college: 'Sona College of Technology, Salem',
  status: 'APPROVED',
  source: 'ONSITE',
  teamName: 'Pixel Pair',
  events: [
    { eventId: 'viz-craft', name: 'VIZ CRAFT', team: 'Pixel Pair', feePaid: false, present: false },
    { eventId: 'pro-pitch', name: 'PRO-PITCH', team: null, feePaid: true, present: false },
  ],
  feePerEvent: 50,
  details: { department: 'CSE', year: 'III Year', phone: '9840012345', email: 'nila@example.com' },
  payAtLogin: null,
  passAvailable: true,
  reason: null,
  proofs: [],
};

/** Answers like the API, with student login on or off, and records what is sent. */
function api(enabled: boolean) {
  const sent: { url: string; body: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.body) sent.push({ url, body: JSON.parse(String(init.body)) });
    const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/api/student/portal')) return reply(200, { success: true, enabled });
    if (!enabled) return reply(503, { success: false, code: 'STUDENT_LOGIN_PAUSED', error: 'Student login is paused for a while.' });
    const { phone } = JSON.parse(String(init?.body)) as { phone: string };
    if (phone !== '9840012345') return reply(404, { success: false, code: 'NOT_FOUND', error: 'No registration matches this Registration ID and phone number.' });
    if (url.endsWith('/api/student/pass')) return reply(200, { success: true, url: 'https://bucket.s3.test/passes/262001.pdf' });
    return reply(200, { success: true, ...view });
  });
  return sent;
}

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('student page', () => {
  it('says it is paused while the admins have it off', async () => {
    api(false);
    render(<StudentApp />);
    expect(await screen.findByRole('heading', { name: 'Student login is paused' })).toBeInTheDocument();
    expect(screen.getByText(/registration desks stay fast/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Registration ID')).toBeNull();
  });

  it('signs in with the ID and phone, then shows the pass, the events and the timing alerts', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(Date.parse('2026-10-17T09:00:00+05:30'));
    const sent = api(true);
    render(<StudentApp />);

    fireEvent.change(await screen.findByLabelText('Registration ID'), { target: { value: '262001' } });
    fireEvent.change(screen.getByLabelText('Phone number you registered with'), { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the 10-digit phone number you registered with.');
    expect(sent).toEqual([]);

    fireEvent.change(screen.getByLabelText('Phone number you registered with'), { target: { value: '9840099999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('No registration matches this Registration ID and phone number.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Phone number you registered with'), { target: { value: '9840012345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    // Shown in its parts (26 · 2 · 001), still one number.
    expect(await screen.findByText((_, element) => element?.classList.contains('stu-id__number') === true && element.textContent === '262001')).toHaveTextContent('262001');
    expect(screen.getByText('Gate pass verified')).toBeInTheDocument();

    // Timing alerts for the two events chosen: next, the clash, and the fee still due.
    const alerts = screen.getByRole('heading', { name: 'Timing alerts' }).closest('section')!;
    expect(alerts).toHaveTextContent('Next: VIZ CRAFT (Round 1) at 10:30 AM in Theta Lab (in 1 h 30 min). Be there by 10:00 AM.');
    expect(alerts).toHaveTextContent('VIZ CRAFT and PRO-PITCH run at the same time (Round 1 10:30 AM–11:30 AM, Round 2 12:00 PM–1:00 PM). Attend one first, then move to the other if time allows');
    expect(alerts).toHaveTextContent('Pay ₹50 for VIZ CRAFT: by GPay on this page (below), or in cash to the coordinator at the venue.');

    const events = screen.getByRole('heading', { name: 'Your events (2)' }).closest('section')!;
    expect(events).toHaveTextContent('VIZ CRAFTRound 1: 10:30 AM – 11:30 AM · Round 2: 12:00 PM – 1:00 PM · Theta LabTeam Pixel Pair₹50 to pay (GPay below, or cash at the venue)');
    // Their details, after approval too.
    fireEvent.click(screen.getByText('Your details'));
    expect(screen.getByText('nila@example.com')).toBeVisible();
    expect(events).toHaveTextContent('PRO-PITCHRound 1: 10:30 AM – 11:30 AM · Round 2: 12:00 PM – 1:00 PM · Delta Lab₹50 paid');

    // The sign-in stays for this tab only, and the pass link is fetched when asked for.
    expect(JSON.parse(sessionStorage.getItem('pragya-student')!)).toEqual({ registrationId: '262001', phone: '9840012345' });
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    fireEvent.click(screen.getByRole('button', { name: 'Download your pass (PDF)' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://bucket.s3.test/passes/262001.pdf'));
    vi.unstubAllGlobals();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByLabelText('Registration ID')).toBeInTheDocument();
    expect(sessionStorage.getItem('pragya-student')).toBeNull();
  });

  it('signs in again from the tab’s saved sign-in after a reload', async () => {
    api(true);
    sessionStorage.setItem('pragya-student', JSON.stringify({ registrationId: '262001', phone: '9840012345' }));
    render(<StudentApp />);
    // Shown in its parts (26 · 2 · 001), still one number.
    expect(await screen.findByText((_, element) => element?.classList.contains('stu-id__number') === true && element.textContent === '262001')).toHaveTextContent('262001');
  });
});

describe('event fees by GPay on the student page', () => {
  it('pays with the same QR, then sends the screenshot to the event’s coordinator', async () => {
    sessionStorage.setItem('pragya-student', JSON.stringify({ registrationId: '262001', phone: '9840012345' }));
    const calls: string[] = [];
    const proofSent: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push(url);
      const reply = (body: object) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
      if (url.endsWith('/api/student/upload')) return reply({ success: true, uploadId: '0b5c1f3e-1111-4222-8333-444455556666', url: 'https://bucket.s3.test/', fields: { key: 'uploads/x' } });
      if (url === 'https://bucket.s3.test/') return new Response(null, { status: 204 });
      if (url.endsWith('/api/student/proof')) {
        proofSent.push(JSON.parse(String(init?.body)));
        return reply({ success: true, ...view, proofs: [{ kind: 'viz-craft', label: 'VIZ CRAFT ₹50', uploadedAt: '2026-10-17T04:30:00.000Z' }] });
      }
      return reply({ success: true, ...view });
    });
    render(<StudentApp />);
    const form = (await screen.findByRole('heading', { name: 'Pay an event fee by GPay' })).closest('form') as HTMLElement;
    // Only the unpaid events (the gate pass is verified, PRO-PITCH is paid).
    expect(within(form).getAllByRole('option').map((option) => option.textContent)).toEqual(['VIZ CRAFT ₹50']);
    // The same QR as the gate pass, and a UPI app on this phone with ₹50 and the event in the note.
    expect(within(form).getByRole('img', { name: /UPI QR code/ })).toHaveAttribute('src', '/images/upi-qr.jpg');
    expect(within(form).getByRole('link', { name: 'Open GPay or another UPI app to pay ₹50' }).getAttribute('href')).toContain('am=50&cu=INR&tn=PRAGYA%20262001%20VIZ%20CRAFT');
    const upload = within(form).getByRole('button', { name: 'Send to the VIZ CRAFT coordinator' });
    expect(upload).toBeDisabled();
    fireEvent.change(within(form).getByLabelText(/Transaction ID \/ UTR/), { target: { value: 'UTR 1234 5678' } });
    const file = new File([new Uint8Array(300)], 'gpay.png', { type: 'image/png' });
    fireEvent.change(within(form).getByLabelText('Screenshot (PNG or JPG)'), { target: { files: [file] } });
    fireEvent.click(upload);
    expect(await screen.findByText('Sent to the VIZ CRAFT coordinator. They approve it at the venue.')).toBeInTheDocument();
    expect(calls.filter((url) => !url.endsWith('/api/student'))).toEqual(['/api/student/upload', 'https://bucket.s3.test/', '/api/student/proof']);
    expect(proofSent[0]).toMatchObject({ registrationId: '262001', kind: 'viz-craft', transactionId: 'UTR12345678', uploadId: '0b5c1f3e-1111-4222-8333-444455556666' });
    expect(form).toHaveTextContent('VIZ CRAFT: screenshot sent, the coordinator approves it at the venue');
    expect(screen.getByText('Screenshot sent: the coordinator approves it')).toBeInTheDocument();
  });
});

describe('a desk registration paying the gate pass by GPay', () => {
  it('checks the details first, then pays, uploads the screenshot and waits for approval, then shows the pass', async () => {
    sessionStorage.setItem('pragya-student', JSON.stringify({ registrationId: '262001', phone: '9840012345' }));
    const toPay: StudentView = { ...view, status: 'PENDING', passAvailable: false, payAtLogin: { amount: 100, screenshotSent: false } };
    let current: StudentView = toPay;
    const proofSent: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const reply = (body: object) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
      if (url.endsWith('/api/student/upload')) return reply({ success: true, uploadId: '0b5c1f3e-1111-4222-8333-444455556666', url: 'https://bucket.s3.test/', fields: { key: 'uploads/x' } });
      if (url === 'https://bucket.s3.test/') return new Response(null, { status: 204 });
      if (url.endsWith('/api/student/proof')) {
        proofSent.push(JSON.parse(String(init?.body)));
        current = { ...toPay, payAtLogin: { amount: 100, screenshotSent: true } };
      }
      return reply({ success: true, ...current });
    });
    render(<StudentApp />);

    // 1. The details the desk typed; nothing else yet (no pass, no payment form).
    expect(await screen.findByRole('heading', { name: 'Check your details' })).toBeInTheDocument();
    expect(screen.getByText('CSE')).toBeInTheDocument();
    expect(screen.getByText('nila@example.com')).toBeInTheDocument();
    expect(screen.getByText('VIZ CRAFT')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download your pass/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Timing alerts' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'My details are correct: continue to payment' }));

    // 2. Pay: the QR, and a UPI app on this phone with the amount filled in.
    expect(screen.getByRole('heading', { name: 'Pay ₹100 by GPay' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /UPI QR code/ })).toHaveAttribute('src', '/images/upi-qr.jpg');
    expect(screen.getByRole('link', { name: /Open GPay or another UPI app/ }).getAttribute('href')).toMatch(/^upi:\/\/pay\?pa=9342060452@nyes&pn=Mrs%20Jayanthi%20Parthasarathy&am=100&cu=INR&tn=PRAGYA%20262001$/);

    // 3. The screenshot, submitted for approval.
    const submit = screen.getByRole('button', { name: 'Submit for approval' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Screenshot (PNG or JPG)'), { target: { files: [new File([new Uint8Array(300)], 'gpay.png', { type: 'image/png' })] } });
    fireEvent.change(screen.getByLabelText(/Transaction ID \/ UTR/), { target: { value: 'UTR 4455 6677' } });
    fireEvent.click(submit);
    expect(await screen.findByRole('heading', { name: 'Waiting for approval' })).toBeInTheDocument();
    expect(proofSent[0]).toMatchObject({ registrationId: '262001', kind: 'GATE_PASS', transactionId: 'UTR44556677' });

    // The desk approves: the page moves on to the pass, the events and the alerts.
    current = { ...view, payAtLogin: null };
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(await screen.findByRole('button', { name: 'Download your pass (PDF)' })).toBeInTheDocument();
    expect(screen.getByText('Gate pass verified')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Waiting for approval' })).toBeNull();
  });
});

describe('signing in with a mistyped Registration ID', () => {
  it('says when a digit is missing, before asking the server', async () => {
    api(true);
    render(<StudentApp />);
    fireEvent.change(await screen.findByLabelText('Registration ID'), { target: { value: '20001' } });
    fireEvent.change(screen.getByLabelText('Phone number you registered with'), { target: { value: '+916374821177' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A Registration ID has 6 digits, like 262007, but 20001 has only 5. Check for a missing digit.');
  });
});
