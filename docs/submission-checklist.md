# Midterm Version B submission checklist

## Completed and observed

- Exam branch: exam/services-booking-eval.
- Instructor pdt605 access: confirmed by student; not independently verified.
- Three Given/When/Then stories, size estimates and route/migration traceability
  are documented in requirements.md.
- Strict provider-session API and prescribed semantic responsive service UI
  are implemented, with local regression tests.
- Production read-only RLS audit: 20 checks passed; see security-audit.md.
- Isolated PostgreSQL migration/write/deletion audit: 40 checks passed using
  synthetic fixtures. The container had no network/host mounts and was removed.
- All four migrations executed successfully in that disposable database, and
  the legacy-record snapshot was preserved before/after migration and tests.

## Verified outstanding migration metadata

A read-only remote CLI check found these original versions recorded:
20261029140000, 20261106234100, 20261106234200. Version 20261107000000 was absent.
The student reports already executing its SQL successfully in SQL Editor.
Do not execute its DDL again merely to update history.

The installed CLI's help specifies the metadata-only reconciliation command:

```powershell
npx.cmd supabase migration repair 20261107000000 --status applied --remote
```

This is a production metadata write, not a migration execution. It has NOT
been run by the agent under the student's production read-only restriction.
After reconciliation, verify with:

```powershell
npx.cmd supabase migration list --remote
```

## External deliverables not yet verified

- Hosted deployment URL: not supplied/verified.
- Open PR: exam/services-booking-eval into main, not supplied/verified.
- Final branch commits/push: current uncommitted work needs review and recording.
- Current exam partner contribution: not established by older Lab 2 commits.
- Canvas checkpoint and final submission: student must verify/submit through
  their own account; no Canvas action was taken by the agent.

GitHub/Vercel/Supabase connectors are disabled by the environment administrator.
GitHub CLI and Vercel CLI were not available on PATH at inspection. No token,
password or environment file should be pasted into chat to work around access.

The application should receive only its actual required environment values
through the hosting provider's private settings. Do not upload the production
test-account passwords or copy .env.local into a submission artifact.

## PR description prepared for review

Title: Complete Version B local services and bookings exam slice

This change implements strict provider-session service creation, public approved
service browsing, accessible responsive service/booking components, and the
forward schema alignment required by the exam. It preserves legacy data during
upgrade and records authorization evidence with separate production read-only
and isolated PostgreSQL write/deletion audits.

Validation: local unit/regression suite, lint, TypeScript and production build;
20 passing production read-only checks; 40 passing isolated database checks.
Migration execution in production is student-reported; its missing CLI ledger
entry still needs reconciliation. Deployment and real authenticated HTTP write
flows are not claimed verified by the SQL role tests.

Attach the actual hosted URL and include the links to requirements.md,
security-audit.md, ai-log.md and both application migrations. Keep the PR open
for grading; do not merge it as a substitute for submitting its link.

## Final student checks

Confirm the Canvas deadline because the supplied date and weekday conflict.
Confirm pdt605 collaborator access, open PR link, deployment URL and all required
attachments are present. Do not claim missing original prompts, partner work,
commit attribution or unperformed checks as completed.
