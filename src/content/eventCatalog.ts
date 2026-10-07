import type { Person, SymposiumEvent } from './types';

/** An event as listed here; its posters are added in events.ts. */
export type EventEntry = Omit<SymposiumEvent, 'poster' | 'posterLarge'>;

/** The prizes of every technical event (Department event list). */
const TECHNICAL_PRIZES = ['1st prize: ₹1,000', '2nd prize: ₹750', '3rd prize: ₹500', 'Participation certificate for every participant'];

const staff = (name: string, designation: string): Person => ({ name, role: `Staff coordinator · ${designation}` });
const student = (name: string): Person => ({ name, role: 'Student coordinator' });

/**
 * The ten PRAGYA 2026 events, without their posters.
 *
 * Kept apart from the poster images so the registration server can read the same names
 * and categories the website shows. Edit events here; events.ts adds the posters, and
 * eventInfo.ts holds the See More details.
 *
 * Optional fields (teamSize, venue, schedule, prizes, chiefGuest, coordinators) appear in
 * the event's See More window and on the participant pass as soon as they are set.
 * The technical events carry the confirmed details from the department's event list.
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
    venue: 'Delta Lab',
    schedule: '10:30 AM – 12:00 PM',
    prizes: TECHNICAL_PRIZES,
    chiefGuest: 'Mohan M, CEO, Patora AI & IT Services (chief guest and jury)',
    coordinators: [staff('Mrs. D. Vidya', 'AP/AI&DS'), student('Kabil V'), student('Vaishnavi R')],
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
    venue: 'Theta Lab',
    schedule: '10:30 AM – 11:40 AM',
    prizes: TECHNICAL_PRIZES,
    coordinators: [staff('Mrs. R. Devi Priya', 'ASP/AI&DS'), student('Priyanka M'), student('Sakthi P')],
  },
  {
    id: 'paper-presentation',
    name: 'PAPER PRESENTATION',
    category: 'technical',
    description:
      'Take the stage with your research or an innovative technical idea, present it to the judges and defend it in a quick Q&A.',
    icon: 'paper',
    teamSize: 'Individual or team',
    venue: 'LH-05',
    schedule: '10:30 AM – 12:30 PM',
    prizes: TECHNICAL_PRIZES,
    coordinators: [staff('Mrs. N. Pushpa', 'ASP/AI&DS'), student('Kishorerajpriyan M'), student('Prathiksha J')],
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
    schedule: 'Round 1: 12:15 PM – 1:00 PM · Round 2: 2:00 PM – 2:40 PM',
    prizes: TECHNICAL_PRIZES,
    coordinators: [staff('Mrs. Lavanya', 'AP/AI&DS'), student('Krishnakumar S'), student('Roshini V')],
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
    schedule: '12:00 PM – 1:00 PM',
    prizes: TECHNICAL_PRIZES,
    coordinators: [staff('Mr. Sivasubramani', 'AP/AI&DS'), student('Satheeshwaran S'), student('Sariga M')],
  },
  {
    id: 'visual-logo-design',
    name: 'VISUAL LOGO DESIGN',
    subtitle: 'Logo Design',
    category: 'non-technical',
    description: 'Turn a theme into one memorable mark: sketch it, refine it and explain the idea behind your logo.',
    icon: 'vector',
  },
  {
    id: 'short-film',
    name: 'SHORT FILM',
    category: 'non-technical',
    description: 'Write, shoot and edit a short film that holds the screen, then premiere it in front of the judges.',
    icon: 'film',
  },
  {
    id: 'eagle-eye-challenge',
    name: 'EAGLE EYE CHALLENGE',
    category: 'non-technical',
    description: 'Spot what everyone else misses: hidden details, tiny differences and visual puzzles, against the clock.',
    icon: 'eye',
  },
  {
    id: 'brand-it',
    name: 'BRAND IT',
    category: 'non-technical',
    description: 'Build a brand on the spot, from its name and tagline to an ad pitch that makes the room want it.',
    icon: 'tag',
  },
  {
    id: 'e-sports',
    name: 'E-SPORTS',
    category: 'non-technical',
    description: 'Squad up for competitive mobile gaming, where strategy, reflexes and teamwork decide who wins.',
    icon: 'gamepad',
  },
];
