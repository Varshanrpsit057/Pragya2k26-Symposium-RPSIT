import type { EventInfo } from './types';

/**
 * What each event's See More window shows, by event id: the department's confirmed event
 * list (final round 1 & 2). Each fact appears once: the rounds say how the event moves on,
 * "How it works" adds only what the rounds do not, and the rules add only what neither says.
 * What applies to every event is in DAY_INSTRUCTIONS, shown once in the window.
 */

/** The same for every event: gate pass, event registration at the venue, what to bring. */
export const DAY_INSTRUCTIONS = [
  'Gate pass ₹100: online until 11:59 PM, 16 October, or at the registration desk on 17 October.',
  'Register for each event at its venue: give the coordinator your Registration ID and pay ₹50.',
  'Carry your college ID card and your participant pass (printed or on your phone).',
  'Be at the venue 30 minutes before the start.',
];

export const eventInfo: Record<string, EventInfo> = {
  'pro-pitch': {
    type: 'Technical · Individual or team',
    team: 'Individual or team',
    rounds: [
      { name: 'Prompt & build', detail: 'Build a working app for the idea you draw, using AI prompts (40 minutes).' },
      { name: 'Final build', detail: 'Qualifiers take their app further; the working app is evaluated (40 minutes).' },
    ],
    procedure: ['Each participant or team draws an app idea by lucky draw.', 'Build it with AI prompts: the code, the design and the features.'],
    rules: [
      'AI tools such as ChatGPT, Gemini, Claude and Copilot are allowed.',
      'The app must work: screenshots are not accepted as the final output.',
      'Give your app a new, unique name: do not copy or reveal the reference app’s name.',
    ],
    judging: ['Functionality', 'Creativity', 'AI prompt usage', 'UI and design', 'Final app quality'],
  },
  'viz-craft': {
    type: 'Technical · Individual or pair',
    team: 'Individual or up to 2 participants',
    rounds: [
      { name: 'Dataset', detail: 'Analyse the dataset given and visualise what it shows (30 minutes).' },
      { name: 'New dataset', detail: 'Qualifiers work on a fresh dataset and present their insights (30 minutes).' },
    ],
    procedure: ['A dataset is handed out at the start of each round.', 'Build the visuals and explain the insights you find.'],
    rules: ['AI tools may help with analysis and visualisation ideas.', 'Use Excel, Power BI, Python or another approved tool.'],
    judging: ['Data accuracy', 'Visualization quality', 'Insight interpretation', 'Creativity', 'Presentation'],
  },
  'paper-presentation': {
    type: 'Technical · Individual or team',
    team: 'Individual or team',
    rounds: [
      { name: 'Presentation', detail: 'Present your paper in 5 minutes, then a short Q&A.' },
      { name: 'Final presentation', detail: 'Selected participants present again in 5 minutes, then a short Q&A.' },
    ],
    procedure: ['Submit your paper and PPT before the event.', 'Present a research-based or innovative technical topic to the judges.'],
    rules: ['Present with PowerPoint.', 'Finish within the time given: about 15 minutes per team over both rounds.'],
    judging: ['Technical content', 'Originality', 'Presentation skill', 'Clarity', 'Q&A'],
  },
  'code-flex': {
    type: 'Technical · Individual event',
    team: 'Individual',
    rounds: [
      { name: 'Round 1', detail: 'Solve the given programming problems (30 minutes).' },
      { name: 'Round 2', detail: 'Qualifiers solve the final set of problems (30 minutes).' },
    ],
    procedure: ['Code in Python, Java, C or C++.', 'Submit your source code before the time runs out.'],
    rules: ['No internet, no AI tools and no outside help.'],
    judging: ['Correctness', 'Logic', 'Efficiency', 'Completion time'],
  },
  cognix: {
    type: 'Technical · Individual quiz',
    team: 'Individual',
    rounds: [
      { name: 'Preliminary', detail: '20 questions in 30 minutes; the top scorers are shortlisted.' },
      { name: 'Final', detail: '20 questions in 30 minutes for the shortlisted participants.' },
    ],
    procedure: ['Questions on AI, data science, machine learning, deep learning, generative AI and AI current affairs.'],
    rules: ['No internet, no AI tools and no outside help.'],
    judging: ['Accuracy', 'Completion time'],
  },
};
