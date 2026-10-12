# PRAGYA 2026

Website, registration and admin approval for **PRAGYA 2026**, the AI & technology symposium of the
Department of Artificial Intelligence and Data Science, **R P Sarathy Institute of Technology, Salem**.

It is deployed straight from GitHub to **AWS Amplify**: no servers to run, no SSH, no manual uploads.

**Running the college-wide fest?** Start with [README-FEST.md](README-FEST.md): every link (each
department and each of the 44 events), every account, the setup after a deploy, how each role works
and what to do when something goes wrong.

## 0. The college-wide fest (INFINITE TECHFEST'26)

The staff dashboard runs the whole college's fest: **8 departments** (CSE, AIDS, IT, ECE, CYS, EEE,
MECH, SH), **44 events**, 4 registration desks per department and 2 coordinators per event, built
for about 300 phones on mobile data.

| Who | Address | What they get |
| --- | --- | --- |
| Web assist team (Admin role, and the owner account) | `/landing/admin/` | Everything: departments and events, accounts, registration times, website notice, registrations, event windows, corrections, test sessions, system status |
| Overall coordinator | `/landing/admin/` | Every department live: filters (department, event, venue, registered at, desk, entry fee, status, search), totals, by department / event and venue / desk, registrations with details, results and winners, CSV downloads; reopen results, cancel a fee recorded by mistake |
| Department HOD | `/landing/<dept>/admin/` | The same views for their department, read only |
| Department admin | `/landing/<dept>/admin/` | Their department: upload online registrations, paper slips, register, correct, cancel, any event window |
| Registration desk | `/landing/<dept>/admin/` | Register (works offline), find and check in online registrants, desk totals for the cash handover |
| Event coordinator | `/landing/<dept>/admin/` | Their event: students, ₹ fee, attendance, add a department student, winners and submit |

`<dept>` is `cse`, `aids`, `it`, `ece`, `cys`, `eee`, `mech` or `sh` (use the trailing slash). Each event
also has its own link, `/landing/<dept>/admin/?event=<event id>`, which opens on that event's window.

- **Registration IDs** carry the department: `CSE-0001…` at the desks, `CSE-5001…` imported from the
  online form, `CSE-9001…` paper slips. One phone number is registered once per department; a
  student registers in one department and takes part in its events.
- **Desk phones hold their own IDs**: 50 at a time, the next 50 taken by themselves when 15 are left,
  so a desk keeps registering with no signal. Everything done offline waits on the phone (the bar at
  the top says how many) and is sent in order when the signal returns; a retry never registers
  anyone twice. If a phone uses all its IDs with no signal, the desk uses paper slips.
- **Live updates**: each phone keeps a copy of its department (or, for the overall coordinator, all
  departments) and every 15 seconds asks only for what changed, a few KB instead of whole lists.
- **Online registrations**: export the online form (Netlify) per department as CSV and upload it in
  **Online & paper**: check the file (unknown events and duplicates are shown), then import. Each
  student counts as paid; tick if the event fees were paid online too. Uploading again adds only
  new students.
- **Departments and events** (names, HODs, contacts, desks, venues, times, fees, team sizes, open or
  closed) are edited by the web assist team in **Departments & events**, for everyone at once.
- **Accounts**: **Accounts → Create a department’s accounts** makes a department's HOD, admin, desks
  and coordinators in one go; download the logins then (the passwords are not shown again).
- **Backups**: every 30 minutes the schedule writes every department's data to
  `backups/fest/all.json` in the private bucket (every earlier version is kept), on top of
  DynamoDB's point-in-time recovery (the `FestRecords` table, deletion protected). Test data is
  saved to `backups/fest-test-data-*.json` before it is deleted.

**Before the day**: AWS Lambda concurrent executions raised to 1,000 (Service Quotas); accounts
made and logins handed out; online registrations uploaded; venues and times filled in; online
registration on this website closed in **Event-day controls → Registration times** (the online
form is the only online channel); a rehearsal with real phones on mobile data, then **Testing →
Delete the test data**; two phones on different carriers at each desk; paper slips printed.

## 1. Project overview

- **Public website** (React + TypeScript + Vite, prerendered): the hero with the PRAGYA 2K26 emblem
  (drawn in code, in the site's colours; scrolling turns it into a faint backdrop for the whole page)
  and the countdown to the registration deadline (**11:59 PM IST, 16 October 2026**); the five
  technical events (Pro-Pitch, Viz Craft, Paper Presentation, Code Flex, Cognix), folded until a
  visitor reaches one, each with a See More window (rules, time, venue, prizes, coordinators); the
  registration form; and the footer (coordinator contact, credits beside the map). PRAGYA 2026 runs
  technical events only: the website and the API accept no other event.
  The Dev Crew opens from the incognito button next to Contact in the navigation.
- **Route map** (home page, each event's See More window, Student login): the student picks where
  they are and where to go (an event's venue, the nearest restroom or drinking water, the canteen,
  the mess, the main auditorium, any room) and sees the way drawn on the campus and on each floor,
  with plain steps ("Turn left along the corridor…"); a step opens its floor. Zoom with + and −, or
  pinch; on a phone the map opens zoomed in on the way. The way is worked out from the walking paths
  in `src/content/campusMap.json` (`nav`; `src/lib/navigation.ts`), which avoid the closed COE
  corridor and the staff-only lift. The map is downloaded only when it is opened.
- **Event day**: the help desk section moves up, right under the hero, and a bar at the bottom of
  every screen offers Call the help desk, WhatsApp and the Route map.
- **Registration form**: participant details, event selection, the ₹100 gate-pass payment details,
  the payment screenshot and the transaction ID.
- **Registration schedule** (automatic, Asia/Kolkata, enforced by the API from its clock, no deploy
  needed): online until **11:59 PM IST, 16 October**; on **17 October** only the registration desk
  registers (on-site mode), **until 11:59 AM**; after that, every registration is closed. The site
  switches its countdown, Register section and form by itself. See section 12.
- **Staff dashboard** at `/landing/admin/`: every staff member signs in with their own account and
  sees only what their role allows (Admin, Registration desk, Event coordinator, Certificate team);
  the server checks the role on every request. It is not linked anywhere on the public site.
- **Registration workflow**:

  ```
  student submits ─▶ PENDING ─▶ admin checks the payment ─┬─▶ APPROVED ─▶ participant pass (PDF)
                                                           │                ─▶ confirmation email with the PDF
                                                           └─▶ REJECTED  (no pass, no confirmation email)
  ```

  Submitting the form never confirms a registration: only an admin's approval does. The participant
  pass is made, stored and handed out by the server only after approval.

  On the event day the desk registers walk-ins (`PRG26-OS-0001`, …, approved at once when the desk
  records the ₹100 gate pass in cash or by UPI), and each event's coordinator verifies the ₹50 event
  fee, marks attendance, enters the winners and submits the results for certificates (section 12).

## 2. Architecture

```
GitHub ──push──▶ AWS Amplify Hosting (build: amplify.yml)
                   ├─ website: dist/ (React/Vite) on Amplify's CDN
                   └─ backend: amplify/ (Amplify Gen 2, AWS CDK)
                        HTTP API (API Gateway) /api/*  ──▶  Lambda "pragya-api" (Node.js 22)
                        EventBridge, every 30 min      ──▶  same Lambda: retries
                        DynamoDB  Registrations, Control   (workflow state, IDs, sessions,
                                                            staff accounts, event results)
                        S3 (private)  payment screenshots, participant passes
                        SSM (Amplify secrets)              Google + admin credentials
                        CloudWatch Logs
                   Lambda ──▶ Google Sheets (one row per registration), Google Drive (screenshots,
                              passes), Gmail API (confirmation email)
```

- **DynamoDB is the source of truth** for the workflow. Its conditional writes make approval safe
  against double clicks, retries and parallel requests: one Registration ID per person, one pass,
  one email. **Google Sheets** keeps a row per registration (status, pass, email) for the organisers,
  updated on every change and retried automatically if Google is unavailable, never duplicated.
- **Payment screenshots** go from the browser straight to a private S3 bucket through a short-lived
  presigned upload (one key, PNG/JPEG/WebP, at most 5 MB). The API checks the uploaded bytes are a
  real image before the registration is stored, then copies the screenshot to Google Drive.
- **Participant passes** (`pdf-lib`, pure JavaScript) are generated in Lambda on approval, stored
  in private S3, attached to the Gmail confirmation, and copied to Drive.
- **Participants** get a private status link after submitting (`/#status=<ID>.<key>`). The key is
  their form's random submission id, stored only as a SHA-256 hash. Through it they see their status
  and, **only once approved**, get a one-minute download link for their own pass. A pending or
  rejected registration, another student's ID or a guessed key gets nothing.
- **Staff sign-in**: the owner's admin account is one username and a scrypt password hash, both
  Amplify secrets (unchanged). Further staff accounts (desk, coordinators, certificate team, more
  admins) are made in the dashboard and stored in the Control table with scrypt hashes. Sign-in gives
  a random session token (8 hours, stored only as a hash, with sign-in attempts rate limited). Every
  `/api/admin/*` route checks the token and the account's role on the server, reading the account
  again on each request, so a new role, deactivation or password change applies at once.

```
amplify/            backend.ts (DynamoDB, S3, HTTP API, CORS, throttling, logs), functions/api (Lambda)
server/             the API: http.ts (routes and the permission each needs), service.ts (workflow,
                    desk), events.ts (fees, attendance, winners, results), roles.ts, staffAccounts.ts,
                    reports.ts, auth.ts, dynamoStore.ts, files.ts (S3), sheets.ts, drive.ts, gmail.ts,
                    google.ts, pass.ts (PDF), validate.ts
src/                the website (content in src/content/), src/admin/ (staff dashboard),
                    src/lib/schedule.ts (registration phases), src/lib/staff.ts (roles), src/lib/csv.ts
landing/admin/      the dashboard's page (built to dist/landing/admin/index.html)
scripts/            google-auth.mjs, admin-password.ts, check-secrets.mjs, prerender.mjs
amplify.yml         Amplify build;  customHttp.yml  security headers
```

### Rate limiting and scale

Every layer scales on demand (CloudFront, API Gateway, Lambda, DynamoDB on-demand, S3) and every
layer has a limit, so a flood of requests is turned away cheaply instead of running up the bill:

| Layer | Limit |
| --- | --- |
| Website (Amplify Hosting, CloudFront) | Static and cached at the edge. Optionally turn on the **Amplify firewall** (below). |
| API Gateway, per route, all visitors together | `uploads`, `register` 50/s (burst 100) · `status` 25/s · `pass` 10/s · `admin/login` 2/s (burst 10) · other staff routes 30/s GET (burst 60), 20/s POST (burst 40) · `health` 5/s · whole API 100/s (burst 200). Unknown paths get a 404 without running the function. |
| Lambda, per network address | registration (upload + submit) `RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MINUTES` (300 per 10 min: a college network shares one address) · status/pass 120 per 10 min · staff sign-in 10 per account name per 15 min, and 1,000 per address (mobile networks put many phones behind one address) |
| Lambda, concurrency (optional) | `API_RESERVED_CONCURRENCY` caps simultaneous runs (e.g. `50`), which bounds cost and the Google API load |
| Logs | API access logs (address, route, status, latency) and function logs, kept 3 months in CloudWatch |

The limits per route are in `ROUTES` in `amplify/backend.ts`. A throttled form submission waits and
tries again with the same submission id (never a second registration), then asks the student to try
again in a minute.

**Amplify firewall (recommended for the event).** In the Amplify console: **Hosting → Firewall →
Enable firewall**, then add a rate-based rule (for example, block an address after 1,000 requests in
5 minutes) and the **Amazon IP reputation list**. It is AWS WAF and adds a monthly AWS charge (see the
Amplify Hosting and AWS WAF pricing pages before turning it on). It protects the website; the API is an API Gateway HTTP API, which WAF cannot be
attached to, so the gateway throttles and per-address limits above protect it.

## 3. Settings

All values live in AWS, never in git. `.env.example` lists every name.

**Amplify secrets** (required):

| Name | What |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth client |
| `GOOGLE_REFRESH_TOKEN` | from `npm run google:auth` |
| `GOOGLE_SHEET_ID` | the ID in `docs.google.com/spreadsheets/d/<ID>/edit` |
| `GOOGLE_DRIVE_PAYMENT_FOLDER_ID` | the ID in `drive.google.com/drive/folders/<ID>` |
| `ADMIN_USERNAME` | the dashboard's username |
| `ADMIN_PASSWORD_HASH` | from `npm run admin:password` (the password itself is never stored) |

**Amplify environment variables** (optional, not secret):

| Name | Default | What |
| --- | --- | --- |
| `GMAIL_SENDER` | the signed-in account | address emails are sent from (filled in `.env` by `google:auth`) |
| `MAIL_FROM_NAME` / `MAIL_REPLY_TO` | `PRAGYA 2026` / none | sender name, reply-to address |
| `GOOGLE_SHEET_TAB` | `Registrations` | sheet tab (created if missing) |
| `GOOGLE_DRIVE_PASS_FOLDER_ID` | auto | folder for passes; empty: "Participant Passes" next to the payment folder |
| `ALLOWED_ORIGINS` | none | extra site addresses allowed to call the API, e.g. a custom domain `https://pragya.rpsit.ac.in` |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MINUTES` | `300` / `10` | registration requests per IP address per window |
| `API_RESERVED_CONCURRENCY` | none | cap on simultaneous API runs, e.g. `50`; leave unset on a new AWS account (its concurrency quota may be too low to reserve any) |
| `SCHEDULE_ONLINE_CLOSES_AT` / `SCHEDULE_ONSITE_OPENS_AT` / `SCHEDULE_ONSITE_CLOSES_AT` | none | **sandbox rehearsals only**: move the registration schedule (IST, e.g. `2026-10-12T09:00:00`). Leave unset in production; an unreadable value keeps the API closed and `/api/health` names it |

Set automatically (do not set them): `REGISTRATIONS_TABLE`, `CONTROL_TABLE`, `FILES_BUCKET` and the
website's API address (`VITE_API_URL`, read from `amplify_outputs.json` at build time). Nothing in a
`VITE_*` variable is secret: it is visible in the browser.

## 4. Google API setup (once)

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the
   **Google Sheets API**, **Google Drive API** and **Gmail API**.
2. **OAuth consent screen**: add the scopes for Sheets, Drive and `gmail.send`, then set the
   publishing status to **In production**. While it says *Testing*, Google expires the refresh token
   after 7 days and registration stops.
3. **Credentials → Create credentials → OAuth client ID → Web application**, with the authorized
   redirect URI `http://localhost:3000/oauth2callback`. Download its JSON into a folder named
   `google client/` in this project (git ignores it).

   Use an **OAuth client**, not a service account: a gmail.com account cannot send email or keep
   Drive files through a service account. A service-account key (a JSON with a `private_key`) is not
   needed; keep it out of this project and delete the key in the console if nothing else uses it.
4. On your computer, with Node.js 22+:

   ```bash
   npm install
   cp .env.example .env        # then set GMAIL_SENDER to the Google account to use
   npm run google:auth         # sign in as GMAIL_SENDER, tick every box: saves the client and refresh token
   npm run google:setup        # makes the "PRAGYA 2026" Drive folder, the sheet and the passes folder
   npm run google:check -- --send-test-email   # checks the Sheet, the Drive folder and Gmail
   ```

   `google:auth` refuses a sign-in with any account other than `GMAIL_SENDER`. To use an existing
   sheet or folder instead, put their IDs in `GOOGLE_SHEET_ID` / `GOOGLE_DRIVE_PAYMENT_FOLDER_ID`
   before `google:setup`.
5. Copy the values from `.env` into the Amplify secrets and variables (section 9). Keep `.env` on
   your computer only.

**Moving to another Google account** (all new settings): keep the old `.env` aside (e.g.
`.env.old-account`, which git ignores), start a new `.env` from `.env.example` with the new
`GMAIL_SENDER`, follow steps 1 to 5 signed in to the new account, update every Google secret and
variable in Amplify, and redeploy. Then remove the app's access from the old account
(myaccount.google.com → Security → Third-party apps). Registrations already received keep their
IDs (the counter lives in DynamoDB) and their rows stay in the old sheet; copy those rows into the
new sheet if you want everything in one place.

## 5. AWS Amplify setup

1. Sign in to the AWS console and choose a region near the participants, e.g. **Asia Pacific (Mumbai)
   ap-south-1**. Open **AWS Amplify**.
2. **Create new app → GitHub**, authorize AWS Amplify, and pick the repository
   `Varshanrpsit057/Pragya2k26-Symposium-RPSIT`, branch **main**.
3. Amplify detects `amplify.yml` and the Gen 2 backend in `amplify/`. Keep the defaults: no monorepo
   root directory, the default Amazon Linux 2023 build image, and **create and use a new service role**
   (the backend deployment needs it).
4. **Save and deploy.** The first build can fail with a missing-secret error: that is expected until
   the secrets are set (step 9), after which you **Redeploy this version**.

## 6. GitHub connection

The branch you connect deploys on every push: backend first, then the website. Each branch gets its
own backend (its own tables, bucket and API) and its own secrets. To deploy, push to `main`:

```bash
git push origin main
```

## 7. Build settings

From `amplify.yml` (nothing to type in the console):

| Phase | Commands |
| --- | --- |
| Backend | `nvm install 22` · `npm install --no-audit --no-fund --cache .npm --prefer-offline` (from `package-lock.json`) · `npx ampx pipeline-deploy --branch $AWS_BRANCH --app-id $AWS_APP_ID` |
| Frontend | `nvm install 22` · `npm run build` (type-check, Vite build, prerender) |
| Output | `dist` (website at `/`, dashboard at `/landing/admin/`) |

Security headers (HSTS, nosniff, frame and referrer rules, and a strict Content-Security-Policy plus
no-store/noindex for the dashboard) come from `customHttp.yml`.

## 8. Backend deployment

`npx ampx pipeline-deploy` (run by Amplify) creates or updates the Lambda function, the HTTP API, the
DynamoDB tables, the private S3 bucket, the 30-minute schedule and the IAM permissions, then writes
the API address to `amplify_outputs.json` for the website build. CORS allows only the branch's own
`https://<branch>.<app-id>.amplifyapp.com` address and `ALLOWED_ORIGINS`.

The tables and the bucket are **kept** if the backend is ever deleted, so registrations are never lost
by accident (DynamoDB point-in-time recovery is on). Delete them by hand only when they are no longer
needed. Lambda logs are in **CloudWatch → Log groups → `/aws/lambda/…pragya-api…`**.

A personal test backend, with your own AWS credentials:

```bash
npx ampx sandbox secret set GOOGLE_CLIENT_ID     # …and each of the other secrets
npx ampx sandbox                                 # deploys it and writes amplify_outputs.json
npm run dev                                      # the site on http://localhost:5173 uses that API
```

## 9. Secret configuration

1. Make the admin password hash (choose a long, strong password; it is typed hidden and never saved):

   ```bash
   npm run admin:password
   ```

2. Amplify console → your app → **Hosting → Secrets → Manage secrets**, for the `main` branch, add the
   seven secrets from section 3 (copy the Google ones from `.env`, the hash from step 1).
3. Optional: **Hosting → Environment variables** for `GMAIL_SENDER` (from `.env`),
   `GOOGLE_DRIVE_PASS_FOLDER_ID` (from `google:setup`), `ALLOWED_ORIGINS` (custom domain) and the others.
4. **Redeploy** the branch. Secrets are read by the Lambda function when it starts; they never reach the
   website, the repository or the sheet. To rotate one, change it and redeploy.
5. **Keep AWS KMS in its free tier**: every secret is decrypted with AWS KMS each time the function
   starts, so only the three credentials (`GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`,
   `ADMIN_PASSWORD_HASH`) need to be secrets. Set the four identifiers (`GOOGLE_CLIENT_ID`,
   `GOOGLE_SHEET_ID`, `GOOGLE_DRIVE_PAYMENT_FOLDER_ID`, `ADMIN_USERNAME`) under **Hosting →
   Environment variables** with the same values and redeploy; the function then uses them instead
   of the secrets (which can be deleted afterwards). The DynamoDB tables use DynamoDB's own
   encryption key (free, no KMS calls), and the S3 bucket uses S3-managed encryption.

## 10. Production testing

After a deploy, on `https://main.<app-id>.amplifyapp.com`:

1. Register as a student (use your own email). The form shows **Registration Submitted · Pending
   verification** and a private status link; no pass and no email yet. The sheet gains a row with
   status `PENDING`; the screenshot is in the Drive payment folder.
2. Open the status link: **Pending verification**, no download.
3. Open `/landing/admin/`, sign in, select the registration, check the screenshot, tick the
   verification box, **Approve**. The pass and email show as done; the email arrives with the PDF; the
   sheet row says `APPROVED`, `GENERATED`, `SENT`.
4. The status link now offers **Download participant pass**.
5. Approve again: nothing new is sent. Reject another test registration: no pass, no email, the
   status link says it was not approved.
6. Remove your test rows from the sheet afterwards (new Registration IDs always continue after the
   highest ID already in the sheet).

`npm run check` runs lint, all tests (including the whole workflow against in-memory DynamoDB/S3/Google),
the build and the secret check.

## 11. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Build fails: secret not found | Add all seven secrets for that branch (section 9), then redeploy. |
| Form says registration "isn't open yet" | The API is missing a setting: CloudWatch logs list them under *not configured*. |
| Browser console: CORS error | The site's address is not allowed: add it to `ALLOWED_ORIGINS` and redeploy. |
| `invalid_grant` in the logs | The Google sign-in expired or was revoked: run `npm run google:auth` again, update `GOOGLE_REFRESH_TOKEN`, redeploy. Make sure the consent screen is *In production*. |
| Sheet shows "Waiting to sync" in the dashboard | Google was unreachable; the schedule retries every 30 minutes, without duplicates. |
| Email status **FAILED** | Gmail refused it (see the error). Use **Retry failed steps**; it is also retried automatically. |
| Email status **UNKNOWN** | Gmail did not confirm. Check the sender's Sent folder, then **Resend email** only if it is not there. |
| "Too many sign-in attempts" | 10 wrong attempts from one address: wait 15 minutes. |
| "The registration server is very busy" | A route's gateway throttle was reached (CloudWatch access logs show status 429). If it is genuine traffic, raise that route in `ROUTES` in `amplify/backend.ts` and push. |
| Deploy fails on `ReservedConcurrentExecutions` | The account cannot reserve that much concurrency: lower or remove `API_RESERVED_CONCURRENCY`. |
| `/landing/admin` shows the main page | Use `/landing/admin/`, or add a rewrite in **Hosting → Rewrites and redirects**: source `/landing/admin`, target `/landing/admin/index.html`, type `200`. |
| First registration right after the very first deploy says "temporarily unavailable" | The ID counter starts from the sheet's highest ID; the schedule sets it up within 30 minutes of the first deploy, or check the Google settings. |
| A staff member says "Your role cannot do this" | Their role lacks that permission (dashboard → Roles). An admin changes the role in Staff; it applies at once. |
| A coordinator says "This event is not assigned to your account" | Admin → Staff → Edit → tick the event. |
| "Ask an admin to authorise a correction" | The event's results are submitted and locked. An admin opens the event and chooses **Authorise correction** with a reason. |
| Fees and attendance are not in the Google Sheet yet | Event-day changes reach the sheet with the 30-minute schedule (DynamoDB is the record); wait, or check the sheet's *Event Fees Paid* / *Attended Events* columns later. |

## 12. Event day: desk, coordinators and certificates

### The schedule (automatic)

| When (IST) | Public website | Registration desk | Coordinators |
| --- | --- | --- | --- |
| until 16 Oct, 11:59 PM | online form, countdown | closed | read only |
| 16 Oct, 11:59 PM – midnight | "Online registration closed; on-site on 17 October" | closed | read only |
| 17 Oct, until 11:59 AM | "On-site registration open · Closes today at 11:59 AM"; no online form | open | fees, attendance, winners |
| 17 Oct, from 11:59 AM | "Registration closed"; Student login, help desk and Route map stay up front | closed (the API refuses with `ONSITE_CLOSED`) | fees, attendance, winners |
| from 18 Oct | "Registration closed" | closed | may still finish and submit results |

The API decides from its own clock on every request (`src/lib/schedule.ts`); the website only mirrors
it. The Google Form fallback link disappears with the online form, but **the Google Form itself must
be closed by hand** (Forms → Responses → *Accepting responses* off) at 11:59 PM on 16 October.

### Event-day controls (admins)

- **Registration times**: reopen or extend on-site registration until a time (e.g. the desks stay
  open until 2 PM; if the desk was not open yet it opens now and online registration closes), close
  every registration now, set all three times, or go back to the planned times. The change becomes
  the real schedule: the API, the desks, Student login and the website follow it within seconds,
  and every closing time shown on the site follows it. Every dashboard shows a banner while the
  times differ from the plan. A test timeline (Testing) still replaces it while one is on.
- **Notice on the website**: one line (up to 300 characters, e.g. a venue or time change) at the
  top of the home page and the student page; every open page shows it within two minutes, and
  every dashboard shows it too. Take it down when it no longer applies.
- **Student coordinators**: **Sign out** someone on every device (e.g. a lost phone; they can sign
  in again), deactivate an account, or **Delete** it (e.g. accounts made for testing; the username
  can be used again, and what they recorded keeps their name).

### Roles

| Role | May | Events |
| --- | --- | --- |
| **Admin** | everything below, plus **Event-day controls** (the registration times and the notice on the website), student coordinator accounts (create, change, sign out, delete), who is signed in now (with desk numbers), cancelling or deleting records, corrections (void a fee, reopen results), reports and the Excel downloads, and **Testing** (test sessions) | all |
| **Registration desk** | search registrations, register students at the desk on any day (cash, or GPay the student pays from Student login), approve GPay payments from the student's screenshot, correct details, add or remove events | all |
| **Event coordinator** | look up participant IDs, add a participant to the event, take the ₹50 fee (cash, or approve the student's GPay screenshot), mark attendance, enter winners, submit results, download the event's Excel | assigned only |
| **Certificate team** | read every event's participants (present first) and the three prizes with each student's details; Excel | all (read only) |
| **Web assistant team** | registrations (read, correct details, retry, delete), the **Deleted** list (restore), help requests and replies, system status, campus map, the Student login switch | all |

The dashboard's **Roles** section shows the same list (it is read from `src/lib/staff.ts`, which the
server enforces). Students who registered online download their pass from **Student login**; desk
registrations get no pass (the Registration ID is enough); the dashboard does not
offer passes.

### Desk numbers

Each registration desk sign-in says which desk it is at (picked on the sign-in page, filled in from a
username like `desk2`, or asked right after signing in). The desk number is kept on every
registration and gate pass made there; admins see it in the list, the record, **Reports** (by desk),
the Excel files and **Student coordinators → Signed in now**.

### Money and attendance rules

- Registration status, the gate pass and each event fee are separate records, each with who
  recorded it, at which desk, and when.
- Cash counts as received only when the staff member ticks that it is in hand.
- Screenshots: the dashboard shows a small JPEG copy (at most 720 px wide, `previews/payments/…` in
  S3, made the first time anyone opens it), with **Open the original** for the file exactly as the
  student uploaded it. The originals are never changed; they stay in S3 and are copied to Drive.
- GPay at the desk or a venue: the student pays from **Student login** (the QR and a UPI-app button)
  and uploads the screenshot; the desk (gate pass) or the event's coordinator (event fee) checks it,
  types the transaction ID from it and approves it. A transaction ID is never accepted twice. Each
  record shows the screenshot, the ID the student typed and the one entered, flagged when they differ.
- Attendance is marked only after: the gate pass is verified (registration approved), the participant
  is registered for that event, and that event's fee is recorded. Winners must be marked present.
- Submitting an event's results snapshots its participant list, attendance list and winners and locks
  the event. An admin can **Authorise correction** (with a reason); the coordinator then submits again,
  and earlier submissions stay listed with their times.

### No data is lost

DynamoDB is the record (point-in-time recovery, deletion protection, kept if the stack is deleted).
Every change is also copied to the Google Sheet (every detail, including transaction IDs, fees and
attendance) and to a JSON file per student in Drive (**Student Records**, next to the payment
screenshots folder), and students' screenshots are copied to Drive. If Google is down the copies
catch up automatically (System status shows it). Deleting a record keeps its whole data in the log,
its files (S3 keeps every version) and its Sheet row and Drive file, marked DELETED.

### Before the event (manual)

1. Sign in as the owner admin and create accounts in **Student coordinators**: one `DESK` account per
   laptop (e.g. `desk1`…`desk4`), one or more `COORDINATOR` accounts per event (tick their events),
   the `CERTIFICATE` and `SUPPORT` (web assistant team) accounts, and any extra admins. Use
   **Generate** for passwords and hand each over privately.
2. Rehearse as often as you like with **Testing** (below).
3. Make sure whoever approves GPay payments can see the receiving account's credits on the day.

### Test sessions (Testing, admins)

Rehearse on the live website without touching real students' registrations:

1. **Start an event-day test**: starts a test session and opens on-site registration now (for the hours
   chosen). Every coordinator sees a yellow banner while it is on. Everything registered meanwhile (at
   the desk or online) and every help request is marked **TEST**.
2. Test the desk, GPay approvals, events (fees, attendance, winners), Student login and the certificate
   lists. **Timeline** sets other moments: online open now, closed (after the event), or your own
   day and times. The website and the API follow the timeline within seconds, for everyone: while it
   is on, online registration opens or closes with it.
3. **Test data** lists the TEST records. **Keep: a real student** takes the mark off one made by a real
   student during the test; **Mark as test** marks one made before the session.
4. **Delete the test data** (type `DELETE TEST DATA`): the TEST records are saved to a private backup
   file in the files bucket (`backups/…`), then deleted with their files (Drive copies go to the
   trash), their Sheet rows marked `TEST CLEARED`, and their phones and emails freed. Optionally: clear
   event results, delete test help requests, start desk IDs again at 262001 (only when no real desk
   registrations exist), and end the session and go back to the real schedule.

The real schedule (`src/content/site.ts`) applies again as soon as the test timeline is removed: on
17 October the website switches to on-site registration by itself.

### Deleted records

Admins and the web assistant team can delete a record (a duplicate or a mistake). It leaves every list
and goes to **Deleted** (web assistant team and admins only), with who deleted it, when and why;
**Restore** brings it back as it was, unless its phone, email or payment reference has since been used
by another registration.

### After the event

The certificate team downloads the results Excel (participants, certificate list of those present,
winners) from *Results & certificates*; a file named `…-NOT-FINAL-…` contains an event whose
coordinator has not submitted yet. Admins reconcile cash per staff member and per desk in **Reports**,
and keep **Download all data (Excel)** as their own copy.

## 13. Going live (do this last)

The code is ready; these steps are yours, in this order. Nothing here is done automatically.

1. **Content to confirm** (`src/content/`): the help desk phone numbers (`site.ts` → `helpDesk`;
   phone and WhatsApp only for now), the web team and admin numbers for Contact admin
   (`helpContacts.ts`), the team size limits of team events, and the UPI QR image.
2. **Checks**: `npm run check` passes (lint, tests, build, secret check).
3. **Merge and deploy**: merge the feature branch into `main` and push; Amplify builds and deploys.
   This release adds deletion protection to both tables, versioning to the files bucket (it can be
   suspended later, never removed), and the Student login and Contact admin routes to API Gateway.
4. **After the deploy**: `/api/health` answers `ready`; sign in as the owner; create the accounts
   (above). The Sheet gains its new columns and Drive its **Student Records** folder by themselves
   on the first copy.
5. **Before the day**: in **Testing**, delete the test data and go back to the real schedule (no
   yellow banner on the dashboard).
6. **On the day**: every desk signs in with its desk number; check **System status**; keep
   **Student login** on (pause it only if the desks need the network).
7. Optional: set `API_RESERVED_CONCURRENCY` (e.g. 50) as a cost ceiling, if the account allows it.

## Local development

```bash
npm install
npm run dev          # http://localhost:5173 (the form needs an API: a sandbox, see section 8)
npm test             # all tests
npm run check        # lint + tests + build + secret check
```

Turn on the pre-commit secret check once per clone: `git config core.hooksPath .githooks`.
If a real secret is ever committed or pushed, rotate it: deleting it from git is not enough.

Content (dates, venue, fees, UPI details, contacts, events, rules) lives in `src/content/`:
`site.ts` (dates, registration closing time, fees, payment details, college, socials, the overall
coordinator in `contacts`), `events.ts` and `eventCatalog.ts` (the five technical events: description, time,
venue, prizes, coordinators), `eventInfo.ts` (See More details), `crew.ts` (Dev Crew; `credited`
members are named under "Developed by" in the footer).

The PRAGYA emblem is an SVG drawn in code (`src/components/brand/PragyaEmblem.tsx`, colours in its
gradients); `BrandEmblem.tsx` moves it from the hero into the page background as visitors scroll.

Event posters are WebP files named after the event id in `src/assets/events/`: `<id>.webp` (3:4,
about 420×560, for the circular carousel and the poster wall behind Register) and
`<id>-large.webp` (the whole artwork, about 840 px wide, for the event panels). Replace both files
to change a poster; the originals stay in `image/` on your computer (git ignores that folder).
The fonts (Mona Sans, SIL Open Font License) are self-hosted in `public/fonts/`.
