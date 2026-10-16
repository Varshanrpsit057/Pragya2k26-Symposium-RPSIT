export interface HelpContact {
  name: string;
  role: string;
  phone: string;
}

/**
 * Who a student coordinator calls (or messages on WhatsApp) when the dashboard itself cannot help
 * (the website is down, or Contact admin cannot send): the web assist team. Shown under Contact
 * admin, on the sign-in page too.
 */
export const HELP_CONTACTS: HelpContact[] = [
  { name: 'Varshan.C', role: 'Web assist team', phone: '+91 63748 21177' },
  { name: 'Barath.S', role: 'Web assist team', phone: '+91 88077 67754' },
];
