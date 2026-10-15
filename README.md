# Cadence - BD Team Reporting & Performance Analytics

The cloud version is live at **https://cadence-53781.web.app**, using **Firebase Hosting + Firebase Authentication + Firestore on the free Spark plan**. It runs independently of this computer. See [DEPLOYMENT.md](DEPLOYMENT.md) for the Firebase build, migration, permissions, and free-plan limits. Use `npm run build:firebase` for Hosting; `npm run build` retains the original local/server version described below.

The Firebase version preserves daily reports, reviews, versioned targets and scoring, private attachments, parsed spreadsheet insights, reflections, and CSV/XLSX/PDF downloads. Reminders are refreshed when the workspace is opened; unattended scheduling and SMTP reminders are unavailable. Firebase Authentication manages browser sign-in persistence and passwords.

A working internal reporting application for a 6-15 person business development team. It starts with an empty company database, default job roles, eight reporting categories, and a configurable metric library. There are **no default credentials or seeded company performance records**. All fixture accounts and results live in isolated automated tests.

## Architecture and technology choices

This section describes the original local/server implementation. The current cloud architecture is documented in [DEPLOYMENT.md](DEPLOYMENT.md).

- **React 18 + TypeScript + Vite** provide a responsive employee portal and administrator workspace. Recharts renders charts from authenticated API responses. Lucide supplies icons. System fonts avoid external font requests.
- **Express 5 + TypeScript on Node 24 LTS** implements the API, validation, authorization, exports, and background reminders. The production build compiles the backend to JavaScript; no development compiler is needed by the running server.
- **SQLite through Node's built-in SQLite API** supplies a normalized relational database, WAL mode, foreign keys, indexes, checks, uniqueness constraints, and transactional migrations. This is appropriate for a small team on one application server with persistent local storage. A multi-instance or serverless installation should move the repository layer to PostgreSQL and use a shared job/limiter service.
- **Opaque server-side sessions + scrypt**: passwords use random salts and a memory-hard KDF. A random 256-bit cookie token is stored only as a SHA-256 hash in the database. Sessions expire after 12 hours. Cookies are HttpOnly/SameSite=Strict and Secure in production. CSRF tokens and an explicit origin allowlist protect mutations. Database-backed login failure limits supplement the IP limiter. No browser storage holds passwords, tokens, or report drafts.
- **Zod v4 API** (via the maintained compatibility entry point of the pinned Zod package) validates server input; native form validation provides immediate client feedback. Prepared statements prevent SQL injection. Error responses omit stack traces and secrets.
- **PDFKit** creates PDFs. A small write-only Open XML/ZIP writer creates XLSX without a runtime spreadsheet parser. CSV escapes text that could become spreadsheet formulas. A development-only reader independently validates workbook output in tests.
- **Node's test runner, HTTP integration tests, and Playwright** test real operations instead of a decorative dashboard.

The authorization boundary is the server. Every protected request requires an active user and valid session; every employee-scoped operation checks ownership. SQLite has no row-level security, so access is enforced in the API/repository boundary and explicitly tested with direct requests. The database file must never be exposed by the web server.

Official references: [Node SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html), [Express production security](https://expressjs.com/en/advanced/best-practice-security/).

## Local setup

Requirements: Node **24 LTS**, npm, and a terminal. Windows, macOS, and Linux are supported; this workspace was exercised on Windows with Node 24.18.

~~~sh
npm ci
# Copy .env.example to .env using your shell or editor.
npm run db:migrate
npm run build
npm run admin:create
npm start
~~~

Open **http://localhost:3000** and leave the terminal running while you use the app. If the terminal or server stops, the already-open page cannot reach its API; restart with `npm start` and refresh the page. The admin command asks for an email, name, and a hidden password of at least 12 characters. It refuses to bootstrap a second administrator. Create additional administrators through Team members after signing in. Passwords are never command-line arguments or logged by the application.

For automation, pipe one JSON object containing email, name, and password from your secret manager into **npm run admin:create:stdin**. Do not type a real password into shell history or commit a bootstrap input file. For a production-only installation without dev dependencies, the equivalent command is **node build/server/create-admin.js**.

Development:

~~~sh
npm run dev
~~~

This builds the client and watches server changes, using the same static client path as production. Rebuild/restart after frontend edits. **npm run dev:live** enables Vite middleware/HMR on hosts where native dependency prebundling is available. The static development path also works in this environment's restricted native-tool sandbox.

Environment variables are documented in **.env.example**. The default database is **data/reporting.sqlite**. Migrations run at server startup as well as through **npm run db:migrate**. Keep **.env**, **data/**, backups, and runtime logs out of source control. Port 3000 binds to loopback by design; a reverse proxy publishes it in production.

## First-use workflow

1. Sign in with the administrator you created. In **Team members**, create each employee, assign a job role, relevant categories, schedule, timezone, daily deadline, and notification preferences. Share initial credentials through your organization's secure channel. Employees can change their passwords in Settings.
2. In **Targets & KPIs**, use the metric library or create custom definitions with a category, unit, and scoring component. Assign individual daily, weekly, or monthly targets, effective dates, weights, and optional minimum quality thresholds. Two employees in the same role may have different assignments. Archiving a definition prevents new assignments; ending a target changes its effective interval while retaining history.
3. Employees create a daily report on a scheduled working date, add assigned KPI entries or custom activities, enter explicit quantities, outcomes, descriptions, time, evidence links, and reflections. Each KPI is entered once per report. Custom activities do not silently become scored KPIs.
4. **Save draft** retains a report on the server. **Submit report** validates required achievements, at least one activity, and a next-day plan, then locks the report. The UI warns before leaving unsaved edits. Drafts and corrections use optimistic version checks to prevent another tab from overwriting changes.
5. Administrators open reports to comment, record quality/learning evidence, request corrections, or approve. Only a correction-requested report can be edited after submission. Every revision and transition is retained. The first submission timestamp remains the compliance reference after a correction.
6. The dashboard and **Weekly & monthly** views calculate summaries from submitted records. Choose This week, This month, Previous month, or explicit dates. Open an employee for KPI results, supporting components, daily trends, feedback, blockers, comparisons, and a period reflection. Employees only receive their own data.
7. **Reports & exports** downloads scoped activities, KPI results, or employee summaries as CSV/XLSX, or a detailed daily/weekly/monthly/team PDF using the same selected date/employee/role/category/status filters.

## Evidence links and uploaded file insights

- Each activity in a daily report can have multiple HTTP(S) evidence/task links. Links are saved with the activity and included in the report’s revision history.
- Employees may attach up to 10 files per report, at 5 MB each. CSV and XLSX files are parsed into structured rows; XLSX imports the first worksheet and reads stored cell values without evaluating formulas. Imports are limited to 10,000 rows and 50 columns per file. DOC/DOCX, PDF, TXT, PPT/PPTX, legacy XLS, and ODS can be kept as downloadable attachments; those formats are not parsed into chart data.
- Selecting a file saves the report as a draft and uploads it immediately; saving or submitting also uploads any staged files. Spreadsheet rows become visible in team analytics after the report is submitted. Employees can access upload data only for their own reports.
- Admins can open **Uploaded files** for a cross-team file inventory and spreadsheet dashboard. Filter by date, employee/uploader, role, category, one or more uploaded files, and detected column values. The inventory includes documents as downloadable attachments; CSV/XLSX rows can be charted, filtered, and reviewed without opening the original spreadsheet. Up to 10,000 imported rows are returned per filter selection; tables show up to 250 rows at a time. The bar chart averages one selected numeric column per employee; the radar chart scales metrics relative to the filtered column maximum (0–100), as a comparison aid rather than a performance score.
- Each individual employee performance view includes their uploaded-data dashboard. Opening a daily report also shows the parsed rows, filters, charts, radar profile, and attachment downloads for that report. These report-level routes enforce the same employee ownership checks as report details.
- Upload files are stored outside the web root under data/uploads. The backup command includes both the database snapshot and its referenced attachments.
## Calendar and target rules

- Reporting dates are local YYYY-MM-DD calendar values; timestamps are UTC ISO instants. The company timezone defaults to **Asia/Karachi**. Profiles may have individual IANA timezones. Date filters use explicit calendar boundaries, never UTC truncation of a local day.
- Weeks run Monday-Sunday; months use calendar month boundaries. Date ranges are limited to 367 days. Future dates never become overdue; future reports cannot be submitted.
- Scheduled weekdays, joining date, company holidays, and approved leave determine required reporting days. Administrators approve leave and add holidays in Settings.
- A **daily target** is multiplied only by applicable scheduled working days.
- A **weekly/monthly quota** is allocated once across its canonical week/month. The selected effective working days form the numerator; normal scheduled weekdays in the whole canonical period form the denominator. Holidays, leave, mid-period joining, and partial effective periods therefore reduce the quota proportionally. Weekly/monthly targets are never multiplied by the number of reports.
- Profile schedule, timezone, deadline, and role changes take effect on their local company date and retain previous profile versions. Historical working-day and role-model calculations consult those versions. Retroactively approving leave or adding a holiday intentionally recalculates affected expectations.
- IANA timezone offsets come from Intl; calendar arithmetic uses UTC calendar components. Tests cover Karachi midnight, leap dates, month/week boundaries, and summer/winter DST offsets. For uncommon deadlines in a DST gap the offset resolver shifts forward; an ambiguous repeated time selects its first occurrence. Prefer a deadline such as 22:00 away from DST transitions.

## Transparent scoring

The company default weights are achievement **40%**, quality **25%**, impact **20%**, consistency **10%**, and learning **5%**. Applicable weights must total 100%. Employee configurations take precedence over role configurations, then company defaults. Models are versioned, take effect on a future date, and the model effective at the selected period's **start** scores that period. Split a period at a model change to examine each model separately.

For each assigned KPI, actual / applicable target * 100 gives achievement, capped at the configured limit (100% by default, configurable to 200%). An explicit measured zero is zero. Missing observations are **pending**, never an invented zero. Each applicable day needs an explicit KPI observation, including a zero when that is the measured result; entries for a weekly/monthly KPI capture that day's incremental result.

Multiple target versions of the same KPI contribute once to a component: version achievement is weighted by its period target, and the KPI's component weight is averaged over its effective scheduled days. This prevents a KPI from acquiring extra influence merely because its target changed. The component then uses a weighted average across distinct KPIs. Unrelated units are never added together. Metric definitions select sum aggregation for counts/revenue or daily-average aggregation for percentages and quality rates. Average metrics retain a constant target threshold and average observed daily values; the UI never presents the sum of daily percentages as a rate. Default quality-rate definitions use average aggregation.

Quality can come from assigned quality KPIs or recorded manager quality reviews. Learning uses manager review evidence. A configured minimum quality gate remains pending until reviewed; a confirmed result below the minimum contributes zero to that KPI. Reporting compliance is the percentage of scheduled days whose **first** submission met that day's historical local deadline, independently of quality. A report under correction is excluded from work-result calculations until resubmitted, while its initial submission still counts toward discipline.

An overall score requires evidence for every component with a nonzero weight. Configure irrelevant components to zero for a role rather than manufacturing evidence. The overall score is capped at 100 and rounded to two decimals. Default bands: Excellent >=90, Good >=75, Needs Improvement >=60, Below Expectations <60. Bands are configurable. Daily charts show daily prorated contributions and leave missing scores as gaps.

Administrator overrides require a recorded reason and exact period, retain the calculated score, and create audit events. Score tables show role context; raw output quantities and fundamentally different role models should not be ranked together. Analytics remain derived from versioned records rather than duplicated monthly totals. Report revisions are intentional immutable snapshots for reproducing corrections; audit events preserve administrative changes.

## Notifications and email

The server runs a scheduler every minute. In-app notifications are durable and unique by recipient, period, and reminder kind. It checks only active, opted-in users and eligible working dates; a 31-day lookback catches missing daily reports after downtime. Default daily deadline: **22:00 Asia/Karachi**, with a configurable pre-deadline reminder and overdue reminder. Weekly/monthly review times are configurable. Monthly reviews concern the preceding month and do not notify employees who had not joined then. Leave and holidays suppress reminders.

For a separate scheduler, run **npm run jobs:run**, or in a production-only installation **node build/server/jobs.js** every minute through cron/Task Scheduler. Keep one long-lived server as the normal scheduler; database uniqueness also protects against a concurrent job invocation. Do not expose job endpoints publicly; the manual run API requires admin authentication and CSRF.

SMTP is optional. Set **SMTP_HOST**, **SMTP_PORT**, **SMTP_FROM**, and, when required, **SMTP_USER/SMTP_PASS** in the deployment environment. Port 465 uses TLS; port 587 uses STARTTLS. Notification records show not-configured, queued, sending, delivered, or failed. Delivery timestamps appear only after successful SMTP acceptance. Failed or interrupted/uncertain sends are not automatically retried, to avoid duplicate email; review provider logs before retrying manually. In-app notifications continue working without SMTP. External delivery was not tested because credentials were not provided.

## Relational model and integrity

SQL migrations are in **server/migrations/** and tracked by schema_migrations. The schema includes users/access roles, job roles, profile versions, user categories, KPI definitions, target assignments, score configurations, reports, activities/KPI observations, feedback/improvement plans, period reflections, score overrides, schedules in versioned profiles, holidays, approved leave, sessions, persistent login attempts, notifications/delivery status, report revisions, and immutable audit events.

Key invariants: one report per employee/date; one observation per assignment/report; foreign keys on all ownership relations; nonnegative activity values; positive targets/weights; valid report states; transactional report/target/review operations; session revocation on deactivation/password reset; no business record deletion endpoints. Reports use a revision counter for concurrent edits. Audit update/delete triggers prevent application-level mutation (a database owner can still replace the file, so infrastructure access and backups matter).

## Exports

Exports reapply server permissions and filters. CSV uses UTF-8 BOM and quotes every cell. Text beginning with formula-like prefixes, including leading whitespace/control characters, is escaped. XLSX stores strings as explicit text cells; it never interprets user text as a formula. Workbooks include export metadata and the requested dataset. PDFs include period/filters/generation time, target results, score model and explanations, daily activity context, reflections, and manager feedback. Default PDF fonts cover Latin-script output; set **PDF_FONT_PATH** and **PDF_BOLD_FONT_PATH** to licensed Unicode fonts for other scripts. RTL shaping is not implemented. Export links are authenticated and generated on demand, with audit events.

## Verification

~~~sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
~~~

Playwright starts an in-memory fixture server inside global setup on port **3110** and closes it in teardown. It never uses the company database. Fixture records are labeled Fixture and use example.test addresses. Tests cover ownership/CSRF, admin lifecycle, multi-entry drafts, submission/correction/approval, duplicates/concurrency, historical target versions, missing/zero data, quality gates, schedules/leave/holidays, period boundaries, reminders/deduplication, immutable audits, overrides, formula protection, workbook parsing, and PDF signatures. Browser tests exercise actual login/report/review/account flows and mobile navigation, overflow, empty/error states. **PLAYWRIGHT_CHROMIUM_EXECUTABLE** can select an existing Chromium binary when browser downloads are unavailable.

This environment blocked registry downloads. Compatible local package copies were used, nested versions reconciled, and npm produced the portable shrinkwrap lock. The project has no dependency on those other projects. A fresh registry installation and a current online vulnerability audit require network access and were not verified here. See **QA_REPORT.md** for the final executed results and remaining verification limits.

## Production deployment

For the no-billing deployment to **Render Free + Firebase Firestore**, see [DEPLOYMENT.md](DEPLOYMENT.md). `npm run start:hosted` uses Firestore for permanent records and private file chunks; the local `npm start` path below continues to use SQLite and disk uploads.

1. On a trusted build host with Node 24 LTS, run **npm ci**, the checks above, and **npm run build**.
2. Ship **build/server/**, **dist/**, **package.json**, **npm-shrinkwrap.json**, **scripts/**, and install production dependencies with **npm ci --omit=dev**. For administrative CLI operations after deployment use the compiled commands above; interactive **npm run admin:create** also works after a build.
3. Configure **NODE_ENV=production**, **APP_ORIGIN=https://reports.your-company.example**, **DATABASE_PATH=/var/lib/cadence/reporting.sqlite**, **PORT=3000**, and optional SMTP/font variables in a protected service environment file. The server refuses production startup without an HTTPS origin. Keep database/backups writable only by the service account. Do not place them under dist.
4. Run **node build/server/migrate.js**, bootstrap your first admin with a hidden prompt/secret-manager stdin, and start **npm start** under systemd, a Windows service wrapper, or your process manager. Keep the process alive for notifications. Use **GET /api/health** for readiness.
5. Terminate HTTPS at Nginx/Caddy/IIS on the same host and proxy to **127.0.0.1:3000**. Preserve Host and set X-Forwarded-For/Proto. Set **TRUST_PROXY=1** only when that hop is controlled; otherwise leave it disabled. Restrict direct origin access. The production response sets CSP, anti-framing, MIME sniffing protection, referrer policy, and HSTS, and Secure cookies require HTTPS.
6. Use one application instance and persistent disk. Do not run SQLite on an ephemeral serverless filesystem or an unsupported shared network filesystem. For horizontal scaling, migrate to PostgreSQL and shared job/rate-limit infrastructure first.
7. Schedule **npm run backup** (or **node scripts/backup.mjs**) and copy backups to restricted off-host storage. It uses SQLite's online backup API, not a raw copy of a live WAL database. Set **BACKUP_DIR** as needed. Test restores: stop the service, retain the existing database/WAL/SHM files in a protected recovery directory, restore a selected backup as DATABASE_PATH, verify permissions, restart, and check health and reports. Never log in with production data during automated fixture tests.
8. Before rolling out broadly, configure real employee schedules and metrics, calibrate role scoring weights, check SMTP delivery with your provider, and run an organization-specific acceptance review. No public deployment, provider delivery, SSO, or MFA is claimed by this repository.

## Project map

- **src/**: application shell, dashboard, reporting editor/history, management, settings/exports/notifications/audit UI.
- **server/app.ts**: protected API and workflow transitions.
- **server/domain.ts**, **calendar.ts**: periods, schedules, quotas, scoring, and summaries.
- **server/db.ts**, **migrations/**: SQL storage, transactions, and migrations.
- **server/auth.ts**, **security.ts**, **validation.ts**: sessions, password KDF, request protections, validation.
- **server/scheduler.ts**, **exports.ts**, **xlsx.ts**: jobs and downloads.
- **tests/**: isolated unit, HTTP integration, and browser tests.
- **IMPLEMENTATION.md**: phased implementation record.
"# Reporting-System" 
