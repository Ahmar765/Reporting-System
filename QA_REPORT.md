# Verification record

Date: 2026-10-15. Environment: Windows, Node 24.18.0, local workspace.

## Executed checks

- Lint: PASS (ESLint).
- Full TypeScript check: PASS.
- Production frontend and compiled backend build: PASS. Largest emitted chunk ~355 KB; no chunk-size warning.
- Unit and HTTP integration tests: 37 PASS, 0 FAIL. Includes database-backed sessions, direct access denial across employees, CSRF/origin checks, account creation/deactivation/session revocation, multi-entry reports, draft submission, duplicate/version conflicts, correction/approval/revisions, KPI/score history, weighted scoring/caps/zero and missing data, rate averaging, fixed quota proration, leave/holidays, timezone boundaries, first-submission compliance, deduplicated reminders, CSV formula protection, uploaded CSV/XLSX parsing and row permissions, file download isolation and immutability, independent XLSX export parsing, PDF signatures, score overrides and immutable audits.
- Browser assertions: all 3 PASS with a clean runner exit. Employee draft/submit with multiple links, CSV insight upload and document attachments; admin approval, parsed-data table, bar and radar charts (with separate shared-string XLSX parser coverage), account creation/deactivation and inactive-employee drilldown; responsive checks at 320, 768, 1024, and 1440px; notifications empty state and injected service errors. PDF download is also exercised.
- Visual QA: desktop dashboard and 320px daily-report screenshots inspected. The exported four-page fixture team PDF was rendered in Chromium's built-in PDF viewer and every page inspected; readable text, no clipping/overlaps, consistent metadata and page footers. Default Latin-script fonts were exercised.
- Compiled application smoke: GET / and GET /api/health both returned 200. Automatic migrations ran on the empty company database.
- Production-mode smoke: health 200, CSP and HSTS present, HTTPS-origin startup configuration exercised.
- Initial-admin stdin CLI: PASS in an isolated in-memory database.
- Company database integrity check: ok; 0 users, 0 reports, 55 default metric definitions.
- Online SQLite backup command: PASS; produced a consistent backup in data/backups.

## Environment and operational limits

- Registry downloads were blocked. Compatible installed package copies were restored into this workspace, conflicting nested versions reconciled, and npm generated npm-shrinkwrap.json. The lock has no dependency on other project paths. A clean network installation and current online vulnerability audit remain unverified.
- SMTP credentials and a public HTTPS domain were not supplied. In-app reminder logic is tested; actual provider delivery and public deployment are not claimed.
- SQLite deployment is one application instance with persistent disk. Email sends are best effort; uncertain/failed sends are not automatically retried. Daily catch-up reminders cover 31 days.
- Non-Latin/RTL PDF text was not verified. Supply licensed Unicode font paths for non-Latin glyph coverage; RTL shaping requires additional work.
- Three earlier failed fixture runs left memory-only test listeners on loopback ports 3107, 3108, and 3109. Windows sandbox access denied termination attempts. They contain only clearly labeled Fixture data and example.test accounts, never company data. Stop those specific Node listeners through your normal Windows process controls when cleaning the environment. The final fixture implementation uses in-process setup/teardown on 3110 and releases its port.

The company database has no default account or demonstration performance data. Create the initial administrator with the secure command in README.md.
# Firebase and public-preview verification — 2026-10-15

- Production build, lint, and all 41 unit/API tests passed. Hosted-backend tests cover Firestore record restoration, large UTF-8 pages, revision-cache invalidation, failed commits, session persistence, employee file isolation, and binary downloads.
- The native Firestore import was checked against all 194 source documents and the original attachment bytes. Existing passwords were preserved and imported sessions were revoked.
- Private Firestore rules and indexing exclusions were deployed successfully. The project still reports `billingEnabled: false`. The production-only dependency audit reports zero known vulnerabilities.
- Render rejected creation of a Free service with a payment-verification requirement. No Render service or paid plan was created.
- At the user's request, the app runs through a temporary Cloudflare Quick Tunnel from this computer. Public HTTPS returned 200 for the app and a healthy Firestore response; anonymous report access returned 401. The generated URL and process IDs are recorded in ignored `.tools/public-preview/processes.json`.
- The preview depends on this computer, its network connection, and the two background processes. Restarting the tunnel changes the URL. See `DEPLOYMENT.md` for start/stop commands and the storage/availability limits.

# Firebase-only conversion verification — 2026-10-15

- The original 41 unit/API/domain/upload tests passed after extracting the shared calculation query contract. Native server compilation, browser TypeScript checks, and targeted ESLint checks passed.
- Six tests against the real Firestore emulator passed. They verify anonymous/uninvited/inactive rejection, cross-employee isolation, no self-promotion or target changes, server timestamps, report locking, immutable atomic history, private file manifests/chunks, and immutable caller-attributed audit events.
- An isolated `demo-cadence` Auth/Firestore integration run passed using the actual Firebase web SDK, browser reporting routes, and production security rules. Coverage includes preserving the admin session during invitations; employee bootstrap scope; CSV/XLSX parsing; private original-byte downloads; a full 5 MiB upload and atomic deletion; report submission/history; CSV/XLSX/PDF signatures and export scope; administrator correction requests; resubmission; concurrent-write rejection; and review/reminder notifications with mark-as-read.
- The production dependency audit reports zero known vulnerabilities after overriding the Firebase SDK's stale Node-only gRPC dependency with 1.14.6.
- The Firebase build is guarded by a source fingerprint, deployment-mode manifest, and a private-key check. The public site contains browser assets only. Legacy service-account files and server database collections remain private.
- The temporary public preview was stopped before cutover. The migration copied 3 accounts, 2 reports, and 1 attachment into 50 Firebase-only documents. A disposable Firebase Authentication account verified the existing scrypt password format and was deleted. Independent source comparison verified every safe profile, report, original attachment byte, and parsed spreadsheet row; billing remains disabled.
- Firebase CLI successfully compiled and released the production rules and index exclusions, then published the static site to `https://cadence-53781.web.app`.
- Live HTTPS checks returned 200 for the homepage and calculation WASM asset, confirmed the deployed source fingerprint, and returned 403 for anonymous Firestore access. The login page was inspected in Chrome at widths 320, 768, 1024, and 1440 with no horizontal overflow. Browser logs showed only unrelated installed-extension messages. Actual company passwords were never read or entered during QA.

# Administrator reminder correction — 2026-10-16

- Personal due/overdue and weekly/monthly reporting reminders now apply only to employees in both the Firebase client and legacy scheduler. Older administrator reminders are filtered from the inbox and unread badge; other notifications remain visible. Legacy SMTP delivery also excludes personal reporting reminders addressed to administrators.
- All 42 native unit/API/domain tests passed, including a regression that seeds legacy administrator reminders and verifies inbox visibility, unread counts, and continued employee reminders. TypeScript and targeted ESLint checks passed.
- The real Firebase SDK/emulator integration passed with seeded legacy admin notifications. It verifies no new admin reminders are created, the five existing test records are preserved, only the unrelated review notification remains visible, and employee reminders continue to work.

