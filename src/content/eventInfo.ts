import type { EventInfo } from './types';

/**
 * What each event's See More window shows, by event id.
 *
 * The five technical events follow the department's confirmed event list. The
 * non-technical events still carry PLACEHOLDER DETAILS, written from each event's name
 * and type; replace them with the coordinators' rules. The window says details are
 * provisional for any event without coordinators in eventCatalog.ts.
 */

/** Shared by every event: how the gate pass and event fee work on the day. */
const COMMON_INSTRUCTIONS = [
  'Register online for the PRAGYA 2026 gate pass (₹100 per person) by 11:59 PM on 16 October 2026.',
  'Your participant pass is emailed once the organisers verify your payment.',
  'Event registration is on-site only: ₹50 per event, paid at the venue.',
  'Carry your college ID card and your participant pass (printed or on your phone).',
  'Report to the event venue at least 30 minutes before the start.',
];

export const eventInfo: Record<string, EventInfo> = {
  'pro-pitch': {
    type: 'Technical · Individual or team',
    team: 'Individual or team',
    rounds: [
      { name: 'Round 1: Prompt & build', detail: 'Build a working app for the idea you draw, using AI prompts (40 minutes).' },
      { name: 'Round 2: Final build', detail: 'Round 1 qualifiers take their app further; the final working app is evaluated (40 minutes).' },
    ],
    procedure: [
      'Each participant or team draws an app idea by lucky draw.',
      'Develop a functional app for it with AI prompts: code, design and features.',
      'Round 1 qualifiers proceed to Round 2, where the working app itself is evaluated.',
    ],
    rules: [
      'AI tools such as ChatGPT, Gemini, Claude and Copilot are allowed for coding, design, features and development.',
      'Screenshots are not accepted as the final output: the app must work.',
      'Do not copy or reveal the exact name of the reference app; give your app a new and unique name.',
    ],
    judging: ['Functionality', 'Creativity', 'AI prompt usage', 'UI and design', 'Final app quality'],
    instructions: COMMON_INSTRUCTIONS,
  },
  'viz-craft': {
    type: 'Technical · Individual or pair',
    team: 'Individual or up to 2 participants',
    rounds: [
      { name: 'Round 1: Dataset', detail: 'Analyse the dataset provided and visualise what it shows (30 minutes).' },
      { name: 'Round 2: New dataset', detail: 'Qualifiers work on a fresh dataset and present their insights (30 minutes).' },
    ],
    procedure: [
      'A dataset is provided at the start of each round.',
      'Create suitable visualizations and explain the insights you find.',
      'Round 1 qualifiers proceed to Round 2.',
    ],
    rules: [
      'AI tools may be used for data analysis, visualization suggestions and assistance.',
      'Excel, Power BI, Python or other approved tools may be used.',
    ],
    judging: ['Data accuracy', 'Visualization quality', 'Insight interpretation', 'Creativity', 'Presentation'],
    instructions: COMMON_INSTRUCTIONS,
  },
  'paper-presentation': {
    type: 'Technical · Individual or team',
    team: 'Individual or team',
    rounds: [
      { name: 'Round 1: Presentation', detail: 'Present your paper with PowerPoint (5 minutes), followed by a short Q&A.' },
      { name: 'Round 2: Final presentation', detail: 'Selected participants present again (5 minutes), followed by a short Q&A.' },
    ],
    procedure: [
      'Submit your paper and PPT before the event.',
      'Present a research-based or innovative technical topic to the judges.',
      'Round 1 selections proceed to Round 2 (about 15 minutes per team in all).',
    ],
    rules: [
      'The paper and PPT must be submitted before the event.',
      'The presentation must use PowerPoint.',
      'Finish within the time given; each presentation is followed by a short Q&A.',
    ],
    judging: ['Technical content', 'Originality', 'Presentation skill', 'Clarity', 'Q&A'],
    instructions: COMMON_INSTRUCTIONS,
  },
  'code-flex': {
    type: 'Technical · Individual event',
    team: 'Individual',
    rounds: [
      { name: 'Round 1', detail: 'Solve the given programming problems (30 minutes).' },
      { name: 'Round 2', detail: 'Qualifiers solve the final round of problems (30 minutes).' },
    ],
    procedure: [
      'Choose any permitted language: Python, Java, C or C++.',
      'Solve the problems and submit your source code within the time given.',
      'Round 1 qualifiers proceed to Round 2.',
    ],
    rules: [
      'Internet, AI tools and external assistance are not allowed.',
      'Allowed languages: Python, Java, C and C++.',
      'Source code must be submitted within the given time.',
    ],
    judging: ['Correctness', 'Logic', 'Efficiency', 'Completion time'],
    instructions: COMMON_INSTRUCTIONS,
  },
  cognix: {
    type: 'Technical · Individual quiz',
    team: 'Individual',
    rounds: [
      { name: 'Round 1: Preliminary', detail: '20 questions (30 minutes); the top scorers are shortlisted.' },
      { name: 'Round 2: Final', detail: '20 questions for the shortlisted participants (30 minutes).' },
    ],
    procedure: [
      'Questions cover AI, data science, machine learning, deep learning, generative AI, recent AI technologies and AI current affairs.',
      'Round 1 is the preliminary round; shortlisted participants proceed to Round 2.',
    ],
    rules: [
      'Internet, AI tools and external assistance are not allowed.',
      'Each round has 20 questions and 30 minutes.',
    ],
    judging: ['Accuracy', 'Completion time'],
    instructions: COMMON_INSTRUCTIONS,
  },
  'visual-logo-design': {
    type: 'Non-technical · Individual event',
    team: 'Individual',
    rounds: [{ name: 'Single round: On-the-spot design', detail: 'Design a logo for a theme announced on the spot (60 minutes).' }],
    procedure: [
      'The theme is announced at the start.',
      'Design a logo and save it as PNG or PDF.',
      'Explain your idea to the judges in one minute.',
    ],
    rules: [
      'Any design tool is allowed: Illustrator, Photoshop, Figma, Canva or hand sketching.',
      'Bring your own laptop or drawing materials.',
      'Templates and AI image generators are not allowed.',
    ],
    judging: ['Relevance to the theme', 'Creativity', 'Simplicity and clarity', 'Explanation of the concept'],
    instructions: COMMON_INSTRUCTIONS,
  },
  'short-film': {
    type: 'Non-technical · Team event',
    team: 'Up to 5 members',
    rounds: [
      { name: 'Round 1: Submission', detail: 'Submit a short film of up to 5 minutes before the deadline.' },
      { name: 'Round 2: Screening', detail: 'Shortlisted films are screened at the venue and judged.' },
    ],
    procedure: [
      'Make a short film on any theme of your choice.',
      'Submit the film file and a one-line synopsis before the deadline.',
      'Shortlisted teams attend the screening on the day.',
    ],
    rules: [
      'Maximum length is 5 minutes, including titles.',
      'Films in any language need English subtitles.',
      'Content must be original; offensive content is disqualified.',
      'Phone cameras are allowed.',
    ],
    judging: ['Story', 'Direction and acting', 'Cinematography and editing', 'Message'],
    instructions: COMMON_INSTRUCTIONS,
  },
  'eagle-eye-challenge': {
    type: 'Non-technical · Individual event',
    team: 'Individual',
    rounds: [
      { name: 'Round 1: Observation', detail: 'Spot the details and differences in a set of images (15 minutes).' },
      { name: 'Round 2: Photo hunt', detail: 'Capture photos on campus that fit a given theme (45 minutes).' },
    ],
    procedure: [
      'Round 1 tests how much detail you notice, against the clock.',
      'Qualifiers receive a theme and shoot photos around the campus.',
      'Submit your three best photos to the coordinators.',
    ],
    rules: [
      'Phone cameras are allowed; editing apps are not.',
      'Photos must be taken during the event, on campus.',
      'Do not disturb ongoing classes or other events.',
    ],
    judging: ['Accuracy and speed (Round 1)', 'Fit to the theme', 'Composition', 'Creativity'],
    instructions: COMMON_INSTRUCTIONS,
  },
  'brand-it': {
    type: 'Non-technical · Team event',
    team: '2 to 3 members per team',
    rounds: [
      { name: 'Round 1: Brand build', detail: 'Create a brand name, tagline and ad concept for a product given on the spot (30 minutes).' },
      { name: 'Round 2: Ad pitch', detail: 'Present your ad as a pitch or short skit (3 minutes).' },
    ],
    procedure: [
      'Each team receives a product at the start.',
      'Plan the brand identity and an advertising idea.',
      'Shortlisted teams present their ad live.',
    ],
    rules: [
      'Props are allowed; no pre-made material.',
      'Keep the content respectful and suitable for all audiences.',
      'Stay within the time limit.',
    ],
    judging: ['Creativity', 'Persuasiveness', 'Presentation', 'Teamwork'],
    instructions: COMMON_INSTRUCTIONS,
  },
  'e-sports': {
    type: 'Non-technical · Squad event',
    team: 'Squad of 4 players',
    rounds: [
      { name: 'Qualifiers', detail: 'Knockout matches between squads.' },
      { name: 'Finals', detail: 'The top squads play the final matches.' },
    ],
    procedure: [
      'The game title and match format are announced by the coordinators.',
      'Squads are drawn into qualifier matches on the day.',
      'Winners move on to the finals.',
    ],
    rules: [
      'Bring your own phone, charger and mobile data.',
      'Hacks, emulators and unfair play lead to disqualification.',
      "The coordinators' decisions are final.",
    ],
    judging: ['Placement points', 'Elimination points', 'As per the announced match format'],
    instructions: COMMON_INSTRUCTIONS,
  },
};
