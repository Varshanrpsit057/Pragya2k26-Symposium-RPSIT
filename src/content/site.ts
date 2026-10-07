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
    closesAt: '2026-10-16T17:00:00',
    deadline: '16 October 2026, 5:00 PM IST',
    note: null,
    gatePassFee: 100,
    eventFee: 50,
    payment: {
      upiId: null,
      payee: null,
      qrImage: null,
    },
  },
  contacts: [],
  email: null,
  socials: [
    { label: 'Instagram', url: 'https://www.instagram.com/_rpsit_/', icon: 'instagram' },
    { label: 'College website', url: 'https://www.rpsit.ac.in/', icon: 'website' },
  ],
};
