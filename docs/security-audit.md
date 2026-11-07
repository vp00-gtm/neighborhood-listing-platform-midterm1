# CIS 3610 Midterm Version B — Security Audit

## Scope and implementation

This audit covers the row-level security policies in
`supabase/migrations/20261106092700_exam_services_rls.sql`, which applies after
the table migration
`supabase/migrations/20261029140000_exam_services_persistence.sql`. The
forward migration
`supabase/migrations/20261106152900_exam_provider_mapping_read.sql` adds the
provider-owned mapping read policy without replacing the existing insert,
delete, or public-read policies.

The policies enable RLS on `profiles`, `service_categories`, `services`,
`service_category_mappings`, and `bookings`.

- Profiles can be selected, inserted, and updated only by the authenticated
  user whose ID matches the profile ID. There is no client-facing profile
  delete policy.
- Anyone using the `anon` or `authenticated` role can read active categories
  and approved services. Authenticated providers can also read their own
  services, including non-public drafts and suspended services.
- Providers may create only draft services linked to `auth.uid()`. They may
  update or delete only their own draft or suspended services. Update checks
  prevent changing ownership and prevent providers from approving their own
  services.
- Public category mappings are readable only when their service is approved
  and their category is active. Providers may add mappings only to their own
  draft or suspended services and only for active categories; they may remove
  mappings only from their own draft or suspended services. Providers may
  also read mappings for their own draft or suspended services. There are no
  client-facing category write policies.
- Authenticated clients may create bookings only with their own profile ID and
  for an approved service. The client ID is checked against `auth.uid()` and
  is not trusted from the request body.
- An authenticated user may read a booking only as its client or as the
  provider who owns the associated service. There are no booking update or
  delete policies.

No `SECURITY DEFINER` function or service-role key is used. Policies query
related tables without a reverse policy dependency: service policies do not
query bookings or mappings, avoiding recursive RLS evaluation.

RLS restricts rows, not columns. The services API must select an explicit
allowlist of public fields and must not expose internal or private provider
information. Database owners and Supabase's `service_role` can bypass RLS;
service-role credentials must remain server-side and must not be used as a
substitute for normal authenticated-user operations.

Service/category administration and approval are intentionally not granted to
public or ordinary authenticated users. If an administrator workflow is
required, it needs a separately reviewed server-side design; never expose a
service-role key in browser code.

## Mapping insert failure investigation

The mapping `INSERT` policy's `WITH CHECK` validates that the referenced
service belongs to `auth.uid()` and is draft or suspended, and that the
category is active. The original Part 4 migration did not grant providers
`SELECT` on mappings for their own unapproved services. The forward migration
adds only that missing row-scoped `SELECT` policy.

An insert request that asks PostgREST to return the inserted mapping (for
example, an SDK `.insert(...).select()` request) also needs the returned row
to pass an applicable `SELECT` policy. Before the provider mapping-read policy
is applied, the public mapping policy hides mappings for draft/suspended
services. This is a plausible explanation for an apparent insert failure, but
the exact original request and live database error/policy state were not
available to confirm it. A duplicate mapping is a separate primary-key
violation; missing references are foreign-key violations, not RLS denials.

The reported manually created provider mapping-read policy was not present in
the repository migration at inspection time, so repository and live database
policy state may differ. Apply the forward migration and run scenario 11 in
`scripts/rls-tests.mjs` to verify an insert with returned-row representation.

## Positive and negative test matrix

**Status meanings:** `Passed` means the scenario actually ran and the expected
behavior was observed. `Blocked` means the runner did not execute the scenario
because a required fixture, explicit write opt-in, or safe test setup was
missing. Expected behavior is not a test result.

| # | Type | Test case | Expected result | Status |
|---|---|---|---|---|
| 1 | Positive | Anonymous user selects approved services. | Approved public service rows are visible. | Passed |
| 2 | Negative | Anonymous user selects a draft or suspended service. | No non-approved service row is visible. | Passed |
| 3 | Positive | Anonymous user selects active categories and their mappings to approved services. | Active categories and relevant mappings are visible. | Passed |
| 4 | Negative | Anonymous user selects inactive categories or mappings for draft/suspended services. | Those rows are not visible. | Blocked — provider-owned mapping read and anonymous mapping-hide subchecks passed; `RLS_INACTIVE_CATEGORY_ID` is not configured. |
| 5 | Positive | Provider A inserts a draft service with `provider_id = auth.uid()`. | Insert is permitted. | Blocked — mutating-test opt-in is not enabled. |
| 6 | Negative | Provider A inserts a service for Provider B or inserts one already marked approved/suspended. | Insert is denied. | Blocked — `RLS_ALLOW_MUTATING_TESTS` is not enabled. |
| 7 | Positive | Provider A reads or updates Provider A's own draft/suspended service, keeping its status draft/suspended. | Access or update is permitted. | Blocked — mutating-test opt-in is not enabled. |
| 8 | Negative | Provider A updates Provider B's service, changes a service's owner, or changes its status to approved. | Operation is denied. | Blocked — risky write-test opt-in is not enabled. |
| 9 | Negative | Provider A attempts to update an approved service. | Update is denied. | Blocked — risky write-test opt-in is not enabled. |
| 10 | Negative | Provider A attempts to delete Provider B's service. | Delete is denied. | Blocked — risky write-test opt-in is not enabled. |
| 11 | Positive | Provider A adds a mapping from an active category to Provider A's draft/suspended service and requests the inserted row. | Insert and returned row are permitted. | Blocked — mutating-test opt-in is not enabled. |
| 12 | Negative | Provider A maps another provider's or an approved service, or selects an inactive category. | Insert is denied. | Blocked — `RLS_ALLOW_RISKY_TESTS` is not enabled. |
| 13 | Negative | Provider A deletes a mapping for another provider's service. | Delete is denied. | Blocked — risky write-test opt-in is not enabled. |
| 14 | Positive | Authenticated Client A inserts a booking for an approved service with `client_id = auth.uid()`. | Insert is permitted and verified. | Blocked — persistent-booking opt-in is not enabled. |
| 15 | Negative | Client A inserts a booking with Client B's ID or for a non-approved service. | Insert is denied. | Blocked — risky write-test opt-in is not enabled. |
| 16 | Positive | Client A reads Client A's booking. | Booking is visible. | Passed |
| 17 | Positive | Provider A reads a booking for Provider A's service. | Booking is visible. | Passed |
| 18 | Negative | Client A reads Client B's booking. | Booking is not visible to A and is visible to B. | Passed |
| 19 | Negative | Provider A reads a booking for Provider B's service. | Booking is not visible to A and is visible to B. | Passed |
| 20 | Negative | Unrelated authenticated user reads a booking; client and associated provider attempt update/delete. | Unrelated read and ordinary update/delete are denied; record remains unchanged. | Blocked — `RLS_ALLOW_RISKY_TESTS` is not enabled. |
| 21 | Negative | Anonymous user reads or modifies profiles, or modifies categories, mappings, and services. | Access is denied except for explicitly public reads. | Blocked — `RLS_ALLOW_RISKY_TESTS` is not enabled; disposable-category fixture was not reached. |
| 22 | Negative | Authenticated user reads or modifies another user's profile. | Access is denied and profile remains unchanged. | Blocked — `RLS_ALLOW_RISKY_TESTS` is not enabled. |

## Verification status

The RLS runner executed against the configured Supabase project using the
publishable key and independent authenticated sessions. Seven scenarios
passed: 1, 2, 3, 16, 17, 18, and 19. Zero scenarios failed. Fifteen scenarios
were blocked before execution because required write-test opt-ins were not
enabled; scenario 4 also requires an inactive-category ID. Scenario 21's
disposable-category fixture was not reached because its write-test opt-in was
missing. No write operations were enabled by the run. These results validate
only the cases listed as Passed; the forward mapping-read migration itself
was not tested by scenario 11.

Run `npm run test:rls` to execute the database-backed cases. Write tests require
explicit test-only environment flags so they do not unexpectedly mutate
ordinary data. The local test script uses the publishable/anon key and
independent user sessions; it never uses a service-role key.

## Manual setup and testing

1. Apply the table migration, the RLS migration, and then the forward mapping
   read-policy migration.
2. Create test accounts for at least two providers, two clients, and an
   unrelated authenticated user. Create profiles and seed active/inactive
   categories plus approved, draft, and suspended services using a trusted
   database/admin workflow.
3. Execute every matrix case through authenticated Supabase sessions using
   those test accounts; record each actual result and change its status only
   after execution.
4. Confirm service/category administrative operations are performed through
   a trusted server/admin workflow, not by exposing a service-role key in the
   browser.

The script loads `.env.local` through the npm command. To run write scenarios,
use only an isolated test project and explicitly set the relevant gates in
PowerShell before running `npm run test:rls`:

```powershell
$env:RLS_ALLOW_MUTATING_TESTS = "true"
$env:RLS_ALLOW_RISKY_TESTS = "true"
$env:RLS_ALLOW_APPROVED_INSERT_TEST = "true"
$env:RLS_ALLOW_APPROVED_MAPPING_TEST = "true"
$env:RLS_ALLOW_PERSISTENT_BOOKING_TEST = "true"
$env:RLS_INACTIVE_CATEGORY_ID = "<verified inactive category UUID>"
$env:RLS_DISPOSABLE_CATEGORY_ID = "<active disposable category UUID with no mappings>"
npm run test:rls
```

The positive booking test intentionally leaves its test booking in the database
because ordinary clients/providers have no booking delete policy. An
unexpectedly successful unauthorized insert or delete may also need trusted
admin cleanup. Do not enable these gates against production or sample data.
Unset them after testing with `Remove-Item Env:RLS_ALLOW_MUTATING_TESTS`,
`Remove-Item Env:RLS_ALLOW_RISKY_TESTS`, and the corresponding remaining
`RLS_*` variables.

This repository does not yet include a booking API route. The database policy
protects direct authenticated Supabase operations, but the assignment's API
surface for creating or listing bookings remains unspecified.
