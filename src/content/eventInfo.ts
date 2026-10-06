import type { EventInfo } from './types';

/**
 * What each event's See More window shows, by event id.
 *
 * PLACEHOLDER DETAILS: written from each event's name and type so the window has
 * something useful to show. Replace them with the coordinators' confirmed rules;
 * the window says the details are provisional until then.
 */

/** Shared by every event: how the gate pass and event fee work on the day. */
const COMMON_INSTRUCTIONS = [
  'Register online for the PRAGYA 2026 gate pass (₹100 per person) before the event.',
  'Event registration is on-site only: ₹50 per event, paid at the venue.',
  'Carry your college ID card and the gate pass payment screenshot.',
  'Report to the event venue at least 30 minutes before the start.',
];

export const eventInfo: Record<string, EventInfo> = {
  'pro-pitch': {
    type: 'Technical · Team event',
    team: '2 to 3 members per team',
    rounds: [
      {
        name: 'Round 1: Prompt & Build',
        detail: 'Build a working app prototype from a problem statement using AI tools (90 minutes).',
      },
      { name: 'Round 2: Pitch', detail: 'Demo the app and pitch it to the judges (5 minutes + 2 minutes Q&A).' },
    ],
    procedure: [
      'Problem statements are revealed at the start of Round 1.',
      'Teams pick one statement and build a prototype with AI coding and design tools.',
      'Shortlisted teams present a live demo and a short pitch in Round 2.',
    ],
    rules: [
      'AI assistants and no-code tools are allowed; the work must be built during the event.',
      'Bring your own laptop and charger; internet access is provided.',
      'The app must run during the demo; screenshots alone are not accepted.',
      'Pre-built projects lead to disqualification.',
    ],
    judging: ['Fit to the problem', 'Working prototype', 'Creativity and user experience', 'Clarity of the pitch'],
    instructions: COMMON_INSTRUCTIONS,
  },
  'viz-craft': {
    type: 'Technical · Individual or pair',
    team: '1 or 2 members',
    rounds: [
      { name: 'Round 1: Dataset challenge', detail: 'Visualise a dataset given on the spot (60 minutes).' },
      { name: 'Round 2: Data story', detail: 'Present your dashboard and its key insights (3 minutes).' },
    ],
    procedure: [
      'Each team receives the same dataset at the start.',
      'Build charts or a dashboard that answers the questions given with the data.',
      'Shortlisted teams explain their findings to the judges.',
    ],
    rules: [
      'Any tool is allowed: Excel, Power BI, Tableau, Python or similar.',
      'Bring your own laptop with your tools installed.',
      'Use only the dataset provided.',
    ],
    judging: ['Accuracy of the data', 'Clarity of the visuals', 'Design', 'Insight and storytelling'],
    instructions: COMMON_INSTRUCTIONS,
  },
  'paper-presentation': {
    type: 'Technical · Individual or team',
    team: '1 to 3 members',
    rounds: [
      { name: 'Round 1: Abstract screening', detail: 'Submit an abstract before the deadline; selected papers are announced.' },
      { name: 'Round 2: Presentation', detail: 'Present your paper (7 minutes + 3 minutes Q&A).' },
    ],
    procedure: [
      'Send a one-page abstract on a topic in AI, data science or emerging technology.',
      'Shortlisted teams prepare slides and present on the day.',
      'Judges ask questions after each presentation.',
    ],
    rules: [
      'The paper must be your own original work.',
      'Bring slides as PPT or PDF on a pen drive.',
      'Stay within the time limit; time is strictly kept.',
    ],
    judging: ['Originality', 'Technical depth', 'Presentation', 'Answers to questions'],
    instructions: COMMON_INSTRUCTIONS,
  },
  'code-flex': {
    type: 'Technical · Individual event',
    team: 'Individual',
    rounds: [
      { name: 'Round 1: Debug & MCQ', detail: 'Find the bugs and answer programming questions (30 minutes).' },
      { name: 'Round 2: Coding', detail: 'Solve programming problems in C, C++, Java or Python (60 minutes).' },
    ],
    procedure: [
      'Round 1 shortlists participants for the coding round.',
      'In Round 2, solve as many problems as you can in any of the allowed languages.',
      'Solutions are checked against hidden test cases.',
    ],
    rules: [
      'Systems are provided; no internet, phones or notes are allowed.',
      'Allowed languages: C, C++, Java and Python.',
      'Copied code leads to disqualification.',
    ],
    judging: ['Correct output', 'Number of problems solved', 'Efficiency of the solution', 'Time taken'],
    instructions: COMMON_INSTRUCTIONS,
  },
  cognix: {
    type: 'Technical · Team quiz',
    team: '2 members per team',
    rounds: [
      { name: 'Round 1: Prelims', detail: 'A written round of 25 questions (20 minutes).' },
      { name: 'Round 2: Finals', detail: 'The top teams compete on stage in themed and rapid-fire rounds.' },
    ],
    procedure: [
      'All teams take the written prelims at the same time.',
      'The highest-scoring teams move on to the stage finals.',
      'Questions cover technology, computing, AI and current tech news.',
    ],
    rules: [
      'No phones or other devices during the quiz.',
      'Answers must be given within the time allowed.',
      "The quizmaster's decision is final.",
    ],
    judging: ['Total points across rounds', 'Tie-breaker question if scores are level'],
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
