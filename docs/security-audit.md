# Local Services & Bookings — Security Audit

## Latest production read-only audit

Date: 2026-11-07 (America/Los_Angeles). The student authorized production
read-only checks using the existing environment configuration.
**20 checks passed; 0 failed; 0 blocked.** This is evidence of read access and
isolation, not proof of write authorization.

Run with:

```powershell
npm.cmd run test:rls:readonly
```

Node loads `.env.local` privately. No environment-file contents, passwords,
tokens, account email addresses, booking contact information or booking notes
were printed. No application records were modified. Authentication password
sign-in and sign-out requests were used to establish/end in-memory test
sessions; these operations can update Supabase Auth session/sign-in metadata.

The runner uses the configured anon/publishable key for every role.
It does not use `SUPABASE_SERVICE_ROLE_KEY`. Its fetch guard permits only GET
requests to the five application tables and the specific authentication
sign-in/sign-out endpoints. Table INSERT/UPDATE/DELETE, RPCs, other hosts and
redirects are blocked independently of mutation environment flags.

## Account verification

The configured providerA/providerB accounts verified as `provider`, and
clientA/clientB verified as `client`. The student identified the account
configured as `UNRELATED_EMAIL` / `UNRELATED_PASSWORD` as the administrator;
its authenticated profile verified as `admin`. This label is a credential
alias, not an authorization bypass. No profile role was assigned or changed.

The first attempt could not find `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
An interim provider-controlled audit passed 19 checks with 4 admin checks
blocked. After supporting the student's existing unrelated-account alias and
verifying its real profile role, the final run below passed all 20 checks.
No credentials had to be edited by the agent.

## Observed results

Controls returned through the authenticated admin session: 4 services,
4 category mappings and 3 bookings. The audit accepts existing records rather
than requiring exactly two original bookings. Booking reads requested only IDs
and service references. Known public and private controls establish that denied
reads were not merely queries against an empty database.

| Check | Actual result | Evidence |
| --- | --- | --- |
| providerA: authentication and profile role | PASS | Expected visibility verified. |
| clientA: authentication and profile role | PASS | Expected visibility verified. |
| providerB: authentication and profile role | PASS | Expected visibility verified. |
| admin: authentication and profile role | PASS | Expected visibility verified. |
| clientB: authentication and profile role | PASS | Expected visibility verified. |
| Admin: read service controls | PASS | 4 services visible to the authenticated admin. |
| Anonymous: approved services visible, private services hidden | PASS | 2 approved services visible; 2 verified non-approved controls hidden. |
| Anonymous: active categories visible | PASS | 1 visible categories; all active. Existence of hidden inactive categories was not independently established. |
| Admin: read mapping controls | PASS | 4 mappings visible to the authenticated admin. |
| Anonymous: only approved-service mappings visible | PASS | Public/private mapping visibility verified against the established service controls. |
| providerA: only owned services visible | PASS | Expected visibility verified. |
| providerA: owned mappings include approved services | PASS | Expected visibility verified. |
| providerB: only owned services visible | PASS | Expected visibility verified. |
| providerB: owned mappings include approved services | PASS | Expected visibility verified. |
| Admin: read existing booking controls | PASS | 3 existing bookings visible; contact information and notes were not requested. |
| anonymous: no booking read access | PASS | Permission denied, as required. |
| clientA: no booking read access | PASS | Existing booking controls are hidden by RLS. |
| clientB: no booking read access | PASS | Existing booking controls are hidden by RLS. |
| providerA: only bookings for owned services visible | PASS | Expected visibility verified. |
| providerB: only bookings for owned services visible | PASS | Expected visibility verified. |

A PASS on an expected-denial check means access was denied or existing rows
were hidden, as required. The anonymous booking query returned permission
denied; both clients received no booking rows.

The category check established that one category was visible and active.
It did **not** independently establish the existence of an inactive category,
so a separate known-inactive-category negative control remains unverified.

## Isolated SQL write, migration and deletion audit

Date: 2026-11-07. **40 checks passed; 0 failed.** Reproduce with:

```powershell
node scripts/rls-isolated-tests.mjs
```

[Machine-readable results](evidence/midterm/rls-isolated.json) include migration
execution, data preservation, positive/negative authorization and cleanup.

The runner uses the cached Supabase PostgreSQL 17 image in a new Docker
container with no network, published ports, host mounts or production
configuration. Synthetic legacy fixtures are upgraded through all four current
migration files. Every write test rolls back; the final snapshot confirms that
legacy IDs, prices, currency, descriptions, notes, references and timestamps
remain unchanged. The container is removed after the run.

These are real PostgreSQL RLS/constraint tests. SQL roles and the request JWT
subject setting simulate Supabase's database authorization context; they do not
test Supabase Auth's HTTP token verification or production HTTP write paths.
The fixture bootstrap models standard anon/authenticated/service-role grants
locally; elevated local success does not independently prove production grants.

| Required scenario | Actual isolated outcome |
| --- | --- |
| Anonymous approved-service reads / draft denial | PASS |
| Known active category visible / known inactive category hidden | PASS |
| Public approved-service mappings / private mapping isolation | PASS |
| Provider-owned draft creation using allowed columns and default status | PASS |
| Provider edits own draft/suspended service | PASS |
| Provider cannot forge ownership or update/delete another provider's service | PASS |
| Provider cannot edit/delete own approved service | PASS |
| Provider submits draft but cannot approve it | PASS |
| Client cannot approve services or self-assign admin role | PASS |
| Admin approves pending and suspends approved services | PASS |
| Anonymous and client booking inserts without booking SELECT rights | PASS |
| Booking insertion for non-approved service denied | PASS |
| Anonymous/client booking-read isolation | PASS |
| Owning provider and administrator booking reads | PASS |
| Administrator elevated writes across all five application tables | PASS in isolated service-role context |
| Provider deletion RESTRICT; category/mapping and service/booking CASCADE | PASS |
| All migration files execute; legacy data survives; container removed | PASS |

No application writes were made in production. Real provider-session HTTP
creation and production write grants remain unverified under the student's
production read-only restriction. The student previously reported a successful
browser booking persisted in production, but that report is not substituted
for a controlled authenticated-role write audit.

The earlier production inactive-category check established one visible active
category without an independent hidden-row control. That production limitation
remains; the isolated audit now supplies the required known-inactive negative
control on synthetic data.

## Current application authorization design

- `src/lib/supabaseServer.ts` is server-only. Public GET services uses its
  privileged client with an explicit approved filter and public column list.
  Active categories are filtered explicitly in that response.
- POST services validates strict input, verifies a cookie-authenticated user
  and trusted provider profile, and uses that user's session for service/category
  inserts and cleanup. Ownership comes from the verified user. The database's
  draft default is used because providers have no INSERT grant on status.
- PATCH/DELETE/submission/review and booking routes use request-scoped
  session clients, with role/ownership checks and database RLS.
- Direct anonymous RLS reads are independent of the application's privileged
  GET, so the public API cannot make a failing anonymous RLS test appear to pass.
- Clients and anonymous visitors have no booking read access. Providers see
  bookings for their own services; admins can read the booking controls.
- Providers read their own category mappings at every status, including
  approved. Mapping writes remain restricted to owned draft/suspended services.
- Profile roles cannot be assigned through ordinary application profile writes.
  The role enum remains admin/merchant/provider/client.

## Migration and script status

The student reports that the original migration and baseline placeholders were
applied, then ran `20261107000000_exam_schema_alignment.sql` successfully in
SQL Editor. This audit did not execute SQL, inspect constraints or reconcile the
CLI migration ledger; manual SQL execution alone is not evidence that the CLI
version was recorded. Do not rerun the old migration.

The older `scripts/rls-tests.mjs` includes mutation cases, fixed fixture-count
assumptions and outdated transition/cleanup assumptions. It was **not run**.
Use the separate read-only runner for the production checks documented here.

Local verification for the new runner covers allowed read/auth operations,
blocked table writes/RPCs/other origins, sanitized network errors, refusal of
elevated keys, dynamic booking counts, provider-derived controls, and verification
of the unrelated-account admin alias. Live read results above do not establish
a complete Part 4 write audit.
