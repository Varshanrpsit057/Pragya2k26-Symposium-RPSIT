import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { events } from '../../content/events';
import { site } from '../../content/site';
import { DEPARTMENTS } from '../../lib/registration';
import { EventCard } from '../events/EventCard';
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

const optionNames = (form: HTMLElement) =>
  within(within(form).getByRole('listbox')).getAllByRole('option').map((option) => option.textContent);

const fillValidForm = (dialog: HTMLElement) => {
  fill(dialog, /name with initial/i, 'Barath S');
  chooseDepartment(dialog, 'Artificial Intelligence and Data Science (AI & DS)');
  fill(dialog, /year of study/i, '3rd Year');
  fill(dialog, /^college/i, 'R P Sarathy Institute of Technology');
  fill(dialog, /phone number/i, '93449 72274');
  fill(dialog, /email id/i, 'barath@example.com');
  fireEvent.click(eventBox(dialog, 'COGNIX'));
  fireEvent.click(eventBox(dialog, 'E-SPORTS'));
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

const originalClosesAt = site.registration.closesAt;

// The form tests must not depend on today's date: registration stays open unless a test closes it.
beforeEach(() => {
  site.registration.closesAt = '2999-01-01T00:00:00';
});
afterEach(() => {
  site.registration.closesAt = originalClosesAt;
  vi.restoreAllMocks();
});

describe('RegistrationModal', () => {
  it('says registration is closed, instead of showing the form, after the closing time', () => {
    site.registration.closesAt = '2020-01-01T17:00:00';
    renderWithForm();
    fireEvent.click(screen.getByRole('button', { name: 'Register Now' }));

    const dialog = screen.getByRole('dialog', { name: 'Registration closed' });
    expect(within(dialog).getByText(/closed on 1 January 2020 · 5:00 PM IST/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Submit Registration' })).toBeNull();
  });

  it('refuses a submission if registration closes while the form is open', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderWithForm();
    const dialog = openForm();
    fillValidForm(dialog);

    site.registration.closesAt = '2020-01-01T17:00:00';
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
    expect(within(dialog).getByRole('group', { name: /^non-technical events/i })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });

  it('lists all ten events as checkboxes, five per track', () => {
    renderWithForm();
    const dialog = openForm();

    const technical = within(dialog).getByRole('group', { name: /^technical events/i });
    const nonTechnical = within(dialog).getByRole('group', { name: /^non-technical events/i });
    expect(within(technical).getAllByRole('checkbox')).toHaveLength(5);
    expect(within(nonTechnical).getAllByRole('checkbox')).toHaveLength(5);
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
    fireEvent.click(eventBox(dialog, 'SHORT FILM'));
    expect(summaryOf(dialog)).toEqual({ count: '4', fee: '₹50 × 4', eventTotal: '₹200', grandTotal: '= ₹300' });
    expect(within(dialog).getByText(/You have selected 4 events\. The event registration fee is ₹200\. Kindly bring ₹200/)).toBeInTheDocument();

    fireEvent.click(eventBox(dialog, 'VIZ CRAFT'));
    expect(summaryOf(dialog)).toEqual({ count: '3', fee: '₹50 × 3', eventTotal: '₹150', grandTotal: '= ₹250' });
    expect(within(dialog).getByText(/You have selected 3 events\. The event registration fee is ₹150/)).toBeInTheDocument();

    for (const event of events) {
      if (!(eventBox(dialog, event.name) as HTMLInputElement).checked) fireEvent.click(eventBox(dialog, event.name));
    }
    expect(summaryOf(dialog)).toEqual({ count: '10', fee: '₹50 × 10', eventTotal: '₹500', grandTotal: '= ₹600' });
  });

  it('keeps everything typed so far when events are ticked and unticked afterwards', () => {
    renderWithForm();
    const dialog = openForm();
    fill(dialog, /name with initial/i, 'Barath S');
    fill(dialog, /email id/i, 'barath@example.com');

    fireEvent.click(eventBox(dialog, 'COGNIX'));
    fill(dialog, /phone number/i, '93449 72274');
    fireEvent.click(eventBox(dialog, 'E-SPORTS'));
    fireEvent.click(eventBox(dialog, 'COGNIX'));

    expect(within(dialog).getByLabelText(/name with initial/i)).toHaveValue('Barath S');
    expect(within(dialog).getByLabelText(/email id/i)).toHaveValue('barath@example.com');
    expect(within(dialog).getByLabelText(/phone number/i)).toHaveValue('93449 72274');
    expect(eventBox(dialog, 'COGNIX')).not.toBeChecked();
    expect(eventBox(dialog, 'E-SPORTS')).toBeChecked();
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
    const shortFilm = events.find((event) => event.id === 'short-film')!;
    render(
      <SiteModalsProvider>
        <EventCard event={shortFilm} />
      </SiteModalsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Register Now for SHORT FILM' }));
    const dialog = screen.getByRole('dialog', { name: 'PRAGYA 2026 Registration' });
    expect(eventBox(dialog, 'SHORT FILM')).toBeChecked();
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
    expect(within(dialog).getByText(/confirmed only once it is approved.*participant pass \(PDF\) at barath@example\.com/)).toBeInTheDocument();
    // New sender addresses can land in spam: say where to look.
    expect(within(dialog).getByText(/check your Spam folder/)).toBeInTheDocument();
    expect(within(dialog).getByText('412345678901')).toBeInTheDocument();
    expect(within(dialog).getByText('COGNIX · E-SPORTS')).toBeInTheDocument();
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
    expect(body.events).toEqual(['cognix', 'e-sports']);
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
});
