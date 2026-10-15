# Free deployment: Render + Firebase Spark

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
