import type { SiteInfo } from './types';

/**
 * Site-wide details for PRAGYA 2026.
 *
 * Fields set to null or [] are hidden on the page until you fill them in.
 */
export const site: SiteInfo = {
  name: 'PRAGYA',
  year: '2026',
  institution: 'R P Sarathy Institute of Technology, Salem',
  department: 'Artificial Intelligence and Data Science',
  tagline: 'An AI & technology symposium',
  college: {
    name: 'R P Sarathy Institute of Technology',
    status: 'An Autonomous Institution',
    address: 'Salem–Bengaluru Highway NH-7, Poosaripatty, Kadayampatty Taluk, Salem – 636305, Tamil Nadu',
    // Add lines here to list phone numbers under the address, e.g.
    // { label: 'Admin Office', numbers: ['93449 72274'] }
    phones: [],
    website: 'https://www.rpsit.ac.in/',
    credentials: ['Autonomous', 'NAAC A++', 'AICTE approved', 'Anna University affiliated', 'TNEA code 2639'],
    map: {
      url: 'https://www.google.com/maps/place/R+P+Sarathy+Institute+of+Technology+(RPSIT)/@11.840077,78.0593857,17.25z/data=!4m6!3m5!1s0x3bac0774aec4f655:0x401a09980cc60391!8m2!3d11.840016!4d78.0594858!16s%2Fg%2F11f8fyp3zb',
      embedUrl:
        'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d1500!2d78.0594858!3d11.840016!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3bac0774aec4f655%3A0x401a09980cc60391!2sR%20P%20Sarathy%20Institute%20of%20Technology%20(RPSIT)!5e0!3m2!1sen!2sin!4v1759730000000!5m2!1sen!2sin',
    },
  },

  dates: '17 October 2026',
  venue: null,
  registration: {
    // The registration API's route (AWS Lambda; its address comes from the Amplify build, see
    // the README). Set to null to switch online registration off.
    endpoint: '/api/register',
    // The hero countdown runs to this moment (IST); after it, registration shows as closed.
    closesAt: '2026-10-16T23:59:00',
    deadline: '16 October 2026, 11:59 PM IST',
    // The event day (IST): the website switches to on-site registration at midnight on
    // 17 October, and on-site registration closes at 11:59 AM that day (the events go on).
    onsite: {
      opensAt: '2026-10-17T00:00:00',
      closesAt: '2026-10-17T11:59:00',
      desk: 'the registration desk at the college',
    },
    note: null,
    gatePassFee: 100,
    eventFee: 50,
    payment: {
      upiId: '9342060452@nyes',
      payee: 'Mrs Jayanthi Parthasarathy',
      qrImage: '/images/upi-qr.jpg',
    },
    fallbackFormUrl: 'https://forms.gle/FXEpHYS2AMrZ8U4c8',
    // Passes are not emailed for now: students download them from the website.
    passByEmail: false,
  },
  // The help desk's numbers show on every page that may need them. Replace with the help desk's own numbers.
  helpDesk: {
    phones: [{ label: 'Help desk', phone: '+91 73582 13736' }],
    // Online only for now (no counter on campus yet).
    where: 'By phone or WhatsApp only, for now: there is no help desk counter on campus',
    hours: '17 October 2026, 8:00 AM to 5:00 PM',
  },
  contacts: [{ name: 'Balajimanikandhaan S.S', role: 'Overall Student Coordinator · III Year AI&DS', phone: '+91 73582 13736' }],
  email: null,
  socials: [
    { label: 'Instagram', url: 'https://www.instagram.com/_rpsit_/', icon: 'instagram' },
    { label: 'College website', url: 'https://www.rpsit.ac.in/', icon: 'website' },
  ],
};
