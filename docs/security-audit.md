# CIS 3610 Midterm Version B — Security Review

## Scope and implementation status

This document separates the repository snapshot, historical test evidence, and
the confirmed security target. The schema export and archived SQL files are
not proof of the current live database or migration ledger. Verify the live
schema, grants, RLS policies, and migration history before describing them as
deployed.

Use the following status labels:

- **Planned** — confirmed target behavior not yet implemented.
- **Implemented, unverified** — code or SQL exists locally, but the behavior
  has not been confirmed against the target or database.
- **Tested** — a named test actually ran in an identified isolated environment
  and observed the stated outcome.
- **Not run/Blocked** — a test did not run; record its prerequisite.

The original SQL files are in `supabase/migrations-archive/`; the active
`supabase/migrations/` folder was empty at the last inspection. Their presence
in the archive does not establish that they are applied remotely. No proposed
migration or policy change described below is claimed to be implemented or
tested.

## Confirmed security target

### Profiles and roles

The target roles are `admin`, `merchant`, `provider`, and `client`, one role
per profile. Existing profiles are not assigned roles automatically. The
first administrator is assigned through a trusted manual administrative
process. Subsequent role assignment and revocation also use a trusted
administrative process.

Ordinary users must not be able to change their own role. Enforce this at the
database privilege/policy layer, not only in application code. For example,
ordinary profile edits should have privileges only for approved non-role
columns, while role updates are reserved for a trusted administrative
workflow. Do not rely on user-editable metadata to authorize administrators.

### Services, categories, and mappings

- Anonymous visitors may read approved services and appropriate public
  fields.
- Categories and public mappings continue to use the existing `is_active`
  field until a safe transition to `active_status` is separately approved.
  No values are copied or backfilled.
- Public mappings are visible only for approved services and active
  categories.
- Service creation requires an authenticated profile with role `provider`.
  The server sets `provider_id` from the authenticated session and `status` to
  `draft`; requests cannot choose either value.
- Providers may modify only their own eligible services and may not approve
  them or change ownership. Merchants receive no provider permissions.
- Administrator responsibilities include approving services and deactivating
  bad actors, in addition to booking read access for audits. These
  administrative permissions are part of the target and are not claimed to be
  implemented or tested. Booking UPDATE and DELETE remain excluded unless
  separately approved.

### Bookings

- Anonymous insert is allowed only for an approved service and only when
  `client_id IS NULL`.
- Authenticated insert is allowed only for a profile with role `client`, only
  for an approved service, and only when `client_id = auth.uid()`. The server
  derives the client ID from the authenticated session.
- The controlled booking API validates inputs and uses a non-privileged
  Supabase client so RLS remains enforced. It does not use a service-role key.
- `scheduled_at` remains required. `requested_date` and `scheduled_at` are
  validated independently; no time is derived and no timezone relationship
  is assumed.
- New booking requests write to `notes`. The existing `client_notes` column
  remains separate; no values are copied or backfilled.
- Guests and clients have no direct SELECT access to booking rows. The guest
  endpoint returns only a generic confirmation and does not return a booking
  record.
- Providers may SELECT bookings associated with their own services.
  Administrators may SELECT bookings for audit. No booking UPDATE or DELETE
  permission is included in this target.

Rate limiting and abuse controls should be considered at the application or
hosting layer. RLS does not prevent repeated valid anonymous requests. No
external service is assumed or added without approval.

### Grants and RLS policy replacement

RLS restricts rows but does not itself revoke table privileges. Review and
narrow broad grants to the operations each database role needs. Public reads
and anonymous inserts should not imply booking read access or unrelated write
access.

PostgreSQL permissive RLS policies can combine with **OR**. Adding a narrower
policy does not cancel an older permissive one. Before implementing the target,
inventory the live policies and remove or replace policies that would continue
to allow prohibited access. In particular, the archived policy
`bookings_read_associated` permits clients to read their own bookings and
conflicts with the target no-client-SELECT rule.

## Historical mapping-insert investigation

This section records a prior repository-level investigation; it is not
confirmation of the current live policy state.

The archived mapping `INSERT` policy checks that the service belongs to the
provider and is draft or suspended, and that the category is active. The
original archived RLS migration did not provide a provider SELECT policy for
that provider's unapproved mappings. A request using insert-with-returning
(for example, an SDK `.insert(...).select()` request) also needs the returned
row to satisfy a SELECT policy. A later archived forward migration adds a
provider-owned mapping-read policy. This is a plausible explanation for an
apparent insert/returning failure, but the original request and current live
policy state were not verified.

A duplicate mapping is a primary-key violation; missing references are
foreign-key violations, not RLS denials. Recheck the live policy definitions
before relying on this diagnosis or applying a change.

## Historical RLS test results — previous policy behavior

The following results are retained as historical evidence from the earlier
RLS runner. They test the previous policy behavior and **do not demonstrate
that the confirmed target above has passed**. In particular, the earlier
positive client booking-read results conflict with the current target.

**Historical status meanings:** `Passed` means that earlier scenario ran and
observed its expected behavior under the prior policy setup. `Blocked` means
the earlier runner did not execute all of that scenario.

| # | Historical test case | Historical outcome |
|---|---|---|
| 1 | Anonymous user selects approved services. | Passed |
| 2 | Anonymous user cannot read draft or suspended services. | Passed |
| 3 | Anonymous user reads active categories and public mappings. | Passed |
| 4 | Anonymous user cannot read inactive categories or unapproved mappings. | Blocked — unapproved-mapping visibility subchecks passed; an inactive category ID was not configured. |
| 5 | Provider A creates a draft service for self. | Blocked — mutating-test opt-in was not enabled. |
| 6 | Provider A cannot create for Provider B or insert a non-draft service. | Blocked — mutating-test opt-in was not enabled. |
| 7 | Provider A reads or updates own unapproved service. | Blocked — mutating-test opt-in was not enabled. |
| 8 | Provider A cannot alter another provider's service, ownership, or approval status. | Blocked — risky write-test opt-in was not enabled. |
| 9 | Provider A cannot update an approved service. | Blocked — risky write-test opt-in was not enabled. |
| 10 | Provider A cannot delete Provider B's service. | Blocked — risky write-test opt-in was not enabled. |
| 11 | Provider A adds a mapping to own unapproved service and reads the returned row. | Blocked — mutating-test opt-in was not enabled. |
| 12 | Provider A cannot map another provider's or approved service, or use an inactive category. | Blocked — risky write-test opt-in was not enabled. |
| 13 | Provider A cannot delete Provider B's mapping. | Blocked — risky write-test opt-in was not enabled. |
| 14 | Client A inserts a booking for self on an approved service. | Blocked — persistent-booking opt-in was not enabled. |
| 15 | Client A cannot book for Client B or use a non-approved service. | Blocked — risky write-test opt-in was not enabled. |
| 16 | Client A reads their own booking. | Passed under previous behavior; this is not allowed by the confirmed target. |
| 17 | Provider A reads bookings for own services. | Passed under previous behavior. |
| 18 | Client A cannot read Client B's booking. | Passed under previous behavior; this did not test the current no-client-SELECT requirement. |
| 19 | Provider A cannot read Provider B's booking. | Passed under previous behavior. |
| 20 | Unrelated user cannot read; users cannot update/delete bookings. | Blocked — risky write-test opt-in was not enabled. |
| 21 | Anonymous user cannot read profiles or write protected tables. | Blocked — risky write-test opt-in was not enabled; disposable category fixture was not reached. |
| 22 | Authenticated user cannot read or update another user's profile. | Blocked — risky write-test opt-in was not enabled. |

Historically, the runner reported seven scenarios passed (1, 2, 3, 16, 17,
18, and 19), zero failed, and fifteen blocked. No write operations were enabled
in that run. Scenario 11 did not verify the provider mapping-read migration.
These counts describe that earlier run only; they are not results for the
current target.

## Future verification plan

All future unit, API, schema, and RLS tests must use an isolated local database
or a dedicated disposable test project with disposable accounts and fixtures.
Never run mutating tests against production or real user records. Before using
the existing RLS runner, review its environment-loading behavior and make the
test target fail closed unless it is affirmatively verified as isolated.

The target-policy test plan must cover:

1. Anonymous reads of approved services, `is_active` categories, and mappings
   only for approved services and active categories.
2. Provider-role-only service creation, server-derived provider ownership,
   draft status, and provider ownership restrictions.
3. Merchant denial of provider-only operations and rejection of ordinary
   users' attempts to change their own roles.
4. Guest insert for an approved service with null `client_id`; rejection for
   non-approved services; no anonymous booking SELECT.
5. Authenticated client-role insert with `client_id` derived from the session;
   rejection for other roles or a forged client ID; no client booking SELECT.
6. Provider reads restricted to bookings for their own services and
   administrator read access for audit.
7. No ordinary booking UPDATE or DELETE, and least-privilege grants that do
   not reintroduce access blocked by RLS.
8. Booking API validation of email, date, required timestamp, and notes, plus
   a generic success response that contains no private booking record.
9. Rate-limit behavior if and when an application/hosting-layer control is
   selected.

Record each actual test as **Passed**, **Failed**, or **Not run/Blocked**, with
the test environment and scenario. Expected behavior is not a test result.
Keep local migration-file presence, remote migration-ledger recording, SQL
execution, and observed test results as separate facts.
