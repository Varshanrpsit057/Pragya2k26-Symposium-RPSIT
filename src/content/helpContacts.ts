import { site } from './site';

export interface HelpContact {
  name: string;
  role: string;
  phone: string;
}

/**
 * Who a student coordinator calls when the dashboard itself cannot help (the website is down,
 * or Contact admin cannot send). Shown under Contact admin, on the sign-in page too.
 * Add the web assistant team and the admins here, with their phone numbers.
 */
export const HELP_CONTACTS: HelpContact[] = [
  ...site.contacts.flatMap((contact) => (contact.phone ? [{ name: contact.name, role: contact.role ?? 'Student coordinator', phone: contact.phone }] : [])),
];
