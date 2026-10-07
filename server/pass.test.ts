import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { eventCatalog } from '../src/content/eventCatalog';
import { buildRegistrationRecord } from '../src/lib/registration';
import { buildPassPdf, formatIstDateTime, passData, passFileName } from './pass';
import { passLogo } from './passLogo';

const logo = passLogo();
const fees = { gatePass: 100, perEvent: 50 };

const record = (events: string[]) =>
  buildRegistrationRecord(
    {
      name: 'Varshan C',
      department: 'Artificial Intelligence and Data Science (AI & DS)',
      departmentOther: '',
      college: 'R P Sarathy Institute of Technology',
      year: '3rd Year',
      phone: '9344972274',
      email: 'varshan@example.com',
      events,
      transactionId: '412345678901',
    },
    eventCatalog,
    fees,
  );

const passFor = (events: string[]) =>
  passData({ registrationId: 'PRG26-0042', registeredAt: '2026-10-06T14:05:00.000Z', record: record(events), eventIds: events });

describe('participant pass', () => {
  it('lists only the selected events, with the fee worked out from them', () => {
    const pass = passFor(['pro-pitch', 'short-film', 'code-flex']);

    expect(pass.events.map((event) => event.name)).toEqual(['PRO-PITCH', 'CODE FLEX', 'SHORT FILM']);
    expect(pass.amountPaid).toBe(100);
    expect(pass.feePerEvent).toBe(50);
    expect(pass.payableAtVenue).toBe(150);
    expect(pass.events[0]).toMatchObject({ date: '17 October 2026', timing: 'To be announced', type: 'Technical · Team event' });
    expect(pass.events[0].venue).toMatch(/R P Sarathy Institute of Technology/);
  });

  it('shows times in IST', () => {
    expect(formatIstDateTime('2026-10-06T14:05:00.000Z')).toBe('6 October 2026, 7:35 PM IST');
    expect(formatIstDateTime('2026-10-15T18:45:00.000Z')).toBe('16 October 2026, 12:15 AM IST');
  });

  it.each([
    ['one event', ['cognix']],
    ['three events', ['pro-pitch', 'short-film', 'code-flex']],
    ['all ten events', eventCatalog.map((event) => event.id)],
  ])('builds a valid A4 PDF for %s', async (label, events) => {
    const bytes = await buildPassPdf(passFor(events), logo);
    const pdf = await PDFDocument.load(bytes);

    expect(pdf.getTitle()).toBe('PRAGYA 2026 Participant Pass - PRG26-0042');
    const [width, height] = [pdf.getPage(0).getWidth(), pdf.getPage(0).getHeight()];
    expect([Math.round(width), Math.round(height)]).toEqual([595, 842]);
    expect(bytes.length).toBeLessThan(150_000);

    // PASS_PREVIEW_DIR=some/folder saves the PDFs for a look.
    if (process.env.PASS_PREVIEW_DIR) {
      writeFileSync(join(process.env.PASS_PREVIEW_DIR, `pass-${label.replace(/\s+/g, '-')}.pdf`), bytes);
    }
  });

  it('names the file after the Registration ID', () => {
    expect(passFileName('PRG26-0042')).toBe('PRAGYA-2026-Pass-PRG26-0042.pdf');
  });
});
