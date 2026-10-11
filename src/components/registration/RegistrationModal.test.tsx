import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { events } from '../../content/events';
import { site } from '../../content/site';
import { DEPARTMENTS } from '../../lib/registration';
import { EventsSection } from '../events/EventsSection';
import { SiteModalsProvider } from '../modal/SiteModals';
import { RegisterButton } from '../ui/RegisterButton';

const renderWithForm = () =>
  render(
    <SiteModalsProvider>
      <RegisterButton />
    </SiteModalsProvider>,
  );

const openForm = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Register Now' }));
  const dialog = screen.getByRole('dialog', { name: 'PRAGYA 2026 Registration' });
  expect(dialog).toHaveAttribute('open');
  return dialog;
};

const fill = (form: HTMLElement, label: RegExp, value: string) =>
  fireEvent.change(within(form).getByLabelText(label), { target: { value } });

const eventBox = (form: HTMLElement, name: string) => within(form).getByRole('checkbox', { name: new RegExp(`^${name}`) });

const departmentButton = (form: HTMLElement) => within(form).getByRole('button', { name: /^department/i });

/** Opens the Department dropdown and picks an option, as a visitor would with the mouse. */
const chooseDepartment = (form: HTMLElement, department: string) => {
  fireEvent.click(departmentButton(form));
  fireEvent.click(within(form).getByRole('option', { name: department }));
};

/** Opens the College dropdown and picks a college. */
const chooseCollege = (form: HTMLElement, college: string) => {
  fireEvent.click(within(form).getByRole('button', { name: /^college/i }));
  fireEvent.click(within(form).getByRole('option', { name: college }));
};

const optionNames = (form: HTMLElement) =>
  within(within(form).getByRole('listbox')).getAllByRole('option').map((option) => option.textContent);

const fillValidForm = (dialog: HTMLElement) => {
  fill(dialog, /name with initial/i, 'Barath S');
  chooseDepartment(dialog, 'Artificial Intelligence and Data Science (AI & DS)');
  fill(dialog, /year of study/i, '3rd Year');
  chooseCollege(dialog, 'R P Sarathy Institute of Technology, Salem');
  fill(dialog, /phone number/i, '93449 72274');
  fill(dialog, /email id/i, 'barath@example.com');
  fireEvent.click(eventBox(dialog, 'CODE FLEX'));
  fireEvent.click(eventBox(dialog, 'COGNIX'));
  fireEvent.change(within(dialog).getByLabelText(/payment screenshot/i), {
    target: { files: [new File(['png'], 'gpay.png', { type: 'image/png' })] },
  });
  fill(dialog, /transaction id/i, '412345678901');
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Answers like the registration API and S3: an upload ticket, the screenshot upload, and
 * `body` for the registration itself.
 */
const respondWith = (body: unknown, status = 200) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/api/uploads')) {
      return json({ success: true, uploadId: '0f8fad5b-d9cb-469f-a165-70867728950e', url: 'https://bucket.s3.test/', fields: { key: 'uploads/x' } });
    }
    if (url === 'https://bucket.s3.test/') return new Response(null, { status: 204 });
    return json(body, status);
  });

const registerCall = (fetchSpy: ReturnType<typeof respondWith>) =>
  fetchSpy.mock.calls.find(([url]) => String(url).endsWith('/api/register')) as [string, RequestInit] | undefined;

/** The live summary's three figures and the grand total. */
const summaryOf = (form: HTMLElement) => {
  const summary = within(form).getByRole('heading', { name: 'Event Registration Summary' }).parentElement as HTMLElement;
  const value = (term: string) => within(summary).getByText(term).nextElementSibling?.textContent;
  return {
    count: value('Selected events'),
    fee: value('Event fee'),
    eventTotal: value('Total event fee'),
    grandTotal: summary.querySelector('.reg-fees__grand strong')?.textContent,
  };
};

const original = { closesAt: site.registration.closesAt, onsite: { ...site.registration.onsite } };

/** Sets the whole schedule, so a test never depends on today's date. */
const scheduleAt = (closesAt: string, opensAt: string, onsiteClosesAt: string) => {
  site.registration.closesAt = closesAt;
  site.registration.onsite.opensAt = opensAt;
  site.registration.onsite.closesAt = onsiteClosesAt;
};

// The form tests must not depend on today's date: registration stays open unless a test closes it.
beforeEach(() => {
  scheduleAt('2999-01-01T00:00:00', '2999-01-02T00:00:00', '2999-01-03T00:00:00');
});
afterEach(() => {
  site.registration.closesAt = original.closesAt;
  Object.assign(site.registration.onsite, original.onsite);
  vi.restoreAllMocks();
});

describe('RegistrationModal', () => {
  it('says registration is closed, instead of showing the form, after the event day', () => {
    scheduleAt('2020-01-01T17:00:00', '2020-01-02T00:00:00', '2020-01-03T00:00:00');
    renderWithForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register Now' }));

    const dialog = screen.getByRole('dialog', { name: 'Registration closed' });
    expect(within(dialog).getByText(/closed on 1 January 2020 · 5:00 PM IST/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Submit Registration' })).toBeNull();
    expect(within(dialog).queryByText(/register on-site/i)).toBeNull();
  });

  it('sends visitors to the registration desk on the event day, without the online form or the Google Form', () => {
    scheduleAt('2020-01-01T17:00:00', '2020-01-02T00:00:00', '2999-01-01T00:00:00');
    renderWithForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register Now' }));

    const dialog = screen.getByRole('dialog', { name: 'Online registration closed' });
    expect(within(dialog).getByText('On-site registration is open today')).toBeInTheDocument();
    expect(within(dialog).getByText(/Pay the ₹100 gate pass there in cash or by UPI, then ₹50 for each event/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Submit Registration' })).toBeNull();
    expect(within(dialog).queryByRole('link', { name: 'Google Form' })).toBeNull();
  });

  it('says when the desk opens in the minute between online and on-site registration', () => {
    scheduleAt('2020-01-01T17:00:00', '2999-01-01T00:00:00', '2999-01-02T00:00:00');
    renderWithForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register Now' }));

    const dialog = screen.getByRole('dialog', { name: 'Online registration closed' });
    expect(within(dialog).getByText(/On-site registration opens on 1 January 2999 · 12:00 AM IST/)).toBeInTheDocument();
  });

  it('refuses a submission if registration closes while the form is open', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderWithForm();
    const dialog = openForm();
    fillValidForm(dialog);

    scheduleAt('2020-01-01T17:00:00', '2020-01-02T00:00:00', '2999-01-01T00:00:00');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit Registration' }));

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Online registration for PRAGYA 2026 closed');
    expect(within(dialog).queryByRole('heading', { name: 'Registration Successfully Completed!' })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('opens on the page in order: details, events, payment', () => {
    renderWithForm();
    const dialog = openForm();

    const legends = within(dialog).getAllByRole('group').filter((group) => group.tagName === 'FIELDSET');
    expect(legends.map((group) => group.querySelector('legend')?.textContent)).toEqual([
      '1Participant details',
      '2Select Events *',
      '3Gate Pass Payment',
    ]);
    expect(within(dialog).getByRole('group', { name: /^technical events/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole('group', { name: /^non-technical events/i })).toBeNull();
    expect(window.location.hash).toBe('');
  });

  it('lists exactly the five technical events as checkboxes', () => {
    renderWithForm();
    const dialog = openForm();

    const technical = within(dialog).getByRole('group', { name: /^technical events/i });
    expect(within(technical).getAllByRole('checkbox')).toHaveLength(5);
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(5);
    for (const name of ['PRO-PITCH', 'VIZ CRAFT', 'PAPER PRESENTATION', 'CODE FLEX', 'COGNIX']) {
      expect(eventBox(dialog, name)).toBeInTheDocument();
    }
    expect(within(dialog).queryByRole('checkbox', { name: /SHORT FILM|E-SPORTS|BRAND IT/ })).toBeNull();
    expect(within(dialog).queryAllByRole('radio')).toHaveLength(0);
  });

  it('updates the event fee and total instantly as events are selected and deselected', () => {
    renderWithForm();
    const dialog = openForm();

    expect(summaryOf(dialog)).toEqual({ count: '0', fee: '₹50 × 0', eventTotal: '₹0', grandTotal: '= ₹100' });

    fireEvent.click(eventBox(dialog, 'PRO-PITCH'));
    expect(summaryOf(dialog)).toEqual({ count: '1', fee: '₹50 × 1', eventTotal: '₹50', grandTotal: '= ₹150' });

    fireEvent.click(eventBox(dialog, 'VIZ CRAFT'));
    fireEvent.click(eventBox(dialog, 'CODE FLEX'));
    fireEvent.click(eventBox(dialog, 'COGNIX'));
    expect(summaryOf(dialog)).toEqual({ count: '4', fee: '₹50 × 4', eventTotal: '₹200', grandTotal: '= ₹300' });
    expect(within(dialog).getByText(/You have selected 4 events\. The event registration fee is ₹200\. Kindly bring ₹200/)).toBeInTheDocument();

    fireEvent.click(eventBox(dialog, 'VIZ CRAFT'));
    expect(summaryOf(dialog)).toEqual({ count: '3', fee: '₹50 × 3', eventTotal: '₹150', grandTotal: '= ₹250' });
    expect(within(dialog).getByText(/You have selected 3 events\. The event registration fee is ₹150/)).toBeInTheDocument();

    for (const event of events) {
      if (!(eventBox(dialog, event.name) as HTMLInputElement).checked) fireEvent.click(eventBox(dialog, event.name));
    }
    expect(summaryOf(dialog)).toEqual({ count: '5', fee: '₹50 × 5', eventTotal: '₹250', grandTotal: '= ₹350' });
  });

  it('keeps everything typed so far when events are ticked and unticked afterwards', () => {
    renderWithForm();
    const dialog = openForm();
    fill(dialog, /name with initial/i, 'Barath S');
    fill(dialog, /email id/i, 'barath@example.com');

    fireEvent.click(eventBox(dialog, 'COGNIX'));
    fill(dialog, /phone number/i, '93449 72274');
    fireEvent.click(eventBox(dialog, 'VIZ CRAFT'));
    fireEvent.click(eventBox(dialog, 'COGNIX'));

    expect(within(dialog).getByLabelText(/name with initial/i)).toHaveValue('Barath S');
    expect(within(dialog).getByLabelText(/email id/i)).toHaveValue('barath@example.com');
    expect(within(dialog).getByLabelText(/phone number/i)).toHaveValue('93449 72274');
    expect(eventBox(dialog, 'COGNIX')).not.toBeChecked();
    expect(eventBox(dialog, 'VIZ CRAFT')).toBeChecked();
    expect(summaryOf(dialog).count).toBe('1');
  });

  it('blocks submission without an event and says why', () => {
    renderWithForm();
    const dialog = openForm();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit Registration' }));

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Please fix the 9 highlighted fields');
    expect(within(dialog).getAllByText('Please select at least one event to continue.').length).toBeGreaterThan(0);
    expect(document.activeElement).toBe(within(dialog).getByLabelText(/name with initial/i));
  });

  it('does not flag an untouched empty field just because focus left it', () => {
    renderWithForm();
    const dialog = openForm();
    const name = within(dialog).getByLabelText(/name with initial/i);

    fireEvent.blur(name);
    expect(name).not.toHaveAttribute('aria-invalid');

    fireEvent.change(name, { target: { value: 'Barath' } });
    fireEvent.blur(name);
    expect(within(dialog).getByText('Add your initial, e.g. Varshan C.')).toBeInTheDocument();
  });

  it('previews the payment screenshot and rejects files that are not images', () => {
    renderWithForm();
    const dialog = openForm();
    const upload = within(dialog).getByLabelText(/payment screenshot/i);

    fireEvent.change(upload, { target: { files: [new File(['%PDF'], 'receipt.pdf', { type: 'application/pdf' })] } });
    expect(within(dialog).getByText('The screenshot must be an image (PNG or JPG).')).toBeInTheDocument();

    fireEvent.change(upload, { target: { files: [new File(['png'], 'gpay.png', { type: 'image/png' })] } });
    expect(
      within(dialog).getByRole('img', { name: 'Preview of your payment screenshot' }).getAttribute('src'),
    ).toMatch(/^blob:/);
    expect(within(dialog).getByText('gpay.png')).toBeInTheDocument();
  });

  it('pre-selects the event whose Register Now button opened it', () => {
    const { container } = render(
      <SiteModalsProvider>
        <EventsSection category="technical" title="Technical events" lead="" />
      </SiteModalsProvider>,
    );

    // Open the VIZ CRAFT panel, then its Register Now.
    fireEvent.click(container.querySelector('#event-viz-craft')!);
    fireEvent.click(screen.getByRole('button', { name: 'Register Now for VIZ CRAFT' }));
    const dialog = screen.getByRole('dialog', { name: 'PRAGYA 2026 Registration' });
    expect(eventBox(dialog, 'VIZ CRAFT')).toBeChecked();
    expect(summaryOf(dialog).eventTotal).toBe('₹50');
  });

  it('says the registration is submitted and pending verification, with no pass before approval', async () => {
    const fetchSpy = respondWith({ success: true, registrationId: 'PRG26-0042', status: 'PENDING', registeredAt: '2026-10-10T06:30:00.000Z' });
    renderWithForm();
    const dialog = openForm();
    fillValidForm(dialog);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit Registration' }));
    expect(within(dialog).getByRole('button', { name: 'Submitting…' })).toBeInTheDocument();

    await waitFor(() => expect(within(dialog).getByRole('heading', { name: 'Registration Submitted' })).toBeInTheDocument());
    expect(within(dialog).getByText('PRG26-0042')).toBeInTheDocument();
    expect(within(dialog).getByText('Pending verification')).toBeInTheDocument();
    expect(within(dialog).getByText('Your registration details and payment screenshot have been received.')).toBeInTheDocument();
    // Passes are not emailed for now: the student downloads it from the website once approved.
    expect(within(dialog).getByText(/Once it is approved, download your participant pass \(PDF\) from this website: open Student login/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Passes are not sent by email/)).toBeInTheDocument();
    expect(within(dialog).getByText('412345678901')).toBeInTheDocument();
    expect(within(dialog).getByText('CODE FLEX · COGNIX')).toBeInTheDocument();
    expect(within(dialog).getByText(/Kindly bring ₹100 for your 2 events/)).toBeInTheDocument();
    // Nothing to download before an organiser approves; a private link to check later instead.
    expect(within(dialog).queryByRole('button', { name: /download/i })).toBeNull();
    expect((within(dialog).getByLabelText('Your private status link') as HTMLInputElement).value).toMatch(
      /#status=PRG26-0042\.[0-9a-f]{32}$/,
    );

    const [url, init] = registerCall(fetchSpy)!;
    expect(url).toBe('/api/register');
    const body = JSON.parse(String(init.body));
    expect(body.upload).toEqual({ id: '0f8fad5b-d9cb-469f-a165-70867728950e' });
    expect(body.participant.department).toBe('Artificial Intelligence and Data Science (AI & DS)');
    expect(body.events).toEqual(['code-flex', 'cognix']);
    expect(body.submissionId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("keeps the form and shows the server's message when the registration is not saved", async () => {
    respondWith(
      { success: false, error: "We couldn't save your registration right now. Please try again in a few minutes.", code: 'STORAGE_FAILED' },
      502,
    );
    renderWithForm();
    const dialog = openForm();
    fillValidForm(dialog);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit Registration' }));

    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent("We couldn't save your registration"));
    expect(within(dialog).queryByRole('heading', { name: 'Registration Submitted' })).toBeNull();
    expect(within(dialog).getByLabelText(/name with initial/i)).toHaveValue('Barath S');
  });

  it('marks the fields the server rejects', async () => {
    respondWith(
      {
        success: false,
        error: 'This transaction ID has already been used for a registration.',
        code: 'DUPLICATE_TRANSACTION',
        fieldErrors: { transactionId: 'This transaction ID has already been used for a registration.' },
      },
      409,
    );
    renderWithForm();
    const dialog = openForm();
    fillValidForm(dialog);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit Registration' }));

    const transactionId = within(dialog).getByLabelText(/transaction id/i);
    await waitFor(() => expect(transactionId).toHaveAttribute('aria-invalid', 'true'));
    expect(within(dialog).getByText('This transaction ID has already been used for a registration.')).toBeInTheDocument();
    expect(document.activeElement).toBe(transactionId);
  });
});

describe('Department dropdown', () => {
  it('starts empty with the placeholder and lists all 23 departments in order', () => {
    renderWithForm();
    const dialog = openForm();

    expect(departmentButton(dialog)).toHaveTextContent('Select your department');
    expect(departmentButton(dialog)).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(departmentButton(dialog));
    expect(departmentButton(dialog)).toHaveAttribute('aria-expanded', 'true');
    expect(optionNames(dialog)).toEqual([...DEPARTMENTS]);
    expect(within(within(dialog).getByRole('listbox')).queryAllByRole('option', { selected: true })).toHaveLength(0);
  });

  it.each([
    'Computer Science and Engineering (CSE)',
    'Artificial Intelligence and Data Science (AI & DS)',
    'Artificial Intelligence and Machine Learning (AI & ML)',
    'Computer Science and Engineering (Cyber Security)',
  ])('selects %s, closes, and shows it in the field', (department) => {
    renderWithForm();
    const dialog = openForm();

    chooseDepartment(dialog, department);

    expect(departmentButton(dialog)).toHaveTextContent(department);
    expect(within(dialog).queryByRole('listbox')).toBeNull();
    expect(within(dialog).queryByLabelText(/please specify your department/i)).toBeNull();

    fireEvent.click(departmentButton(dialog));
    expect(within(within(dialog).getByRole('listbox')).getByRole('option', { selected: true })).toHaveTextContent(department);
  });

  it.each([
    ['CSE', ['Computer Science and Engineering (CSE)']],
    ['AI', ['Artificial Intelligence and Data Science (AI & DS)', 'Artificial Intelligence and Machine Learning (AI & ML)']],
    ['Data Science', ['Artificial Intelligence and Data Science (AI & DS)']],
    ['ECE', ['Electronics and Communication Engineering (ECE)']],
    ['Mechanical', ['Mechanical Engineering']],
    ['cyber', ['Computer Science and Engineering (Cyber Security)', 'Cyber Security']],
    ['Biotechnology', ['Biotechnology']],
  ])('search %j keeps the matching departments in their order', (query, expected) => {
    renderWithForm();
    const dialog = openForm();
    fireEvent.click(departmentButton(dialog));

    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Search departments' }), { target: { value: query } });
    expect(optionNames(dialog)).toEqual(expected);
  });

  it('says when the search matches nothing', () => {
    renderWithForm();
    const dialog = openForm();
    fireEvent.click(departmentButton(dialog));

    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Search departments' }), { target: { value: 'zzz' } });
    expect(within(within(dialog).getByRole('listbox')).queryAllByRole('option')).toHaveLength(0);
    expect(within(dialog).getByRole('status')).toHaveTextContent('No department matches “zzz”');
  });

  it('works from the keyboard: arrows to open and move, Enter to choose, Esc to close', () => {
    renderWithForm();
    const dialog = openForm();
    const button = departmentButton(dialog);

    button.focus();
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(within(dialog).getByRole('listbox')).toBeInTheDocument();

    const list = document.activeElement as HTMLElement;
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(button).toHaveTextContent('Artificial Intelligence and Machine Learning (AI & ML)');
    expect(document.activeElement).toBe(button);

    fireEvent.keyDown(button, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(within(dialog).queryByRole('listbox')).toBeNull();
    expect(button).toHaveTextContent('Artificial Intelligence and Machine Learning (AI & ML)');
    expect(dialog).toHaveAttribute('open');
  });

  it('closes without choosing when the visitor taps elsewhere', () => {
    renderWithForm();
    const dialog = openForm();
    fireEvent.click(departmentButton(dialog));

    fireEvent.pointerDown(within(dialog).getByLabelText(/name with initial/i));
    expect(within(dialog).queryByRole('listbox')).toBeNull();
    expect(departmentButton(dialog)).toHaveTextContent('Select your department');
  });

  it('asks for the department when none is chosen', () => {
    renderWithForm();
    const dialog = openForm();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit Registration' }));
    expect(within(dialog).getByText('Please select your department.')).toBeInTheDocument();
    expect(departmentButton(dialog)).toHaveAttribute('aria-invalid', 'true');

    chooseDepartment(dialog, 'Civil Engineering');
    expect(within(dialog).queryByText('Please select your department.')).toBeNull();
  });

  it('shows a required "Please specify" field for Other, and clears it when another department is chosen', async () => {
    const fetchSpy = respondWith({ success: true, registrationId: 'PRG26-0050', status: 'PENDING', registeredAt: '2026-10-10T06:30:00.000Z' });
    renderWithForm();
    const dialog = openForm();
    fillValidForm(dialog);

    chooseDepartment(dialog, 'Other');
    const specify = within(dialog).getByLabelText(/please specify your department/i);
    expect(specify).toHaveAttribute('placeholder', 'Enter your department');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit Registration' }));
    expect(within(dialog).getByText('Please specify your department.')).toBeInTheDocument();
    expect(document.activeElement).toBe(specify);
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.change(specify, { target: { value: 'Robotics and Automation Engineering' } });
    chooseDepartment(dialog, 'Mechanical Engineering');
    expect(within(dialog).queryByLabelText(/please specify your department/i)).toBeNull();

    chooseDepartment(dialog, 'Other');
    expect(within(dialog).getByLabelText(/please specify your department/i)).toHaveValue('');
    fireEvent.change(within(dialog).getByLabelText(/please specify your department/i), {
      target: { value: 'Robotics and Automation Engineering' },
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit Registration' }));
    await waitFor(() => expect(registerCall(fetchSpy)).toBeDefined());
    const body = JSON.parse(String(registerCall(fetchSpy)![1].body));
    expect(body.participant.department).toBe('Robotics and Automation Engineering');
  });
});

describe('Registration window lock', () => {
  it('stays open when the file chooser is closed without picking a file', () => {
    renderWithForm();
    const dialog = openForm();
    const upload = within(dialog).getByLabelText(/payment screenshot/i);

    // Browsers fire a bubbling `cancel` at the file input when its chooser is dismissed.
    upload.dispatchEvent(new Event('cancel', { bubbles: true }));
    expect(dialog).toHaveAttribute('open');
  });

  it('keeps the chosen screenshot when the chooser is cancelled from "Change image"', () => {
    renderWithForm();
    const dialog = openForm();
    const upload = within(dialog).getByLabelText(/payment screenshot/i);
    fireEvent.change(upload, { target: { files: [new File(['png'], 'gpay.png', { type: 'image/png' })] } });

    fireEvent.change(upload, { target: { files: [] } });
    expect(within(dialog).getByText('gpay.png')).toBeInTheDocument();
  });

  it('ignores Esc and the back gesture; only its own Close button closes it', () => {
    renderWithForm();
    const dialog = openForm();

    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog).toHaveAttribute('open');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(dialog).not.toHaveAttribute('open');
  });

  it('asks before the page is left or reloaded with a half-filled form', () => {
    renderWithForm();
    const dialog = openForm();

    const blank = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(blank);
    expect(blank.defaultPrevented).toBe(false);

    fill(dialog, /name with initial/i, 'Barath S');
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
  });

  it('shows the UPI ID, the payee and the QR code for the gate pass payment', () => {
    renderWithForm();
    const dialog = openForm();

    const { upiId, payee, qrImage } = site.registration.payment;
    expect(within(dialog).getByText(String(upiId))).toBeInTheDocument();
    expect(dialog.textContent).toContain(String(payee));
    expect(within(dialog).getByRole('img', { name: `UPI QR code for ${upiId}` })).toHaveAttribute('src', String(qrImage));
  });

  it('offers the Google Form at the end, for when the site itself fails', () => {
    renderWithForm();
    const dialog = openForm();

    const link = within(dialog).getByRole('link', { name: 'Google Form' });
    expect(link).toHaveAttribute('href', String(site.registration.fallbackFormUrl));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('College dropdown', () => {
  it('lists the host college first, then the colleges around Salem, then the rest of Tamil Nadu, with Other last', () => {
    renderWithForm();
    const dialog = openForm();
    fireEvent.click(within(dialog).getByRole('button', { name: /^college/i }));
    const names = optionNames(dialog);
    expect(names[0]).toBe('R P Sarathy Institute of Technology, Salem');
    expect(names.indexOf('Sona College of Technology, Salem')).toBeLessThan(names.indexOf('P.S.G. College of Technology, Coimbatore'));
    expect(names.indexOf('Kongu Engineering College, Perundurai')).toBeLessThan(names.indexOf('Anna University, College of Engineering Guindy (CEG), Chennai'));
    expect(names.at(-1)).toBe('Other (type your college)');
    expect(names.length).toBeGreaterThan(500);
  });

  it('finds a college from its first few letters or its initials', () => {
    renderWithForm();
    const dialog = openForm();
    fireEvent.click(within(dialog).getByRole('button', { name: /^college/i }));
    const search = within(dialog).getByRole('combobox', { name: 'Search colleges' });

    fireEvent.change(search, { target: { value: 'kongu' } });
    expect(optionNames(dialog)[0]).toBe('Kongu Arts and Science College, Erode');
    expect(optionNames(dialog)).toContain('Kongu Engineering College, Perundurai');

    fireEvent.change(search, { target: { value: 'ksr' } });
    expect(optionNames(dialog).slice(0, 3).every((name) => /^K\.?\s?S\.?\s?R/i.test(name ?? ''))).toBe(true);

    fireEvent.change(search, { target: { value: 'sona' } });
    expect(optionNames(dialog)[0]).toBe('Sona College of Technology, Salem');
  });

  it('lets a college that is not listed be typed in, and sends what was typed', async () => {
    const fetchSpy = respondWith({ success: true, registrationId: '261051', status: 'PENDING', registeredAt: '2026-10-10T06:30:00.000Z' });
    renderWithForm();
    const dialog = openForm();
    fillValidForm(dialog);
    chooseCollege(dialog, 'Other (type your college)');
    const typed = within(dialog).getByLabelText(/type your college name/i);
    expect(typed).toHaveValue('');
    fireEvent.change(typed, { target: { value: 'Model Institute of Technology, Erode' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Submit Registration' }));
    await waitFor(() => expect(registerCall(fetchSpy)).toBeDefined());
    expect(JSON.parse(String(registerCall(fetchSpy)![1].body)).participant.college).toBe('Model Institute of Technology, Erode');
  });
});
