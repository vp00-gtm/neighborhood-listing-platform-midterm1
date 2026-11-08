# Neighborhood Listing Platform — CIS 3610 Midterm Version B

Local services and appointment bookings, integrated into the existing
neighborhood/property demonstration site.

- Implementation author: Vanessa Palomera.
- Exam branch: `exam/services-booking-eval`.
- Instructor collaborator access: confirmed by the student; not independently
  inspected by the agent.
- Earlier Lab 1/Lab 2 work and partner review evidence remain in
  [testing notes](docs/testing-lab2.md) and [AI journal](docs/ai-log.md).
  Prior lab contributions do not establish current exam partner contributions.

## Run locally

Use the installed Node.js/npm versions recorded in
[setup notes](docs/setup-notes.md), then:

```powershell
npm.cmd ci
npm.cmd run dev
```

Open the local address printed by Next.js (normally http://localhost:3000).
In PowerShell, .cmd avoids the npm.ps1 execution-policy issue.

The application requires NEXT_PUBLIC_SUPABASE_URL and
NEXT_PUBLIC_SUPABASE_ANON_KEY. Public service GET also uses
SUPABASE_SERVICE_ROLE_KEY strictly on the server. Configure actual values
privately in the environment; do not commit them or paste them into logs.
Protected provider/admin routes require real authenticated Supabase cookies.
No sign-in UI or mock login is provided.

## Current features

- Approved-service browsing with active category labels and public details.
- Responsive 1/2/3-column semantic cards and keyboard-operable booking controls.
- Strict service validation and provider-session draft creation.
- Provider-owned edit/delete/submission routes and administrator review.
- Public booking requests with server validation and private booking reads.
- The existing property filters, disclosure cards, illustrations and sponsor
  banner remain available; sample property data is fictional.

## Checks

```powershell
npm.cmd run test:validation
npm.cmd run lint
npm.cmd exec tsc -- --noEmit --incremental false
npm.cmd run build
```

Local tests use mocks/fixtures and do not connect to Supabase.

For the explicitly read-only production authorization audit:

```powershell
npm.cmd run test:rls:readonly
```

That runner loads test account variables privately, verifies actual profile
roles, and blocks table writes/RPCs. The student's UNRELATED account is accepted
as the admin credential alias only when its real profile role is admin.
Authentication establishes and ends sessions; see [actual audit results](docs/security-audit.md).

For isolated SQL/RLS and deletion tests, Docker must be running and the cached
Supabase PostgreSQL image identified in the runner must be available:

```powershell
node scripts/rls-isolated-tests.mjs
```

It uses synthetic fixtures in a temporary network-disabled container with no
host mounts or published ports. It does not load environment files or use
production credentials. It removes its container on completion. These SQL role
tests are distinct from real Supabase HTTP authentication/API write tests.

Do not use the older mutation-capable test:rls command against production.

## Exam documents and migrations

- [Three user stories and traceability](docs/requirements.md).
- [Security audit and remaining evidence limits](docs/security-audit.md).
- [AI provenance journal](docs/ai-log.md).
- [Submission checklist](docs/submission-checklist.md).
- [Required original migration](supabase/migrations/20261029140000_exam_services_persistence.sql).
- [Forward alignment migration](supabase/migrations/20261107000000_exam_schema_alignment.sql)
  and [effects/history notes](docs/exam-schema-alignment.md).

The original migration is already applied according to the student; never rerun
its sample-specific backfills. The alignment SQL was applied manually in SQL
Editor. A remote CLI check found its version missing from migration history;
this needs metadata reconciliation, not reexecution of its DDL.

## Deployment and submission

Hosted URL: **not yet verified/provided**. PR URL: **not yet verified/provided**.
The required PR targets main from exam/services-booking-eval and should remain
open for grading. Never merge it merely to complete the submission.

Deploy only the necessary application environment variables privately. Test
account passwords are not needed by the deployed site. The service-role key
must never be public. Verify the hosted homepage, services API, categories and
booking UI before recording a successful deployment.

Canvas submission and any required partner attestation must be completed by
the student through their own account. The rubric's weekday/date deadline
wording conflicts; Canvas is the source for the actual cutoff.
