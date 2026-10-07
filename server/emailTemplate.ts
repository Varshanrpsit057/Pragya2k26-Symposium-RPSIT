/**
 * The one confirmation email a participant receives, sent only after an organiser approves
 * their registration: a short plain-text letter (fixed template) with the details that are
 * personal to them, and the participant pass attached.
 *
 * Kept out of spam folders by what it leaves out: no payment wording (an unknown sender, a
 * payment and a PDF is what invoice scams look like), no amounts, phone numbers or
 * transaction IDs, no links, banners or words in capitals. It reads like a letter a person
 * wrote and invites a reply.
 */
import { site } from '../src/content/site';
import type { PassData } from './pass';

export function confirmationSubject(registrationId: string): string {
  return `Your ${site.name} ${site.year} registration is confirmed (${registrationId})`;
}

/** 'PRO-PITCH' → 'Pro-Pitch', 'EAGLE EYE CHALLENGE' → 'Eagle Eye Challenge' */
const titleCase = (name: string) => name.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase());

export function confirmationEmail(pass: PassData): { subject: string; text: string } {
  const event = `${site.name} ${site.year}`;
  const college = `${site.college.name}, Salem`;
  const details = [
    `Registration ID: ${pass.registrationId}`,
    `Events: ${pass.events.map((item) => titleCase(item.name)).join(', ')}`,
    site.dates && `Date: ${site.dates}`,
    `Venue: ${site.venue ?? college}`,
  ].filter(Boolean);

  const text = [
    `Dear ${pass.participant.name},`,
    '',
    `Your registration for ${event}, the ${site.tagline.replace(/^An? /i, '')} of the Department of ${site.department}, ${college}, is confirmed. Thank you for registering.`,
    '',
    ...details,
    '',
    'Your participant pass is attached as a PDF. Please show it (printed or on your phone) with your college ID card at the registration desk.',
    '',
    'If any of these details is wrong, just reply to this email. We look forward to seeing you.',
    '',
    'Regards,',
    `${event} Team`,
    `Department of ${site.department}`,
    college,
  ].join('\n');

  return { subject: confirmationSubject(pass.registrationId), text };
}
