# PRAGYA 2026

Website for **PRAGYA 2026**, the AI & technology symposium at **R P Sarathy Institute of Technology, Salem**.

A single static page built with React, TypeScript and Vite. It is prerendered at build time, so the
text appears before any JavaScript runs, and it can be hosted on any static host.

## Run it

```bash
py start.py        # everything: registration API :8787, dev server :5173, preview :4173
```

`start.py` installs packages on the first run, builds, starts the registration API first, checks it
reached Google, then starts the two website servers (which forward `/api` to it). A server that stops
unexpectedly is restarted; Ctrl+C stops everything. Add `--host` to open the site from phones on the
same Wi-Fi, or `--no-build` to reuse the last build.

The pieces one at a time:

```bash
npm install
npm run server     # registration API + built site at http://localhost:8787 (needed for the form)
npm run dev        # development server at http://localhost:5173
npm run build      # production build into dist/ (type-check, bundle, prerender)
npm run preview    # serve the production build at http://localhost:4173
npm run check      # lint + tests + build, the full pre-deploy check
```

The form only works while the registration API is running. Without it the dev server and preview
cannot save registrations, and the form says it cannot reach the registration server.

## Adding details later

All content lives in the files under `src/content/`. You never need to touch layout code to add information.

| What | Where | Effect on the page |
| --- | --- | --- |
| Registration form | `src/content/site.ts` → `registration.endpoint` | `/api/register`, the registration server (see [Registration](#registration)). Every Register Now button opens the same form in a window. Set `VITE_REGISTRATION_API_URL` at build time only if the server lives on another address. |
| Payment details | `registration.payment.upiId`, `.payee`, `.qrImage` | Shown in the form's Payment step. Until set, the form says the UPI details will be shared soon. |
| Fees | `registration.gatePassFee`, `registration.eventFee` | ₹100 gate pass (paid online) and ₹50 per event (paid on-site): shown in the form and the Important notice. |
| Registration closing time | `registration.closesAt` (e.g. `'2026-10-16T17:00:00'`, read as IST) | The hero counts down to it (days, hours, minutes, seconds). Once it passes, the countdown, the Register section and the form all say registration is closed. |
| Registration deadline / note | `registration.deadline`, `registration.note` | Shown in the Register section. |
| Dates, venue | `site.dates`, `site.venue` | Shown in the hero. |
| Department | `site.department` | Shown above the PRAGYA wordmark in the hero ("Department of …"). |
| College details | `site.college` | Footer: address, website, accreditation tags and the embedded Google map (`map.embedUrl`, with `map.url` for "Open in Google Maps"). Phone numbers are listed only if `phones` is filled in (empty for now). |
| Contacts | `site.contacts`, `site.email` | Symposium coordinators, listed in the footer under the college details. Until then it says "Symposium coordinators will be announced soon." |
| Social links | `site.socials` | Round icon buttons under "Follow Us" in the footer (`icon`: `instagram`, `website`, `linkedin`, `github`). |
| See More details | `src/content/eventInfo.ts` | Type, eligibility, team, rounds, procedure, rules, judging and instructions in each event's See More window. **These are placeholders**: replace them with the confirmed rules. |
| Event details | `src/content/events.ts` → `teamSize`, `venue`, `schedule`, `rules`, `coordinators` | Appear on that event's card and in its See More window (they override the placeholders). |
| Dev Crew names, links | `src/content/crew.ts` | One profile card per member in the Dev Crew section, the last block of the page. |
| Dev Crew photos | `dev_crew/<Name>.jpg` (e.g. `Varshan.png`), then `npm run images` | Matched to the member by name, framed as a 600px square from just above the head (background kept) and shown on their card. Until then the card shows their initials. |
| College logo | `image/rpsit-logo.webp`, then `node scripts/process-logo.mjs` | Cut out along its gold rim and saved as the header and footer crest (`public/images/rpsit-logo-sm.webp`), the browser-tab icon (`public/favicon-32.png`) and the home-screen icon (`public/apple-touch-icon.png`). |

Example:

```ts
// src/content/site.ts
registration: {
  endpoint: 'https://script.google.com/macros/s/…/exec',
  deadline: 'DD Month 2026',
  note: null,
  gatePassFee: 100,
  eventFee: 50,
  payment: { upiId: 'pragya@okaxis', payee: 'RPSIT AI & DS', qrImage: '/images/upi-qr.png' },
},
```

```ts
// src/content/events.ts
{
  id: 'code-flex',
  name: 'CODE FLEX',
  // ...
  teamSize: 'Individual',
  rules: ['Bring your own laptop', 'Languages: C, Java, Python'],
  coordinators: [{ name: 'Coordinator Name', phone: '+91 ...' }],
},
```

There are exactly ten events. A test (`src/content/events.test.ts`) checks the names and order, so an
accidental edit is caught by `npm run check`.

## Registration

Every Register Now button (header, hero, the Join PRAGYA 2026 section and each event card) opens one
registration form in a window on the page: name with initial, department, college, year, phone, email,
transaction ID and the payment screenshot (with a preview). Each field is checked before the form can
be sent, and the screenshot is shrunk to at most 1600px before upload so it is quick on mobile data.

The form posts to the registration server (`server/`, `npm run server`), which uses your Google
account through the Google APIs:

- **Google Drive**: the payment screenshot, stored privately in your payment folder.
- **Google Sheets**: one row per registration (the sheet is the database). Columns are found by their
  header, so organisers may reorder them or add their own.
- **Gmail**: a confirmation email with the participant pass (PDF) attached, also saved to Drive.

A registration counts only once Google has confirmed both the screenshot and the row. The participant
then gets a Registration ID (PRG26-0001, …). The email follows in the background and is retried
for up to a day (1 min, 5 min, 30 min, 2 h, 6 h, 12 h) if Gmail fails. A transaction ID or email that
is already registered is refused, and pressing Submit twice never registers anyone twice.

Built for a rush: registrations queue and are saved 3 at a time (`REGISTRATION_WORKERS`), sheet writes
are batched to stay inside Google's limits, and each IP address may send 300 registrations per
10 minutes (`RATE_LIMIT_MAX`), because a whole college can share one address.

One-time setup:

1. Copy `.env.example` to `.env` and fill in `GOOGLE_SHEET_ID` and `GOOGLE_DRIVE_PAYMENT_FOLDER_ID`.
2. Put the OAuth client JSON from Google Cloud Console in `google client/`, then run
   `npm run google:auth` and tick every box. This saves the refresh token to `.env`.
   In Google Cloud Console, set the OAuth consent screen's publishing status to **In production**.
   While it says *Testing*, Google expires the token after 7 days and registration stops.
3. `npm run google:check` checks the Sheet, the Drive folder and Gmail
   (add `-- --send-test-email` to send yourself a test).
4. `npm run google:setup` formats the sheet and creates the "Participant Passes" folder.
5. Add the UPI details under `registration.payment` in `src/content/site.ts`.

`GET /api/health` answers `ready` (connected to Google), `starting`, or `unavailable` (could not reach
Google; check the server log and run `npm run google:check`). The server keeps a small state file in
`.data/desk.json` (the ID counter and the email outbox). It holds participant details, so keep it
private.

## Secrets and private data

`.env` (Google secret and refresh token), `google client/` (the OAuth client JSON), `.data/` (student
details waiting for their email) and `dev_crew/` (full-size photos) never go into git: `.gitignore`
leaves them out, and `npm run check:secrets` fails if any of them, or a secret value in any file
(Google client secrets, refresh and access tokens, API keys, private keys), would be committed or
built into the public site. It reports file and line only, never the secret.

After cloning, turn on the pre-commit check once, so every commit is checked:

```bash
git config core.hooksPath .githooks
```

If a real secret was ever committed or pushed, rotate it in Google Cloud Console: deleting it from
git is not enough.

## Structure

```
src/
  content/      site.ts, events.ts, eventInfo.ts, crew.ts, types.ts   ← the only files content editors touch
  styles/       tokens.css (colours, type, motion), base.css
  hooks/        in-view, media query, scroll spy, scroll reveal, tab visibility
  lib/          registration form (validation, submission), device capability rules, angle maths
  components/
    nav/        PillNav (floating pill navigation)
    text/       TextType
    events/     EventOrbit (3D carousel), EventsSection, EventCard
    sections/   NeuralMap, RegisterCTA, Footer, DevCrew
    hero/       Hero, Countdown
    profile/    ProfileCard (React Bits, used by DevCrew)
    background/ SkyBackdrop + GhostFibers (page-wide background), DriftWall (register section)
    ui/         SpecularButton, RegisterButton (opens the registration window)
    modal/      Modal (native <dialog>), SiteModals (the shared registration and event windows)
    registration/ RegistrationModal (the form)
server/
  node.ts       the registration server (API + built site), npm run server
  desk.ts       the registration queue: IDs, duplicates, Drive → Sheets, the email outbox
  sheets.ts, drive.ts, gmail.ts, google.ts   Google APIs, with retries and backoff
  validate.ts   server-side checks of every registration
  config.ts     settings from .env (see .env.example)
  cloudflare.ts optional Cloudflare Workers version (not used yet)
scripts/prerender.mjs  ← writes the rendered page into dist/index.html
scripts/google-auth.mjs ← npm run google:auth / google:check
start.py               ← starts every server (py start.py)
```

## Visual references

The design adapts these React Bits components, rebuilt for low CPU and GPU use:

- **Ghost Fibers** (`background/GhostFibers.tsx`, uses `ogl`): a fixed, slowly moving background behind
  the whole page, dimmed slightly below the hero so text stays readable. It plays on its own (no mouse
  interaction) at half resolution and 30fps (24fps on phones), with 3 fibre layers and no film grain, and
  rests while the tab is hidden or the registration, event or Dev Crew window is open. Devices with reduced
  motion, data saver, low memory, few cores or no WebGL 2 keep a still CSS glow instead. Nothing on top of it
  uses `backdrop-filter`, so the GPU never has to re-blur the page as it moves.
- **Profile Card** (`profile/ProfileCard.tsx`): the Dev Crew cards, with tilt and holographic shine. The
  tilt loop stops once a card settles, and the shine pauses while the section is off screen.
- **TextType**: GSAP removed. The cursor blinks with CSS, and typing pauses off screen.
- **Pill Nav**: rebuilt with CSS transitions. No GSAP or router needed for a one-page site.
- **Specular Button**: rebuilt in CSS (conic-gradient rim that follows the cursor) instead of one WebGL
  canvas per button.
- **Circular Carousel**: CSS 3D ring with drag momentum and snapping. It turns continuously, with no
  stop at each poster, at 10° a second (`DRIFT_DEG_PER_S` in `EventOrbit.tsx`: a new poster about
  every 3.6s), with the mouse over it too; it holds while a finger is on it (resuming 4s after
  lifting), during keyboard focus, and its animation loop sleeps when off screen or in a hidden tab.
  Cards turned away from the viewer are not drawn (no backfaces), so only about half the tiles are
  composited at any moment.
- **Drift Wall**: CSS keyframes on transforms, paused when off screen.

Every animation respects `prefers-reduced-motion`.

## Deploying

`npm run build` and upload the `dist/` folder to any static host (Netlify, Vercel, GitHub Pages,
Cloudflare Pages, or the college web server). If the site lives under a sub-path such as
`/pragya/`, set `base: '/pragya/'` in `vite.config.ts`. Vite rewrites the font, favicon and asset URLs
to match.

## Fonts

Mona Sans (variable, SIL Open Font License, see `public/fonts/OFL.txt`) is self-hosted. One file covers every
weight and width the design uses.
