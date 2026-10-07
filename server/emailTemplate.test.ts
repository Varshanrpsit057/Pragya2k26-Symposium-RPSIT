import { describe, expect, it } from 'vitest';
import { eventCatalog } from '../src/content/eventCatalog';
import { passData } from './pass';
import { buildRegistrationRecord } from '../src/lib/registration';
import { confirmationEmail } from './emailTemplate';

const events = ['pro-pitch', 'short-film'];
const pass = passData({
  registrationId: 'PRG26-0042',
  registeredAt: '2026-10-06T14:05:00.000Z',
  eventIds: events,
  record: buildRegistrationRecord(
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
    { gatePass: 100, perEvent: 50 },
  ),
});

describe('confirmation email', () => {
  const email = confirmationEmail(pass);

  it('has a plain subject with the Registration ID', () => {
    expect(email.subject).toBe('Your PRAGYA 2026 registration is confirmed (PRG26-0042)');
  });

  it('is a plain-text letter with the details that are personal to this participant', () => {
    expect(email).not.toHaveProperty('html');
    expect(email.text).toContain('Dear Varshan C,');
    expect(email.text).toMatch(/registration for PRAGYA 2026.*is confirmed/);
    expect(email.text).toContain('Registration ID: PRG26-0042');
    expect(email.text).toContain('Events: Pro-Pitch, Short Film');
    expect(email.text).toContain('Date: 17 October 2026');
    expect(email.text).toContain('Department of Artificial Intelligence and Data Science');
    expect(email.text).toContain('R P Sarathy Institute of Technology');
    expect(email.text).toMatch(/participant pass is attached as a PDF/);
    expect(email.text).toMatch(/registration desk/);
    // Real people answer: a reply is welcome.
    expect(email.text).toMatch(/reply to this email/i);
  });

  it('avoids what spam filters flag in payment-style mail', () => {
    for (const body of [email.subject, email.text]) {
      // Unknown sender + payment wording + a PDF is what invoice scams look like.
      expect(body).not.toMatch(/payment|transaction|paid|fee|₹|rs\.|invoice/i);
      expect(body).not.toMatch(/verified|important notice|on the spot|automated|urgent|click|<[a-z]/i);
      // No phone number or transaction ID in the email itself.
      expect(body).not.toMatch(/9344972274|412345678901/);
      // No shouting: no long words in capitals other than the symposium's name.
      expect((body.match(/\b[A-Z]{5,}\b/g) ?? []).filter((word) => word !== 'PRAGYA')).toEqual([]);
    }
  });
});
