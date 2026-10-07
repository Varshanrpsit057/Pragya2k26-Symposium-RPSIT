# PRAGYA 2026

Website, registration and admin approval for **PRAGYA 2026**, the AI & technology symposium of the
Department of Artificial Intelligence and Data Science, **R P Sarathy Institute of Technology, Salem**.

It is deployed straight from GitHub to **AWS Amplify**: no servers to run, no SSH, no manual uploads.

## 1. Project overview

- **Public website** (React + TypeScript + Vite, prerendered): hero with the PRAGYA 2K26 emblem and the
  registration countdown, the ten events, the registration form, and the footer.
- **Registration form**: participant details, event selection, the ₹100 gate-pass payment details,
  the payment screenshot and the transaction ID.
- **Admin dashboard** at `/landing/admin/`: sign in, check each payment screenshot, then approve or
  reject. It is not linked anywhere on the public site.
- **Registration workflow**:

  ```
  student submits ─▶ PENDING ─▶ admin checks the payment ─┬─▶ APPROVED ─▶ participant pass (PDF)
                                                           │                ─▶ confirmation email with the PDF
                                                           └─▶ REJECTED  (no pass, no confirmation email)
  ```

  Submitting the form never confirms a registration: only an admin's approval does. The participant
  pass is made, stored and handed out by the server only after approval.

## 2. Architecture

```
GitHub ──push──▶ AWS Amplify Hosting (build: amplify.yml)
                   ├─ website: dist/ (React/Vite) on Amplify's CDN
                   └─ backend: amplify/ (Amplify Gen 2, AWS CDK)
                        HTTP API (API Gateway) /api/*  ──▶  Lambda "pragya-api" (Node.js 22)
                        EventBridge, every 10 min      ──▶  same Lambda: retries
                        DynamoDB  Registrations, Control   (workflow state, IDs, sessions)
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
- **Admin sign-in**: one username and a scrypt password hash, both Amplify secrets. Sign-in gives a
  random session token (8 hours, stored only as a hash, with sign-in attempts rate limited). Every
  `/api/admin/*` route checks it on the server. Changing the password signs every session out.

```
amplify/            backend.ts (DynamoDB, S3, HTTP API, CORS, throttling), functions/api (Lambda)
server/             the API: http.ts (routes), service.ts (workflow), auth.ts, dynamoStore.ts,
                    files.ts (S3), sheets.ts, drive.ts, gmail.ts, google.ts, pass.ts (PDF), validate.ts
src/                the website (content in src/content/), src/admin/ (dashboard)
landing/admin/      the dashboard's page (built to dist/landing/admin/index.html)
scripts/            google-auth.mjs, admin-password.ts, check-secrets.mjs, prerender.mjs
amplify.yml         Amplify build;  customHttp.yml  security headers
```

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
4. Create the **Google Sheet** and a **Drive folder** for payment screenshots, with the Google
   account that will send the emails.
5. On your computer, with Node.js 22+:

   ```bash
   npm install
   cp .env.example .env        # then fill in GOOGLE_SHEET_ID and GOOGLE_DRIVE_PAYMENT_FOLDER_ID
   npm run google:auth         # sign in, tick every box: saves the client, refresh token and sender to .env
   npm run google:check        # checks the Sheet, the Drive folder and Gmail
   npm run google:setup        # formats the sheet and creates the "Participant Passes" folder
   ```

6. Copy the values from `.env` into the Amplify secrets and variables (section 9). Keep `.env` on
   your computer only.

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
| Backend | `nvm install 22` · `npm ci --cache .npm --prefer-offline` · `npx ampx pipeline-deploy --branch $AWS_BRANCH --app-id $AWS_APP_ID` |
| Frontend | `nvm install 22` · `npm run build` (type-check, Vite build, prerender) |
| Output | `dist` (website at `/`, dashboard at `/landing/admin/`) |

Security headers (HSTS, nosniff, frame and referrer rules, and a strict Content-Security-Policy plus
no-store/noindex for the dashboard) come from `customHttp.yml`.

## 8. Backend deployment

`npx ampx pipeline-deploy` (run by Amplify) creates or updates the Lambda function, the HTTP API, the
DynamoDB tables, the private S3 bucket, the 10-minute schedule and the IAM permissions, then writes
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
| Sheet shows "Waiting to sync" in the dashboard | Google was unreachable; the schedule retries every 10 minutes, without duplicates. |
| Email status **FAILED** | Gmail refused it (see the error). Use **Retry failed steps**; it is also retried automatically. |
| Email status **UNKNOWN** | Gmail did not confirm. Check the sender's Sent folder, then **Resend email** only if it is not there. |
| "Too many sign-in attempts" | 10 wrong attempts from one address: wait 15 minutes. |
| `/landing/admin` shows the main page | Use `/landing/admin/`, or add a rewrite in **Hosting → Rewrites and redirects**: source `/landing/admin`, target `/landing/admin/index.html`, type `200`. |
| First registration right after the very first deploy says "temporarily unavailable" | The ID counter starts from the sheet's highest ID; the schedule sets it up within 10 minutes of the first deploy, or check the Google settings. |

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
`site.ts` (dates, registration closing time, fees, payment details, college, socials), `events.ts`
and `eventCatalog.ts` (the ten events), `eventInfo.ts` (See More details), `crew.ts` (Dev Crew).
The fonts (Mona Sans, SIL Open Font License) are self-hosted in `public/fonts/`.
