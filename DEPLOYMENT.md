# Firebase Spark deployment

The live deployment at **https://cadence-53781.web.app** uses **Firebase Hosting, Firebase Authentication (email/password), and Cloud Firestore**. It requires no local server, Cloud Functions, Cloud Run, Cloud Storage, Render account, or billing account.

## Build and publish

1. Authenticate the Firebase CLI with an account that owns `cadence-53781`.
2. Run `npm run typecheck`, `npm test`, and `node scripts/test-firebase.mjs --integration`. The latter uses only local demo emulators; Java 21+ must be available. An optional workspace-local runtime is discovered in `.tools/java21`.
3. Run `npm run build:firebase`. This regenerates the browser adapters from the established report routes, checks TypeScript, and builds a static Firebase version into `dist/`.
4. Deploy with `npx firebase deploy --only firestore,hosting --project cadence-53781 --account OWNER_EMAIL`.

`npm run build` remains the original local/server build. Always use **build:firebase** immediately before a Firebase Hosting deployment. Firebase serves only `dist/`; credentials, databases, and source files are excluded from the public deployment.

Read-only post-deployment checks: `node scripts/verify-firebase-live.mjs`. The one-time migration can be independently checked against the archived source with `npx tsx scripts/firebase-spark-verify.ts --account OWNER_EMAIL`; after real users change the new workspace, source comparisons may legitimately differ.

## One-time migration

Initialize Authentication with **Get started** in the Firebase console. `node scripts/firebase-auth-setup.mjs --apply --account OWNER_EMAIL` enables email/password sign-in and the Hosting authentication domains. It verifies billing is disabled; it does not enable billing or upgrade Identity Platform.

`npm run firebase:migrate:spark -- --account OWNER_EMAIL` previews the existing cloud database. For the final cutover, stop the old public preview with `npm run preview:stop`, then add `--apply`. The migration reads the latest Firestore snapshot, preserves report/file/revision/audit data, and imports existing Node scrypt password hashes into Firebase Authentication. A disposable account verifies the exact password format and is removed afterwards. The final Firestore import is atomic and checks that the source has not changed. It refuses to overwrite an existing Firebase-only workspace. The old cloud collections and local database remain available as historical backups; they are not kept in sync after cutover.

## Runtime and permissions

Reports allow one employee editing session after submission. The employee opens **Edit daily report (one chance)**, saves any changes or attachments during that session, and chooses **Resubmit and lock** to close it permanently. The allowance is stored with the report and enforced by Firestore rules. Administrators cannot grant a second edit. Drafts remain editable before their initial submission.

When upgrading a workspace created before this feature, run `node scripts/firebase-report-edit-upgrade.mjs --account OWNER_EMAIL` before deploying the new rules and frontend. The idempotent upgrade only adds missing edit flags and increments the aggregate revision; it preserves report contents, history, and authoritative submission timestamps. It never resets an existing edit allowance.

Admin target, KPI, and scoring-model mutations are disabled. Historical definitions and assignments remain readable for existing calculations. Company holidays and score overrides are no longer shown in admin settings. On **Uploaded files**, selecting one or more files displays graphs only, with totals or row-weighted averages across every selected file; the raw-row table and original-file download controls have been removed from that page.

Calling-data CSVs with **Owner, Remarks, Status, Response, and Next action item** use five combined attribute filters and record-count graphs on both the uploaded-files page and the report attachment dashboard. The original `Nex Action item` spelling, trailing header spaces, and numbered duplicate columns are supported. Identical values in repeated action columns count once per record. Filters include missing values, ignore case and extra whitespace, and apply across every selected file. Phone numbers are not totaled or averaged for this format.

The website talks directly to Firebase Authentication and Firestore. Existing SQL scoring calculations run in an in-memory `sql.js` projection of **only the records the signed-in account may read**. Firebase is authoritative; refreshing or closing a browser does not erase data.

- `cadenceProfiles/{authUid}` stores safe membership, employee settings, assignment history, leave, and reflections. Password hashes and sessions are never included. Employees can read their own profile; administrators manage membership. Signing up for Firebase Authentication alone grants no workspace access.
- `cadenceConfig/main` stores shared roles, categories, KPI definitions, calendar settings, scoring models, and a minimal reviewer name directory.
- `cadenceReports/{employeeId_date}` stores one report with its activities, attachment metadata, and feedback. Rules protect ownership, review fields, status transitions, revision numbers, server submission timestamps, and immutable report history. Stale transactions fail instead of overwriting another browser's changes.
- `cadenceFiles/{fileId}/parts` stores private original files and compressed parsed rows in 256 KiB chunks. Upload and removal are atomic with report metadata. Downloads verify SHA-256 hashes and sizes. Files are delivered as browser downloads, with no public file URLs.
- `cadenceNotifications` stores personal reminders and manager review notifications. `cadenceAudit` stores immutable, caller-attributed activity events. The Firebase console retains authentication metadata. Browser-generated audit descriptions reflect client actions; Firebase identity, timestamps, permissions, and immutable report snapshots provide the independent checks.

The old server collections remain denied to all web clients. No Firebase Admin SDK credential is included in the browser bundle. The legacy ignored `.env.render-secret` is unnecessary for this static deployment.

## Changes for the free plan

- The site works independently of this computer. Closing a preview, sleeping the computer, or turning it off does not stop Firebase Hosting.
- Personal daily/weekly/monthly reporting reminders apply to employee accounts. Administrators do not receive these reminders, and old personal report reminders are excluded from their inbox and unread count. Other notifications remain visible. In-app reminders are calculated when an employee opens the workspace or refreshes notifications. There is no unattended background scheduler or SMTP reminder delivery.
- Administrators invite users with an initial password. Password resets use Firebase's email reset link. Login email changes require coordinated Authentication/profile maintenance; the app's edit form keeps the login email read-only.
- CSV, XLSX, and PDF exports are generated in the browser. CSV and XLSX uploads retain parsed-row insights; other supported formats remain downloadable attachments.
- Limits remain 5 MiB/file and 10 attachments/report. Parsed files are limited to 10,000 rows, 50 columns, 16 MiB expanded JSON, and 2 MiB compressed data. Individual report/profile/config documents have an 800 KiB safety limit.
- Spark quotas still apply. Files and their parsed rows share Firestore's free storage quota with the reports. Quota exhaustion can temporarily interrupt service. This is an ongoing cloud deployment, with no guarantee of unlimited free usage or lifetime availability.

## Archived server deployment notes

The notes below describe the earlier server/tunnel implementation. They are retained for reference; the Firebase-only deployment above supersedes them.

## Current no-card route: temporary public preview

Render requested a payment method for this account even with its Free plan selected. No Render service was created and no card was added. The alternative is a temporary Cloudflare Quick Tunnel running from this computer, backed by the migrated Firestore database. It is a preview, not an independent cloud deployment: the computer and both background processes must stay on and connected. No always-on availability is promised. Google billing remains disabled.

Run `npm run build` and then `npm run preview:public` to start it. The official Cloudflare client must exist at `.tools/cloudflared.exe`; the Firebase runtime secret stays in ignored `.env.render-secret`. The startup script prints the real generated URL and stores process information in ignored `.tools/public-preview/processes.json`. It binds the app to loopback and configures its exact HTTPS origin. Logs are in `.tools/public-preview/`. Stop both processes with `npm run preview:stop`. Restarting creates a different public URL; the records and attachments remain in Firestore.

The original local SQLite installation and this Firestore-backed preview are separate data stores after the import. Use the preview for subsequent cloud-backed changes.

The remaining instructions describe the prepared Render route, which can be used only if Render's account requirements are resolved.

This deployment uses a **Render Free web service** for the complete application and the **default Firestore Standard database** in Firebase project `cadence-53781`. Google billing stays disabled. Firebase Cloud Functions and Cloud Storage are not used.

## Data and files

Firestore holds the permanent reporting records, password hashes, sessions, permissions, report revisions, and audit history. Existing SQL calculations and constraints run against a fresh **in-memory SQLite projection** per transaction; there is no persistent SQLite database on the hosting server. A revision document serializes changes across processes. Responses are buffered until Firestore commits. Failed saves cannot return a success response. The cache is used only after checking the authoritative revision and only after a successful commit.

Small attachments are stored in private Firestore documents, split into 256 KiB chunks with a SHA-256 integrity check. The existing 5 MB per-file and 10-files-per-report limits still apply. Original files, parsed spreadsheet data, and other records all count toward the same Firestore storage quota. The server performs ownership checks before any download. Browser clients have no direct Firestore access; `firestore.rules` denies all client reads and writes.

This adapter is intended for a small workspace. It reconstructs the workspace in memory and serializes database operations. Changes are limited to 450 document writes/deletes and a conservative 7 MiB serialized transaction. Large uploads may need to be split. Schema changes require a deliberate data migration; the runtime refuses a mismatched migration fingerprint. Fingerprints normalize line endings so Windows imports and Linux deployments agree.

## Deployment steps

1. Sign in to Firebase with the project owner account: `npx firebase-tools login:add --interactive`.
2. Run `node scripts/firebase-setup.mjs --account OWNER_EMAIL --runtime-key`. This enables the Firestore API, creates the default database in `us-central1` if absent, and creates a runtime service account with `roles/datastore.user`. It never enables billing. Its credential is written only to ignored `.env.render-secret`.
3. Run `npm run build`, `npm test`, and `npm run lint`.
4. Deploy the private Firestore rules and indexing exclusions: `npm run deploy:firebase -- --account OWNER_EMAIL`.
5. Preview the import: `npm run firebase:import -- --account OWNER_EMAIL`. Apply once with `--apply`. The import copies the local accounts, reporting data and files, preserves passwords, and revokes old sessions. It refuses to overwrite existing cloud users/reports. Keep the local database and backups until the deployed app is verified.
6. Push the verified source commit to the existing repository. Create a Render **Free** Node web service from `https://github.com/Ahmar765/Reporting-System` with `render.yaml` or equivalent settings. Build: `npm ci --include=dev && npm run build`. Start: `npm run start:hosted`. Health check: `/api/health`.
7. Set Render's secret `FIREBASE_SERVICE_ACCOUNT` to the JSON value in `.env.render-secret`. Never commit this file or paste the value into chat. `RENDER_EXTERNAL_URL` supplies the HTTPS application origin automatically. For a custom domain, set `APP_ORIGIN` explicitly.
8. Verify `/api/health`, anonymous access rejection, HTTPS login, and downloads before sharing the URL. Existing users sign in with their previous credentials.

## Free-plan limits

- Render Free services sleep after inactivity. Cold starts can take time. Reminder processing runs only while the process is awake and catches up on restart; this is not an always-on scheduled service. No keep-alive workaround is configured.
- Hosted email delivery is not enabled. In-app reminder records continue to work; external SMTP credentials were not supplied.
- Firestore Spark includes 1 GiB of stored data, 50,000 reads/day, 20,000 writes/day, 20,000 deletes/day, and 10 GiB/month of outbound transfer. With billing disabled, quota exhaustion can interrupt service. Attachments share those quotas with reporting records.
- Keep one Render instance. The transaction guard also protects against overlapping deploys. For a larger workspace, replace the projection adapter with indexed entity-specific Firestore access.
- Attachment writes are staged before their metadata commit; failed metadata commits trigger cleanup. An abrupt process termination or exhausted deletion quota may leave inaccessible orphan chunks that require administrative cleanup.

Official references: [Render Free](https://render.com/docs/free), [Firestore free quotas](https://firebase.google.com/docs/firestore/quotas), [Cloud Storage billing requirements](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024).
