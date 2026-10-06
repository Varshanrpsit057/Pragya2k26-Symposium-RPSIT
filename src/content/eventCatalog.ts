import type { SymposiumEvent } from './types';

/** An event as listed here; its poster is added in events.ts. */
export type EventEntry = Omit<SymposiumEvent, 'poster'>;

/**
 * The ten PRAGYA 2026 events, without their posters.
 *
 * Kept apart from the poster images so the registration server (worker/) can read the
 * same names and categories the website shows. Edit events here; events.ts adds the
 * posters, and eventInfo.ts holds the See More details.
 *
 * Optional fields (teamSize, venue, schedule, rules, coordinators) appear on the event
 * card, in its See More window and on the participant pass as soon as they are added.
 */
export const eventCatalog: EventEntry[] = [
  {
    id: 'pro-pitch',
    name: 'PRO-PITCH',
    subtitle: 'Prompt to App',
    category: 'technical',
    description: 'Take an idea from a prompt to a working app, then pitch what you built.',
    icon: 'prompt',
  },
  {
    id: 'viz-craft',
    name: 'VIZ CRAFT',
    subtitle: 'Data Visualization',
    category: 'technical',
    description: 'Turn raw data into clear visuals that tell its story at a glance.',
    icon: 'chart',
  },
  {
    id: 'paper-presentation',
    name: 'PAPER PRESENTATION',
    category: 'technical',
    description: 'Present a technical paper and walk the audience through your ideas.',
    icon: 'paper',
  },
  {
    id: 'code-flex',
    name: 'CODE FLEX',
    subtitle: 'Multi-language Coding Challenge',
    category: 'technical',
    description: 'A coding challenge that tests your problem solving across multiple programming languages.',
    icon: 'code',
  },
  {
    id: 'cognix',
    name: 'COGNIX',
    subtitle: 'Quiz',
    category: 'technical',
    description: 'A quiz that puts your technical knowledge to the test.',
    icon: 'quiz',
  },
  {
    id: 'visual-logo-design',
    name: 'VISUAL LOGO DESIGN',
    subtitle: 'Logo Design',
    category: 'non-technical',
    description: 'Design a logo that captures an idea in a single mark.',
    icon: 'vector',
  },
  {
    id: 'short-film',
    name: 'SHORT FILM',
    category: 'non-technical',
    description: 'Tell a story on screen in a short film.',
    icon: 'film',
  },
  {
    id: 'eagle-eye-challenge',
    name: 'EAGLE EYE CHALLENGE',
    category: 'non-technical',
    description: 'A challenge for sharp eyes and close attention to detail.',
    icon: 'eye',
  },
  {
    id: 'brand-it',
    name: 'BRAND IT',
    category: 'non-technical',
    description: 'Put your branding and marketing creativity to work.',
    icon: 'tag',
  },
  {
    id: 'e-sports',
    name: 'E-SPORTS',
    category: 'non-technical',
    description: 'Compete head-to-head in competitive gaming.',
    icon: 'gamepad',
  },
];
