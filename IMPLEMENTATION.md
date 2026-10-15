# Implementation plan

1. Foundation: inspect empty workspace, TypeScript/React/Express, SQLite migrations, sessions, admin CLI, request validation and authorization. Validate schema and authentication.
2. Management: custom roles/categories, employees, versioned KPI assignments and score configurations, schedules and leave. Validate employee lifecycle and isolation.
3. Reporting: multi-activity drafts, submission, correction/review history, optimistic concurrency. Validate duplicates, working dates and transition permissions.
4. Analytics: calendar-based KPI aggregation, evidence-based scores, comparisons, role-labelled dashboard and summaries. Validate period math and score edge cases.
5. Notifications/exports: persistent deduplicated scheduler, optional SMTP, scoped CSV/XLSX/PDF. Validate recipients, date filters and formula protection.
6. QA/deployment: unit/integration/browser tests, lint, typecheck, production build, security/deployment documentation.

Local repository delivery and deployment preparation are the requested scope. No external hosted Site is created.

## Completion record

All six phases have been implemented and validated in the local workspace. Final checks on 2026-10-15: lint, full TypeScript checks, production build, 37 unit/API tests and 3 browser workflows passed. The browser suite now covers multiple activity links, CSV and DOCX uploads, and the admin parsed-data dashboard with filters, bar charts, and a radar chart. See [QA_REPORT.md](QA_REPORT.md) for the test scope and environment limits.
