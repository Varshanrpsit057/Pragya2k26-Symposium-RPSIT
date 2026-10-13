# INFINITE TECHFEST'26 · On-site Registration Portal: fest handbook

This is the one guide for running the college-wide fest on **https://pragya2k26.online**. It covers
every link, every account, what each person does and what to do when something goes wrong. The
technical details (architecture, deployment, Google set-up) are in [README.md](README.md).

**No passwords are written here.** Passwords are made in the dashboard when the accounts are
created, downloaded once as an Excel file and handed out privately. Settings are named, never their values.

---

## Contents

1. [The links](#1-the-links)
2. [Do these first: setup after the deploy](#2-do-these-first-setup-after-the-deploy)
3. [Who does what (roles)](#3-who-does-what-roles)
4. [Every account](#4-every-account)
5. [Every event and its link](#5-every-event-and-its-link)
6. [Registration IDs, and what happens when a desk runs out](#6-registration-ids-and-what-happens-when-a-desk-runs-out)
7. [How to: registration desk](#7-how-to-registration-desk)
8. [How to: event coordinator](#8-how-to-event-coordinator)
9. [How to: department admin](#9-how-to-department-admin)
10. [How to: the overall coordinator (HOD)](#10-how-to-the-overall-coordinator-hod)
11. [How to: web assist team (on-the-spot changes)](#11-how-to-web-assist-team-on-the-spot-changes)
12. [Event-day run sheet](#12-event-day-run-sheet)
13. [When something goes wrong](#13-when-something-goes-wrong)
14. [Data safety and backups](#14-data-safety-and-backups)
15. [After the event](#15-after-the-event)
16. [Numbers, limits and settings](#16-numbers-limits-and-settings)
17. [For developers](#17-for-developers)

---

## 1. The links

**Always keep the slash at the end of a dashboard address** (`…/admin/`).

| What | Link | For |
| --- | --- | --- |
| Home page | https://pragya2k26.online/ | The fest's front door for students: **Register now**, **My registration ID**, the website notice, the footer (contacts, map, Dev Crew). No staff links: staff type the dashboard address |
| **Students' page** | https://pragya2k26.online/register/ | Students register themselves on their phone and see their ID and payment status (also at the old `/landing/student/` address) |
| Main dashboard | https://pragya2k26.online/landing/admin/ | Web assist team, overall coordinator; its sign-in also lists the 8 department staff pages |
| API health check | https://683v5yp7k4.execute-api.us-east-1.amazonaws.com/api/health | Web assist team: shows `ready` when the API is up |
| Live schedule (public) | https://683v5yp7k4.execute-api.us-east-1.amazonaws.com/api/schedule | The registration times the website is following now |

### Department dashboards

The department admin, the 2 desks and the event coordinators of a department all sign in on
their department's page. Each page only opens that department's data. Someone who signs in on the
wrong department's page is told which page is theirs.

| Code | Department | Dashboard link | Staff coordinator | Student coordinator | Events |
| --- | --- | --- | --- | --- | --- |
| **CSE** | Computer Science and Engineering | https://pragya2k26.online/landing/cse/admin/ | Mr. M. Ramesh (9500535551) | Mr. P. Bhuvankumar (9342232411) | 6 |
| **AI&DS** | Artificial Intelligence and Data Science | https://pragya2k26.online/landing/aids/admin/ | Mrs. S. Priyanka (9025593180) | Mr. Balajimanikandhaan S S (7358213736) | 5 |
| **IT** | Information Technology | https://pragya2k26.online/landing/it/admin/ | Mrs. A. Santhi (8667845282) | Ms. G. Akshaya (6381761876) | 6 |
| **ECE** | Electronics and Communication Engineering | https://pragya2k26.online/landing/ece/admin/ | Mrs. S. Apshanaparvin (9943044232) | Mr. N. S. Shamraj (9894183263) | 6 |
| **CYBER** | Computer Science and Engineering (Cyber Security) | https://pragya2k26.online/landing/cys/admin/ | Mr. C. Mahavishu (9629039155) | Ms. R. Kavisri (6374794582) | 6 |
| **EEE** | Electrical and Electronics Engineering | https://pragya2k26.online/landing/eee/admin/ | Mr. M. Dineshkumar (9626132311) | Mr. G. Santhosh (8667685436) | 5 |
| **MECH** | Mechanical Engineering | https://pragya2k26.online/landing/mech/admin/ | Mr. S. Vijayakumar (9629723720) | Mr. N. Jayanishanth (7200116278) | 6 |
| **S&H** | Science and Humanities | https://pragya2k26.online/landing/sh/admin/ | Dr. K. Saranya (9789158113) | Mr. Shaher (7418119675) | 4 |

**Total: 8 departments, 44 events.** Contacts are from the poster; change them in
**Departments & events** (section 11).

### The home page, the students' page and the events website

pragya2k26.online's home page (`src/landing/Landing.tsx`) is the fest's front door on the PRAGYA sky
background: the fest's name and date, **Register now** (a pop-up of the 8 departments, each to its form) and **My registration ID** (to `/register/?my`: the
student's registration, by ID and mobile number), the three steps
for students, the **Notice on the website**, then the footer (the RPSIT lockup and INFINITE TECHFEST’26, Contact Us, Developed by,
Follow Us, Location) and "Overall coordinated by the Department of Artificial Intelligence and Data
Science". It links to no staff page (nor does the students' page): staff open `/landing/admin/`
by its address, and its sign-in lists every department's own staff page.

**The route map is no longer on this site.** Its code was archived to `routemap.zip` on the
Desktop (13 October 2026). Every department's events and the route map are on a separate website run
by another team member (the `pragya-events-site` project). When it has an address, set
`EVENTS_SITE_URL` at the top of `src/landing/Landing.tsx` to it and deploy: the home page then shows
an **Events and route map** button.

### Students who register on their phones (IDs CSE-2001…)

1. **The student**, on their own phone, taps **Register now** on the home page: a pop-up shows the
   **8 departments**; they choose theirs (or open https://pragya2k26.online/register/, which asks for
   the department first). Then: name, mobile number, email, college (searchable list), **stream**
   (B.E., B.Tech., B.Sc.…) and **department** (CSE, ECE, Mechanical…, or Other to type it), both
   **dropdowns with a search box**, year and team name (optional). Stored together as the
   "department / course" (`B.E. CSE`). No staff sign-in, no events (they register for events at each
   venue).
2. **They get their department's ID at once**, large on the screen: **CSE-2001, CSE-2002…**
   (AI&DS-2001, CYBER-2001…). The ID stays on the phone (it is there whenever they open the page
   again). If the connection drops while registering, what they typed is kept; sending again never
   registers them twice.
3. **The payment page, right after Register:** *How will you pay the ₹100 entry fee?*
   - **Pay now by UPI**: the **QR code** the web assist team uploaded (Website controls), the UPI ID
     to copy and an **Open a UPI app** button (amount and their ID filled in). After paying they
     **must type the 12-digit UTR** (GPay: "UPI transaction ID"; PhonePe: "UTR"; Paytm: "UPI Ref No")
     and send it. A UTR already accepted for someone else is refused at once.
   - **Pay at the desk**: cash (or UPI) at their department's registration desk.
   Either way they always have their ID, and the desk completes the payment. While **online
   payment** is switched off (Website controls), only the desk is offered.
4. **That department's desks** open **Registration desk → Verify payments (n)**: the students who
   sent a UTR, oldest first, showing only the **last 4 digits** of each student's UTR. The desk
   **types the UTR of the payment it received** (from the receiving account, or the student's payment
   screen). The screen says at once **✓ Matches** or **✗ Does not match**, and warns when **another
   registration has the same UTR** (sent by two students: only one can be verified; already accepted:
   *Duplicate*, cannot be verified). **Verify** needs a match and the tick *I have seen ₹100
   received*. The server checks both again: a UTR is accepted **once across the whole fest**, for
   UTRs sent by students and for UPI payments taken at a desk. **Not found…** (with a reason) tells
   the student, who can send the right UTR. Tip: typing a received payment's UTR in **Find** shows
   whose it is.
5. **The student's page** shows *Verified* (it checks by itself while waiting).
6. **At the venue**, the student gives their ID: the event's coordinator adds them, takes the event
   fee and marks them present. Attendance needs the entry fee verified.

**My registration ID** (home page): on the phone that registered, the ID shows at once. On another
phone the student types the **mobile number and email** they registered with (not the ID): it finds
their registration in every department (shown only; paying by UPI is done on the phone that
registered). A few tries per mobile number every 10 minutes. It can be switched off in Website
controls; then students ask at a desk, which finds anyone by mobile number.

**Where they show:** like any registration of the department: its desks, event coordinators and
department admin, the overall coordinator and the web assist team. Filters: **Registered → On their
own phone**, **Entry fee → Waiting for a desk to check**. The overview has a **Payments to check**
count.

### Colleges (overall coordinator, department admins, web assist)

The **Colleges** tab: for each college, how many students came, and how many **1st, 2nd and 3rd
places** its students won (submitted results only; a team counts once for its college). Tap a heading
to sort, a college to see its students; **Download (Excel)**. The **College** filter (a list
of every college with its number of students) also narrows every other view. College names typed
differently (`Sona College of Technology, Salem` / `sona college of technology salem.`) count as one.

### Event links

Every event also has its own link: the department page with `?event=<event ID>` at the end, for
example https://pragya2k26.online/landing/cse/admin/?event=cse-hackathon. After signing in it opens
straight on that event's window. Send each coordinator their event's link. All 44 are listed in
[section 5](#5-every-event-and-its-link).

---

## 2. Do these first: setup after the deploy

Do them in this order. Each one is yours: nothing here happens by itself.

### 2.1 Check the deploy (2 minutes)

1. Open the API health check link (section 1). It should say `ready`.
2. Open https://pragya2k26.online/ and a department page, e.g.
   https://pragya2k26.online/landing/cse/admin/. The sign-in form should appear.
3. Sign in at https://pragya2k26.online/landing/admin/ with the owner account (the `ADMIN_USERNAME`
   set in Amplify). You should see **Overview** with 8 departments and 44 events.

### 2.2 Keep AWS KMS free (5 minutes, once)

The DynamoDB tables now use DynamoDB's own free encryption key. The API runs its schedule every
10 minutes (the fest's backup to the Google Sheet), and each run that starts a fresh function
decrypts its secrets with KMS: up to a few tens of thousands of requests a month (the first 20,000
are free; more cost about 3 cents per 10,000). To cut them, move the four identifiers from secrets to
plain environment variables:

1. Amplify console → the app → **Hosting → Environment variables** → for the `main` branch add, with
   **the same values** as their secrets:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_SHEET_ID`
   - `GOOGLE_DRIVE_PAYMENT_FOLDER_ID`
   - `ADMIN_USERNAME`
2. **Redeploy** the `main` branch and wait for it to finish. Check 2.1 again.
3. Only then, in **Hosting → Secrets**, delete those four secrets. Keep the three real credentials as
   secrets: `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `ADMIN_PASSWORD_HASH`.

Order matters: never delete a secret before its environment variable is set and deployed.

### 2.3 Raise the Lambda limit to 1,000 (do it today: AWS can take a few days)

The AWS account can run only **10** copies of the API at once. With 300 phones that is not enough.

AWS console → **Service Quotas** → **AWS Lambda** → **Concurrent executions** → **Request increase**
to **1000**, region **us-east-1** (N. Virginia). The text for the request was drafted earlier: one
college-wide event, ~300 staff phones, 1,000+ registrations in one day, short requests (under a
second), API Gateway in front. Raising the limit costs nothing by itself: you pay only for requests
actually made.

### 2.4 Close online registration on the PRAGYA website

Online registration comes only from the Netlify form on the poster, so the PRAGYA website's own
online form should be closed.

Main dashboard → **Event-day controls** → **Registration times** → **Set all three times**:

| Time | Set it to |
| --- | --- |
| Online registration closes | now (or a minute from now) |
| On-site registration opens | the event day, the time the desks open (e.g. 17 Oct, 8:00 AM) |
| On-site registration closes | the time the desks stop (e.g. 17 Oct, 1:00 PM) |

The planned times are: online closes 16 Oct 11:59 PM, on-site 17 Oct from midnight to 11:59 AM. The
desks are refused new registrations after the on-site closing time, so set it to when the desks
really stop. You can extend it on the day in one tap (section 11).

### 2.5 Fill in the departments and events

Main dashboard → **Departments & events**. For each department: the HOD's name, contacts, number of
desks (4). For each event: **venue**, **time**, **fee** (₹50 now), **team size** (now "individual or
team of up to 4" for all), open or closed. The entry fee (₹100 now) is at the top. **Save**: every
phone sees the change within 15 seconds.

The venue and time appear in the event windows, the overview ("By event and venue") and the
overall coordinator's **Venue** filter, so fill them in before the day.

### 2.6 Create the accounts

1. Main dashboard → **Accounts** → **Create a department's accounts** → choose the department →
   **Create**. It makes the department admin, **2 desks** and **1 coordinator per event** (9 accounts for CSE, 68 for all 8 departments) with strong passwords. There is **no HOD account per department**: the HOD is the overall coordinator.
2. **Download the new logins (Excel) straight away.** The passwords are shown only once.
3. Repeat for all 8 departments.
4. Create, by hand, in **Accounts → New account**:
   - the **overall coordinator, the HOD** (role *Overall coordinator (HOD)*), no department;
   - the **web assist team**'s account (role *Web assist team*).
5. Hand each person their username, password and link privately (WhatsApp to that person only,
   or a printed slip). Never post the Excel file in a group.
6. Department HOD accounts made earlier (`<dept>-hod`) are no longer used: the account creator lists
   them; deactivate or delete them.

The usernames are listed in [section 4](#4-every-account). Accounts that already exist are skipped,
so running it again is safe.

### 2.7 Upload the online registrations (each department, before the day)

Each department admin downloads their department's registrations from the Netlify form as CSV and
uploads it: department page → **Online & paper** → **Online registrations** (section 9). Ask for one
sample CSV first so the column matching can be checked.

### 2.8 Rehearse, then delete the test data

1. Main dashboard → **Testing** → **Start an event-day test**. Everything registered while the test
   session is on is marked **TEST**. Every dashboard shows a yellow banner.
2. Get one desk, one coordinator and the overall coordinator on their own phones, **on mobile data**,
   and run the whole flow: register, check in, take a fee, mark present, submit winners. Switch a
   desk phone to airplane mode, register two students, switch it back and watch them send.
3. **Testing → Delete the test data** (type `DELETE TEST DATA`), tick **end the session and go back
   to the real schedule**. Test records are saved to a private backup first, then deleted, and the
   ID counters start again from 0001 where nothing real was registered.
4. Check that the yellow banner has gone.

**Load test with 1,000 mock participants:** **Testing → Load test → Add 1,000 mock participants**.
It adds mock students, most from the colleges around Salem (Sona, Dhirajlal Gandhi, PMC Tech,
Shreenivasa, GEC Salem, then the others nearby), 125 in each department with phone IDs (CSE-2001…):
some paid at a desk, some waiting for a desk to check their UTR, some not paid, with events, fees and
attendance. All are marked **TEST**, and there are never more than **1,000** test registrations
(pressing it again only tops up to 1,000). Every dashboard shows them within 15 seconds; delete them
with **Delete the test data**. On the live site they are real records in the database until
deleted, so the overall coordinator sees them (with the TEST badge) in every count meanwhile.

Note: a test timeline changes the public website's registration times for everyone while it is on.

### 2.9 Before the day (physical)

- Two phones at each desk, on **different carriers** (Jio + Airtel, for example), charged, with
  power banks.
- **Paper slips** printed for each department (section 9), in case every phone at a desk fails.
- Every desk, coordinator and the overall coordinator has signed in once on the phone they will use, before the day.
- One web assist member per two or three departments, reachable by phone.

---

### 2.10 Load test: 300 phones at once (once, before the day)

`scripts/load-test.mjs` acts like 300 staff phones using the dashboard on the day: every phone
signs in and asks for changes every 15 seconds; 64 desk phones register students; coordinator phones
take event fees and mark attendance; department admins and the overall coordinator watch; and 200
students register themselves on their phones while the desks verify their payments (`--students`).
About 25–40 requests a second, about 1,000 test registrations in 10 minutes.

**Safe by design:** it refuses to start unless a test session is on (so everything it registers is
marked TEST), makes its own `lt-…` accounts with a random password it never shows, deletes them at
the end (also on Ctrl+C), and stops by itself if more than half the requests fail for a minute.
**Cost:** about 20,000 requests, a few rupees at most (most likely inside the AWS free tier).

1. Pick a quiet time (nobody using the dashboard for real) and tell the team it may be slow for 15
   minutes.
2. Note the Lambda limit (AWS console → Service Quotas → AWS Lambda → Concurrent executions →
   *Applied quota value*). Run the test either way: at 10 it shows whether 10 is enough.
3. Dashboard → **Testing → Start an event-day test** (label it "Load test").
4. On a laptop with good internet (Wi-Fi or wired), in this folder:
   ```bash
   npm run load-test -- --admin YOUR_ADMIN_USERNAME
   ```
   Type the admin password when asked (hidden). It waits 10 seconds (Ctrl+C cancels), makes the
   accounts, brings the 300 phones in over 2 minutes, then runs 10 minutes at full load, printing a
   line every 15 seconds.
5. While it runs, open the dashboard **on a phone on mobile data** as the overall coordinator and
   check it stays quick: that is the real test.
6. At the end it prints a table (each kind of request: how many, how many failed, how long they
   took: p50 = typical, p95 = slowest 1 in 20), a verdict (PASS: under 1% failed, changes p95
   under 2 s, register p95 under 3 s), saves `load-test-report-….json`, and deletes the `lt-`
   accounts.
7. Dashboard → **Testing → Delete the test data** (type `DELETE TEST DATA`), tick going back to the
   real schedule. Check the yellow banner has gone.

Reading the result: 429, 503 or 500 answers mean the server turned requests away, usually the Lambda
limit (10 until AWS raises it) or a route throttle. On the day the desks would retry by themselves,
but raise the limit before the day. Options: `--devices 150`, `--minutes 5`, `--ramp 60`. To run it
again, wait 15 minutes (each account may sign in 10 times per 15 minutes from one address).

## 3. Who does what (roles)

| Role | Signs in at | Sees these sections | Can do |
| --- | --- | --- | --- |
| **Owner** (the `ADMIN_USERNAME` account) and **web assist team** (role Admin) | `/landing/admin/` (or any department page) | Everything: Overview, Registrations, Results, Colleges, Register, Event windows, Online & paper, Departments & events, **Website controls**, Accounts, Event-day controls, Help requests, System status, Testing, Roles | Everything, in every department, on the spot; switches every part of the portal on or off; controls and watches every login |
| **Overall coordinator (HOD)** | `/landing/admin/` | Overview, Registrations, Results, Colleges, Roles | Every department and every event live, filtered on every category; winners; college-wise places; **Excel downloads** of exactly what the filters show; reopen submitted results; cancel an event fee recorded by mistake |
| **Department admin** | their department page | Overview, Registrations, Results, Colleges, Register, Event windows, Online & paper, Roles | Upload online registrations, paper slips, register, verify payments, correct details, change events, cancel, any event of the department |
| **Registration desk** (2 per department) | their department page | Registration desk, Roles | **Verify payments**: type the UTR, which must match the student's and be unused; take the entry fee in cash or UPI; register walk-ins (works with no signal); find and check in; add events; desk totals |
| **Event coordinator** (1 per event) | their department page (or their event link) | My events, Roles | Their event: students, event fee, attendance, add a department student, winners, submit |

- The **Roles** section in the dashboard shows the same list, read from the code the server enforces.
- Department roles (department admin, desk, coordinator) only ever see their own department,
  whichever page they open.
- Nobody outside the web assist team can make or change accounts.

---

## 4. Every account

These are the usernames **Create a department's accounts** makes. Passwords are in the Excel file
downloaded when they were created.

| Code | Department admin | Desks (desk number is fixed) |
| --- | --- | --- |
| CSE | `cse-admin` | `cse-desk1`, `cse-desk2` |
| AI&DS | `aids-admin` | `aids-desk1`, `aids-desk2` |
| IT | `it-admin` | `it-desk1`, `it-desk2` |
| ECE | `ece-admin` | `ece-desk1`, `ece-desk2` |
| CYBER | `cys-admin` | `cys-desk1`, `cys-desk2` |
| EEE | `eee-admin` | `eee-desk1`, `eee-desk2` |
| MECH | `mech-admin` | `mech-desk1`, `mech-desk2` |
| S&H | `sh-admin` | `sh-desk1`, `sh-desk2` |

Event coordinators: one per event, `<dept>-<event>` (for example `cse-hackathon`), listed with each
event in section 5. The overall coordinator (the HOD) and the web assist team's accounts are made by
hand (2.6); pick usernames such as `overall` and `webassist`.

**Counts:** 8 department admins + 16 desks + 44 coordinators = **68** department accounts, plus the
overall coordinator and the web assist team.

**If two people share a desk phone**, they use the same desk account. **If a department needs a
3rd desk**, create it by hand in **Accounts → New account** (role Registration desk, the department,
desk 3).

---

## 5. Every event and its link

Each event's link opens that event's window after signing in. Coordinators see only their own
events; the department admin and the web assist team can open any event of the department.

#### CSE · Computer Science and Engineering (6 events)

Department page: https://pragya2k26.online/landing/cse/admin/

| # | Event | Event ID | Event link | Coordinator username |
| --- | --- | --- | --- | --- |
| 1 | Future Minds (Ideathon) | `cse-future-minds` | https://pragya2k26.online/landing/cse/admin/?event=cse-future-minds | `cse-future-minds` |
| 2 | Hackathon | `cse-hackathon` | https://pragya2k26.online/landing/cse/admin/?event=cse-hackathon | `cse-hackathon` |
| 3 | Project Expo (Mobile Application Development) | `cse-project-expo` | https://pragya2k26.online/landing/cse/admin/?event=cse-project-expo | `cse-project-expo` |
| 4 | Snap with AI (Poster Making) | `cse-snap-with-ai` | https://pragya2k26.online/landing/cse/admin/?event=cse-snap-with-ai | `cse-snap-with-ai` |
| 5 | Cyber Hunt (Technical Quiz) | `cse-cyber-hunt` | https://pragya2k26.online/landing/cse/admin/?event=cse-cyber-hunt | `cse-cyber-hunt` |
| 6 | AI Prompt Battle (Using Claude AI) | `cse-ai-prompt-battle` | https://pragya2k26.online/landing/cse/admin/?event=cse-ai-prompt-battle | `cse-ai-prompt-battle` |

#### AI&DS · Artificial Intelligence and Data Science (5 events)

(AI&DS's addresses, usernames and event IDs use `aids`, as `&` cannot go in them.)

Department page: https://pragya2k26.online/landing/aids/admin/

| # | Event | Event ID | Event link | Coordinator username |
| --- | --- | --- | --- | --- |
| 1 | Paper Presentation | `aids-paper-presentation` | https://pragya2k26.online/landing/aids/admin/?event=aids-paper-presentation | `aids-paper-presentation` |
| 2 | Pro-pitch (Prompt to app) | `aids-pro-pitch` | https://pragya2k26.online/landing/aids/admin/?event=aids-pro-pitch | `aids-pro-pitch` |
| 3 | Viz Craft (Data visualization) | `aids-viz-craft` | https://pragya2k26.online/landing/aids/admin/?event=aids-viz-craft | `aids-viz-craft` |
| 4 | Code Flex (Multi-language coding challenge) | `aids-code-flex` | https://pragya2k26.online/landing/aids/admin/?event=aids-code-flex | `aids-code-flex` |
| 5 | Cognix (Quiz) | `aids-cognix` | https://pragya2k26.online/landing/aids/admin/?event=aids-cognix | `aids-cognix` |

#### IT · Information Technology (6 events)

Department page: https://pragya2k26.online/landing/it/admin/

| # | Event | Event ID | Event link | Coordinator username |
| --- | --- | --- | --- | --- |
| 1 | Paper Presentation (Inno Papers – The Spectrum of Innovation) | `it-inno-papers` | https://pragya2k26.online/landing/it/admin/?event=it-inno-papers | `it-inno-papers` |
| 2 | Claude Prompt Battle | `it-claude-prompt-battle` | https://pragya2k26.online/landing/it/admin/?event=it-claude-prompt-battle | `it-claude-prompt-battle` |
| 3 | Web Architects | `it-web-architects` | https://pragya2k26.online/landing/it/admin/?event=it-web-architects | `it-web-architects` |
| 4 | Code Debugging | `it-code-debugging` | https://pragya2k26.online/landing/it/admin/?event=it-code-debugging | `it-code-debugging` |
| 5 | Poster Pitch | `it-poster-pitch` | https://pragya2k26.online/landing/it/admin/?event=it-poster-pitch | `it-poster-pitch` |
| 6 | Project Presentation | `it-project-presentation` | https://pragya2k26.online/landing/it/admin/?event=it-project-presentation | `it-project-presentation` |

#### ECE · Electronics and Communication Engineering (6 events)

Department page: https://pragya2k26.online/landing/ece/admin/

| # | Event | Event ID | Event link | Coordinator username |
| --- | --- | --- | --- | --- |
| 1 | Paper Presentation | `ece-paper-presentation` | https://pragya2k26.online/landing/ece/admin/?event=ece-paper-presentation | `ece-paper-presentation` |
| 2 | Project Expo | `ece-project-expo` | https://pragya2k26.online/landing/ece/admin/?event=ece-project-expo | `ece-project-expo` |
| 3 | Circuit Debugging | `ece-circuit-debugging` | https://pragya2k26.online/landing/ece/admin/?event=ece-circuit-debugging | `ece-circuit-debugging` |
| 4 | Dronova | `ece-dronova` | https://pragya2k26.online/landing/ece/admin/?event=ece-dronova | `ece-dronova` |
| 5 | Tech Escape Room | `ece-tech-escape-room` | https://pragya2k26.online/landing/ece/admin/?event=ece-tech-escape-room | `ece-tech-escape-room` |
| 6 | ECE Hackathon | `ece-ece-hackathon` | https://pragya2k26.online/landing/ece/admin/?event=ece-ece-hackathon | `ece-ece-hackathon` |

#### CYBER · Computer Science and Engineering (Cyber Security) (6 events)

(CYBER's addresses, usernames and event IDs use `cys`.)

Department page: https://pragya2k26.online/landing/cys/admin/

| # | Event | Event ID | Event link | Coordinator username |
| --- | --- | --- | --- | --- |
| 1 | Cyber Paper Presentation | `cys-cyber-paper-presentation` | https://pragya2k26.online/landing/cys/admin/?event=cys-cyber-paper-presentation | `cys-cyber-paper-presentation` |
| 2 | Cyber Hunt (Technical Quiz) | `cys-cyber-hunt` | https://pragya2k26.online/landing/cys/admin/?event=cys-cyber-hunt | `cys-cyber-hunt` |
| 3 | PhishGuard (Phishing Website Detection) | `cys-phishguard` | https://pragya2k26.online/landing/cys/admin/?event=cys-phishguard | `cys-phishguard` |
| 4 | Cyber Escape Room | `cys-cyber-escape-room` | https://pragya2k26.online/landing/cys/admin/?event=cys-cyber-escape-room | `cys-cyber-escape-room` |
| 5 | Cybersecurity Spotlight (Tech Talks) | `cys-cybersecurity-spotlight` | https://pragya2k26.online/landing/cys/admin/?event=cys-cybersecurity-spotlight | `cys-cybersecurity-spotlight` |
| 6 | CyberSecure Hackathon | `cys-cybersecure-hackathon` | https://pragya2k26.online/landing/cys/admin/?event=cys-cybersecure-hackathon | `cys-cybersecure-hackathon` |

(Two CYS usernames are cut short on purpose: usernames stop at 22 characters of the event's name.)

#### EEE · Electrical and Electronics Engineering (5 events)

Department page: https://pragya2k26.online/landing/eee/admin/

| # | Event | Event ID | Event link | Coordinator username |
| --- | --- | --- | --- | --- |
| 1 | Paper Presentation | `eee-paper-presentation` | https://pragya2k26.online/landing/eee/admin/?event=eee-paper-presentation | `eee-paper-presentation` |
| 2 | Project Expo | `eee-project-expo` | https://pragya2k26.online/landing/eee/admin/?event=eee-project-expo | `eee-project-expo` |
| 3 | Technical Quiz | `eee-technical-quiz` | https://pragya2k26.online/landing/eee/admin/?event=eee-technical-quiz | `eee-technical-quiz` |
| 4 | Circuit Warriors | `eee-circuit-warriors` | https://pragya2k26.online/landing/eee/admin/?event=eee-circuit-warriors | `eee-circuit-warriors` |
| 5 | Machine Master | `eee-machine-master` | https://pragya2k26.online/landing/eee/admin/?event=eee-machine-master | `eee-machine-master` |

#### MECH · Mechanical Engineering (6 events)

Department page: https://pragya2k26.online/landing/mech/admin/

| # | Event | Event ID | Event link | Coordinator username |
| --- | --- | --- | --- | --- |
| 1 | Paper Presentation | `mech-paper-presentation` | https://pragya2k26.online/landing/mech/admin/?event=mech-paper-presentation | `mech-paper-presentation` |
| 2 | Mech Hack X | `mech-mech-hack-x` | https://pragya2k26.online/landing/mech/admin/?event=mech-mech-hack-x | `mech-mech-hack-x` |
| 3 | Project Xplore | `mech-project-xplore` | https://pragya2k26.online/landing/mech/admin/?event=mech-project-xplore | `mech-project-xplore` |
| 4 | Poster Pro | `mech-poster-pro` | https://pragya2k26.online/landing/mech/admin/?event=mech-poster-pro | `mech-poster-pro` |
| 5 | Quiz – Brain Bolt | `mech-brain-bolt` | https://pragya2k26.online/landing/mech/admin/?event=mech-brain-bolt | `mech-brain-bolt` |
| 6 | Aqua Rocket | `mech-aqua-rocket` | https://pragya2k26.online/landing/mech/admin/?event=mech-aqua-rocket | `mech-aqua-rocket` |

#### S&H · Science and Humanities (4 events)

(S&H's addresses, usernames and event IDs use `sh`.)

Department page: https://pragya2k26.online/landing/sh/admin/

| # | Event | Event ID | Event link | Coordinator username |
| --- | --- | --- | --- | --- |
| 1 | Paper Presentation (Physics) | `sh-paper-presentation-physics` | https://pragya2k26.online/landing/sh/admin/?event=sh-paper-presentation-physics | `sh-paper-presentation-physi` |
| 2 | Poster Presentation (Chemistry) | `sh-poster-presentation-chemistry` | https://pragya2k26.online/landing/sh/admin/?event=sh-poster-presentation-chemistry | `sh-poster-presentation-chem` |
| 3 | Extempore Speech (English) | `sh-extempore-speech` | https://pragya2k26.online/landing/sh/admin/?event=sh-extempore-speech | `sh-extempore-speech` |
| 4 | Math Puzzles & Logic Quiz (Maths) | `sh-math-puzzles` | https://pragya2k26.online/landing/sh/admin/?event=sh-math-puzzles | `sh-math-puzzles` |

**An event added later** in **Departments & events** gets its link the same way:
`https://pragya2k26.online/landing/<dept>/admin/?event=<event ID>`. Its coordinators are made by
running **Create a department's accounts** again (only the missing accounts are made), or by hand in
**Accounts → New account** (role *Event coordinator*, the department, tick the event).

---

## 6. Registration IDs, and what happens when a desk runs out

Every student gets one ID in the department they register with. The ID tells you where it came from:

| ID | Where it came from |
| --- | --- |
| `CSE-0001` … `CSE-1999` | Registered at a desk |
| `CSE-2001` … `CSE-4999` | Registered on their own phone (chose the department in the pop-up) |
| `CSE-5001` … `CSE-8999` | Online (Netlify form), uploaded by the department admin |
| `CSE-9001` … `CSE-9999` | Paper slip (when the phones could not be used) |

- **One mobile number is registered once per department.** Registering it again shows the existing
  ID instead.
- A student registers in one department and takes part in that department's events (no cross-
  department entries).
- IDs can be typed loosely anywhere: `cse 12`, `cse12` and `CSE-0012` are the same.

### Will a desk run out of IDs?

**No: a desk is never stuck.** Each desk phone holds its own small block of IDs so it can register
with no signal:

1. When a desk phone signs in it takes a block of **50 IDs** (for example `CSE-0051` to `CSE-0100`).
2. When **15** are left, it takes the next 50 by itself the next time it has signal. You don't do
   anything, and nobody else gets the same numbers.
3. A department has **1,999 desk IDs** in total, far more than needed.

So the gaps you may see (desk 1 used 0001–0037, desk 2 started at 0051) are normal: IDs are unique,
not consecutive.

The only time a desk could run out: a phone with **no signal at all** registers 50 students in a row
(it cannot take a new block without signal). Then:

- move to the second phone (other carrier) at the desk; it has its own block; or
- use **paper slips** (`CSE-9001…`, printed beforehand) and the department admin types them in later.

If the same ID is somehow used twice, the second one is moved to the next free ID automatically and
the desk sees the new ID.

---

## 7. How to: registration desk

Sign in on the department page with the desk's account (e.g. `cse-desk2`). The desk number is fixed
to the account. Keep the page open all day; no need to refresh.

### Register a student (on-site)

1. **Registration desk → Register**.
2. Fill in: name with initial, mobile number, college (branch, year, email and team name if known),
   tick the events.
3. Take the **entry fee (₹100)**: **Cash** (tick "I have received ₹100 in cash") or **UPI** (type the
   UPI transaction ID from the student's payment screen and tick that you have seen it).
4. **Register**. Tell the student their ID (e.g. `CSE-0057`); they give it at every event.

The event fees (₹50 each) are taken by the event coordinators at the venue, not at the desk.

### With no signal

Keep registering. The bar at the top shows **offline** and how many registrations are waiting. They
are sent in order as soon as the signal is back, and a retry never registers anyone twice.

**If the phone or laptop switches off** (battery, crash, restart), nothing is lost: each registration
is saved on the device the moment you tap Register. Switch it on, open the same page in the same
browser and sign in with the same account (signing in needs signal): the waiting ones are sent by
themselves. Signing out or closing the tab with registrations waiting asks first; they stay saved
either way. They are lost only if the device itself is lost or broken, the browser's data is
cleared, or a private/incognito window was used, so never use one at a desk.

### An online registrant arrives

**Find & check in** → search by ID, name or mobile number → **Check in (paid online)**. Online
registrants have already paid the entry fee. If one shows the entry fee as due, take it and check
them in in the same step.

### Add an event, or correct a mistake

**Find & check in** → find the student → add the event. A wrong name or mobile number, removing an
event or cancelling a registration: call the department admin (they do it in **Registrations**).

### Cash handover

**Desk N totals** shows how many registered at this desk and the cash and UPI totals. Hand over the
cash with this screen.

---

## 8. How to: event coordinator

Sign in on the department page (or the event's link) with your coordinator account. **My events**
opens on your event.

1. The event's students are listed, with **Find a student** to search by ID, name or phone.
2. **Take ₹50**: choose Cash or UPI, confirm, **Save the fee**.
3. **Mark present** when the student is at the venue. Attendance needs the registration paid and the
   event fee taken.
4. **A student who came straight to the venue** but is registered in the department: search them
   (under "In the department but not in this event") and **Add** them to the event, then take the fee.
   Someone not registered at all is sent to the desk first.
5. **Winners**: type the IDs for 1st, 2nd and 3rd place (a team: several IDs separated by commas;
   `cse 12` is fine). Winners must be marked present. **Save winners** keeps a draft; **Submit results**
   when final. Submitted results go to the overall coordinator and are locked. To change them, ask
   the overall coordinator or the web assist team to **Reopen**.

Mistake with a fee? Only the overall coordinator or the web assist team can cancel a fee recorded by
mistake.

---

## 9. How to: department admin

Sign in on the department page with `<dept>-admin`.

### Upload the online registrations (before the day)

1. Download the department's registrations from the Netlify form as **CSV**.
2. **Online & paper → Online registrations** → choose the file.
3. Check the **column matching**: Name, Phone, College and Events are needed; Email, Branch, Year,
   Team name and Reference are optional. Change a column if it guessed wrong.
4. **Check the file**: it lists unknown event names and duplicates (same phone already registered)
   before anything is saved. Fix the event names in the CSV if needed.
5. Tick **event fees were paid online too** if the online form collected them.
6. **Import**. Students get IDs from `<DEPT>-5001`. Download the list to share. Uploading a newer CSV
   later adds only the new students.

Every imported student counts as having paid the entry fee.

### Paper slips (backup)

**Online & paper → Paper slips** → **Get slip numbers** → **Download the slips to print (CSV)**.
Print them before the day. When a desk used slips, type each one in here after the rush (the slip's
ID, the details, events and payment), or upload them as CSV.

### Corrections

**Registrations** → open a student → correct details, change events, cancel (with a reason) or undo
a cancellation. Deleting a registration is for the web assist team.

You can also register students yourself (**Register**) and run any event of the department
(**Event windows**).

---

## 10. How to: the overall coordinator (HOD)

The HOD is the overall coordinator: one account that sees every department and every event (there
is no HOD account per department).

### Overall coordinator

Sign in at https://pragya2k26.online/landing/admin/. Read only, updated every 15 seconds, for
**all 8 departments**, with filters on every category at the top of each screen:

| Filter | Choices |
| --- | --- |
| Department | All, or one of the 8 |
| Event | The department's events |
| Venue | From the event venues |
| Registered | At a desk, On their own phone, Online, Paper slip |
| Desk | Desk 1, Desk 2 |
| Entry fee | Paid, Waiting for a desk to check, Due |
| College | Every college, with its number of students |
| Status | Active, Cancelled, Deleted, Everything |
| Search | ID, name, mobile number, college |

- **Overview**: totals and money for the filter, by department, by event and venue, by desk.
- **Registrations**: the filtered list; **Download these (Excel)** downloads exactly what the filters
  show, as an .xlsx file (title, the filters and who downloaded it, bold header, Excel filters on
  every column), including how each fee was paid, the UTR accepted, the UTR the student sent and who
  verified it.
- **Colleges**: students and 1st/2nd/3rd places per college; **Download (Excel)**.
- **Results**: every event's winners with their details; **Download winners (Excel)**;
  **Reopen** a submitted event (with a reason) so its coordinator can correct it.
- **Cancel this fee** (with a reason) for an event fee recorded by mistake: **Registrations** → the
  student → their events.

---

## 11. How to: web assist team (on-the-spot changes)

### Website controls (switch any part on or off)

Main dashboard → **Website controls**. Each change applies at once: the students' page and every
dashboard follow within seconds, and the server refuses what is off (the web assist team can still
fix things).

| Switch | On | Off |
| --- | --- | --- |
| Student registration on phones | Students register on the website | The page says it is paused: register at a desk |
| Students find their registration | My registration ID finds it by mobile number and email | Only the phone that registered shows the ID |
| Online payment (UPI QR code) | After registering: pay by UPI here (and send the UTR) or at the desk | Pay at the desk only |
| Desk registration of walk-ins | Desks register walk-ins | Desks only verify payments and check students in |
| Event entry at the venues | Coordinators enter students, take fees, mark attendance | Event windows are read-only |
| Students join only their own department's events (on by default) | An AI&DS student takes part in AI&DS events only; each coordinator sees only their department's students | Any student can join any department's event; coordinators find students of every department |
| Results entry | Coordinators enter and submit winners | Winners cannot be entered |
| Excel downloads | The overall coordinator and department admins download | Download buttons hidden |
| Sign-in by role: overall coordinator, department admins, desks, coordinators | Can sign in (with how many are signed in now) | Everyone of that role is signed out at once and cannot sign in |

**The QR code:** **Upload the QR code** (the GPay / UPI QR of the account receiving the entry fees;
a PNG or JPEG, made smaller in the browser before it is sent), **Replace** or **Remove** it any time.
The UPI ID and account holder's name shown under it are set there too.

**Backups card:** when the last backup ran, and whether the private copy and the Google Sheet copy
worked (with the last good copy's time and the reason when the Sheet failed).

One account at a time (sign out, deactivate, delete, new password) and who is signed in: **Accounts**.

Sign in at https://pragya2k26.online/landing/admin/ with an Admin account (or the owner). You can
also open any department page and act as that department's admin, desk or coordinator.

| On the day you need to… | Go to |
| --- | --- |
| Keep the desks open longer | **Event-day controls → Registration times → Reopen or extend on-site registration**: +30 min, +1 h, +2 h, or "open until" a time |
| Stop all registration now | **Event-day controls → Close registration now** |
| Undo every time change | **Event-day controls → Back to the planned times** |
| Show a line on the website (venue or time change) | **Event-day controls → Notice on the website** (up to 300 characters; every open page shows it within two minutes; take it down afterwards) |
| Change a venue, time, fee or team size; close an event; add an event or a desk | **Departments & events** → change → **Save** (every phone within 15 s) |
| A new person at a desk or event | **Accounts → New account** (role, department, desk number or events) |
| A forgotten password | **Accounts** → the account → **New password** → save; tell them privately |
| A lost or stolen phone | **Accounts → Signed in now → Sign out** (every device), then a new password |
| Someone should stop entirely | **Accounts** → the account → untick **Active**, or **Delete** |
| Move a coordinator to another event | **Accounts** → the account → tick the events |
| Fix any registration | **Registrations** → the student → edit, change events, cancel, delete or restore |
| Wrong fee recorded | **Registrations** → the student → **Cancel this fee** (with a reason) |
| Results submitted wrongly | **Results → Reopen** |
| Help requests from staff ("Contact admin" button) | **Help requests** → reply |
| Is everything working? | **System status**, and the API health check link |

Changing a password, deactivating or deleting an account signs that person out at once.

---

## 12. Event-day run sheet

| When | Who | What |
| --- | --- | --- |
| Day before | Web assist | Section 2 done: accounts handed out, online CSVs uploaded, venues and times filled in, test data deleted, registration times set, paper slips printed |
| Day before | Everyone | Sign in once on the phone they will use; open their link; check it shows their department |
| Morning, before opening | Web assist | **System status** green; health check `ready`; the registration times right in **Event-day controls** |
| Morning | Desks | Sign in, open **Registration desk**; check the bar says connected; second phone signed in too |
| Morning | Whoever holds the receiving UPI account | At the verification point, the account's payments open, to check transaction IDs |
| Opening | Desks | **Verify payments** of students who registered on their phones; register walk-ins; check in online registrants |
| During | Coordinators | Fees, attendance at the venue |
| During | Overall coordinator (HOD) | Watch Overview; call the web assist team for anything odd |
| Before the planned closing time | Web assist | Extend if the desks still have queues (one tap) |
| Closing time | Desks | **Desk N totals** → hand over cash; make sure nothing is "waiting to send" |
| After the closing time | Department admins | Type in any paper slips |
| After each event | Coordinators | Enter and **Submit results** |
| End of day | Overall coordinator | **Results → Download winners**; **Registrations → Download** (all departments) |

---

## 13. When something goes wrong

| Problem (students who register themselves) | What to do |
| --- | --- |
| **A student lost their ID** | Any desk: **Find & check in** by mobile number or name, or the student opens **Already registered?** on the students' page with their mobile number and ID. |
| **"This mobile number is already registered"** | They registered before (on their phone, online or at a desk): find them at a desk by mobile number. |
| **The payment is not in the account** | **Not found…** with a reason ("not received", "wrong amount"): the student sees it and can send the right transaction ID, or pays at the desk (the desk takes cash and checks them in). |
| **"This transaction ID was already accepted for CSE-20xx"** | Two students typed the same payment. Ask for the student's own payment screen; correct the transaction ID in the box and verify. |
| **"The entry fee is not verified yet" at a venue** | Send the student to a desk to verify their payment first. |
| **Students' page says the server is busy** | Many students at once: try again in a moment. Check the Lambda limit (2.3). |

| Problem | What to do |
| --- | --- |
| **No signal at a desk** | Keep registering: it is saved on the phone and sent later. Switch to the second phone (other carrier) if you need to look anything up. |
| **"Waiting to send" does not go down** | Move to better signal. If it says a registration failed, open it: it says why (e.g. the mobile number is already registered, with that ID). Fix it or dismiss it. |
| **Mobile number already registered** | The desk shows the existing ID. Use that ID; do not register again. |
| **Phone or laptop switched off with registrations waiting** | Nothing is lost: each registration is saved on the device the moment it is made. Switch it on, open the same page **in the same browser**, sign in with the **same account**: they are sent by themselves. Never use a private/incognito window at a desk (its data is wiped when it closes), and never clear the browser's data. |
| **Phone lost** | Web assist: **Accounts → Signed in now → Sign out** for that account, set a new password, sign in on another phone. Anything that was waiting on the lost phone is lost: re-register those students (their mobile number tells you if they are already in). |
| **Every phone at a desk fails** | Paper slips (`<DEPT>-9001…`); the department admin types them in later. |
| **"Registration is closed"** at a desk | The on-site closing time has passed. Web assist: **Event-day controls → Reopen or extend**. |
| **Signed in on the wrong department's page** | The page says which is theirs; open that link. |
| **Coordinator sees no event** | Web assist: **Accounts** → tick the event on their account. |
| **Forgot password** | Web assist sets a new one (section 11). |
| **Signed out after many hours** | Sessions last 16 hours. Sign in again. |
| **Wrong fee recorded** | Overall coordinator / web assist cancels it with a reason. |
| **Results need a change after submitting** | Overall coordinator / web assist: **Results → Reopen**; the coordinator submits again. |
| **The site is slow or errors for everyone** | Check the health link. If the Lambda limit was not raised (2.3), at most 10 requests run at once: raise it. Desks keep working offline meanwhile. |
| **The dashboard page shows the public site** | The slash at the end is missing: use `…/admin/`. |
| **"Couldn't reach the server" when signing in, with signal** | You are probably on `www.pragya2k26.online`. Use `https://pragya2k26.online/…` (no www), or add the www address to `ALLOWED_ORIGINS` in Amplify and redeploy. |
| **Anything else** | The **Contact admin** button on every screen sends the web assist team the screen and the error. |

---

## 14. Data safety and backups

- **Every registration is in DynamoDB** (the `FestRecords` table): point-in-time recovery (any second
  in the last 35 days), deletion protection, and kept even if the app is deleted.
- **Every 10 minutes** a full copy of every department's data is written to the private files bucket
  (`backups/fest/all.json`); every earlier version is kept.
- **Every 10 minutes, the Google Sheet** (the one in `GOOGLE_SHEET_ID`) gets the same data in two tabs,
  **Fest registrations** (one row per student: details, entry fee and how it was paid, events, fees,
  attendance, status) and **Fest results** (one row per place). It is written only when something
  changed, in one request (no request at all otherwise), so it stays far inside Google's limits. The
  tabs are made the first time and rewritten whole each time: read and download them, do not edit
  them (`server/festSheet.ts`).
- **Test data** is saved to `backups/fest-test-data-*.json` before it is deleted.
- **If the Google Sheet copy fails** (Google not answering, the sheet's sharing changed, a quota):
  nothing is lost. The live data stays in DynamoDB, the private copy is still written, and the next
  run (10 minutes later) writes the whole Sheet copy again. **Website controls → Backups** shows the
  failure, the reason and the last good copy's time, so the team sees it without opening AWS logs.
- **Each phone** keeps a copy of its department and everything not yet sent (see section 7, *With no
  signal*).
- **Your own copy**: download **Registrations** (all departments) and **Results** as Excel at the end
  of the day and keep them.
- Cancelled and deleted registrations keep their whole record with who did it, when and why; deleted
  ones can be restored.

---

## 15. After the event

1. Overall coordinator: download **Results → winners** and **Registrations** (all departments).
2. Departments: reconcile cash with **Desk N totals** and the Overview's money.
3. Web assist: in **Accounts**, deactivate or delete the department accounts once the results are
   final (or set **Close registration now** so nothing new can be registered).
4. There is no need to lower the Lambda limit afterwards: it costs nothing when idle.

---

## 16. Numbers, limits and settings

| Item | Value |
| --- | --- |
| Departments / events | 8 / 44 |
| Desks per department | 2 (a 3rd can be made by hand) |
| Coordinators per event | 1 (more can be added by hand) |
| UTR | 12 digits, compulsory when paying by UPI on the website; accepted once across the fest |
| Entry fee / event fee | ₹100 / ₹50 (changeable in **Departments & events**) |
| Phones at once | built for ~300, on mobile data |
| Registrations | 1,000+ (each department up to 1,999 desk, 2,999 phone, 3,999 online and 999 paper IDs) |
| Live updates | every 15 seconds, only what changed |
| Session length | 16 hours |
| IDs per desk phone block | 50, topped up at 15 left |
| Import | up to 200 rows per upload step (the page splits bigger files) |
| Backups | every 10 minutes: the private bucket (every version kept) and the Google Sheet's fest tabs (when anything changed) |
| AWS cost when idle | nothing for Lambda and API Gateway; DynamoDB on-demand and S3 cost cents for this size |

### Settings (names only)

Secrets (Amplify → Hosting → Secrets): `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`,
`ADMIN_PASSWORD_HASH`.

Environment variables (Amplify → Hosting → Environment variables): `GOOGLE_CLIENT_ID`,
`GOOGLE_SHEET_ID`, `GOOGLE_DRIVE_PAYMENT_FOLDER_ID`, `ADMIN_USERNAME` (until they are set here, the
secrets of the same name are used), and the optional ones in [README.md](README.md) section 3.

Set by the app itself: `FEST_TABLE`, `REGISTRATIONS_TABLE`, `CONTROL_TABLE`, the files bucket.

---

## 17. For developers

- Code: `src/lib/fest.ts` (catalog, IDs, rules), `server/fest.ts` (the API's fest rules),
  `src/admin/fest/` (the screens), `amplify/backend.ts` (AWS resources).
- Checks before any push: `npm run check` (lint, all tests, build, secret check). Never run
  `npm run google:check` casually: it touches the real Drive, Gmail and Sheet.
- **Deploying = pushing `main`.** Amplify builds and deploys it (about 10 minutes). Work on a feature
  branch; merge into `main` only when ready.
- Check a deploy from outside with the live schedule link (section 1).
- Local run: `npm run dev` with `DEV_API_PROXY` pointing to a local API (see
  [README.md](README.md), *Local development*).
