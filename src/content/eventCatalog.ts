import type { Person, SymposiumEvent } from './types';

/** An event as listed here; its posters are added in events.ts. */
export type EventEntry = Omit<SymposiumEvent, 'poster' | 'posterLarge'>;

/** The prizes of every technical event (Department event list). */
const TECHNICAL_PRIZES = ['1st prize: ₹1,000', '2nd prize: ₹750', '3rd prize: ₹500', 'Participation certificate for every participant'];

/** Event coordinators are students (the department's event list, final round 1 & 2). */
const student = (name: string): Person => ({ name, role: 'Student coordinator' });

/**
 * The five PRAGYA 2026 events, all technical, without their posters.
 *
 * This list is the only one the website and the registration API accept: the server checks
 * every event id it receives (registration, on-site desk, coordinators) against it, so an
 * event that is not here can never be registered, paid for or marked. Kept apart from the
 * poster images so the server can read the same names the website shows. Edit events here;
 * events.ts adds the posters, and eventInfo.ts holds the See More details.
 *
 * Optional fields (teamSize, venue, schedule, prizes, chiefGuest, coordinators) appear in
 * the event's See More window and on the participant pass as soon as they are set.
 */
export const eventCatalog: EventEntry[] = [
  {
    id: 'pro-pitch',
    name: 'PRO-PITCH',
    subtitle: 'Prompt to App',
    category: 'technical',
    description:
      'Draw an app idea by lucky draw, then bring it to life with AI prompts: a working app, built with tools like ChatGPT, Gemini, Claude and Copilot.',
    icon: 'prompt',
    teamSize: 'Individual or team',
    teams: { maxSize: null },
    venue: 'Delta Lab',
    routeMap: null,
    schedule: 'Round 1: 10:30 AM – 11:30 AM · Round 2: 12:00 PM – 1:00 PM',
    prizes: TECHNICAL_PRIZES,
    chiefGuest: 'Mohan M, CEO, Patora AI & IT Services (chief guest and jury)',
    coordinators: [student('Kabil V'), student('Vaishnavi R')],
  },
  {
    id: 'viz-craft',
    name: 'VIZ CRAFT',
    subtitle: 'AI Data Visualization',
    category: 'technical',
    description:
      'Get a fresh dataset, explore it with AI-assisted tools and turn the numbers into clear visuals and insights that tell its story.',
    icon: 'chart',
    teamSize: 'Individual or up to 2 participants',
    teams: { maxSize: 2 },
    venue: 'Theta Lab',
    routeMap: null,
    schedule: 'Round 1: 10:30 AM – 11:30 AM · Round 2: 12:00 PM – 1:00 PM',
    prizes: TECHNICAL_PRIZES,
    chiefGuest: 'Priya S, Junior Data Analyst, Imagecon Academy, Salem (chief guest and jury)',
    coordinators: [student('Priyanka M'), student('Sakthi P')],
  },
  {
    id: 'paper-presentation',
    name: 'PAPER PRESENTATION',
    category: 'technical',
    description:
      'Take the stage with your research or an innovative technical idea, present it to the judges and defend it in a quick Q&A.',
    icon: 'paper',
    teamSize: 'Individual or team',
    teams: { maxSize: null },
    venue: 'LH-05',
    routeMap: null,
    schedule: '10:30 AM – 12:30 PM',
    prizes: TECHNICAL_PRIZES,
    chiefGuest: 'Mohan, Founder and CEO, Futogen Private Limited (chief guest and jury)',
    coordinators: [student('Kishorerajpriyan M'), student('Prathiksha J')],
  },
  {
    id: 'code-flex',
    name: 'CODE FLEX',
    subtitle: 'Multi-language Coding Challenge',
    category: 'technical',
    description:
      'Solve programming problems in Python, Java, C or C++. No internet, no AI: just your logic, your code and the clock.',
    icon: 'code',
    teamSize: 'Individual',
    venue: 'Delta Lab',
    routeMap: null,
    schedule: 'Round 1: 10:30 AM – 11:30 AM · Round 2: 12:00 PM – 1:00 PM',
    prizes: TECHNICAL_PRIZES,
    chiefGuest: 'Parivarthini, Java Full Stack Developer, Futogen Private Limited (chief guest and jury)',
    coordinators: [student('Krishnakumar S'), student('Roshini V')],
  },
  {
    id: 'cognix',
    name: 'COGNIX',
    subtitle: 'Quiz',
    category: 'technical',
    description:
      'A two-round quiz on artificial intelligence, data science, machine learning, generative AI and the latest in tech news.',
    icon: 'quiz',
    teamSize: 'Individual',
    venue: 'Theta Lab',
    routeMap: null,
    schedule: 'Round 1: 10:30 AM – 11:30 AM · Round 2: 12:00 PM – 1:00 PM',
    prizes: TECHNICAL_PRIZES,
    chiefGuest: 'Roopan Prasath, Manager, Cognizant, Bangalore (chief guest and jury)',
    coordinators: [student('Satheeshwaran S'), student('Sariga M')],
  },
];
