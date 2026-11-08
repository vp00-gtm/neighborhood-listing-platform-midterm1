# Local Services & Bookings — Security Status

## Scope and status

This document records the intended local SQL/API security design. The
migration and application code are not proof that the live Supabase project has
been updated. Do not describe remote schema, grants, or policies as deployed
until separately inspected and approved.

The local RLS integration runner is `scripts/rls-tests.mjs`. It requires
dedicated test accounts and project configuration and was not run during local
implementation. Its table checks are read-only, but it signs in to the
configured accounts; use dedicated test accounts and a non-production project.

## Authorization model

- Only `profiles.role` values `admin`, `merchant`, `provider`, and `client`
  are valid. The SQL migration assigns existing roles from the student's
  approved mapping. Ordinary users receive no profile write privilege and
  cannot set their own role.
- `current_profile_has_role(text)` is a fixed-search-path, security-definer
  helper that checks only the current authenticated profile. Execute is
  granted to authenticated users, not anonymous users.
- The application uses a request-scoped anon client. It contains no
  service-role key and does not rely on service-role RLS bypass.
- Providers do not receive the public approved-service SELECT policy;
  authenticated non-provider users and anonymous visitors can browse approved
  services.
- Explicit table grants are paired with RLS. Existing policies on the five
  subsystem tables are replaced because permissive policies combine with OR.

## Services and categories

- Anonymous users can select approved services, active categories, and
  mappings whose service is approved.
- Providers can select and manage their own services. Insert is draft-only;
  ordinary edits/deletes are limited to draft or suspended services.
- A separate provider update policy permits only the draft-to-pending review
  submission transition. It does not permit provider approval.
- Admin review permits pending-to-approved/suspended transitions;
  administrators can read and update services for review.
- Categories have public select only when `active_status` is true.

## Bookings

- Anonymous and authenticated users can insert only the official booking
  fields, and only for an approved service. The nullable legacy `client_id`,
  timestamp, and notes columns are not accepted from the request.
- The insert policy checks approval through a security-definer helper in the
  non-public `private` schema so an authenticated provider does not need
  broader service SELECT access to submit a booking.
- No anonymous booking SELECT grant or policy exists.
- Authenticated booking SELECT is limited by RLS to admins and providers who
  own the associated service. Client role alone grants no read access.
- Booking UPDATE and DELETE are not granted.
- The booking API returns a generic success message rather than the stored
  row.

## Migration review risks

- The required migration's filename predates the two active baseline versions.
  The local baselines are now no-op placeholders, but remote migration history
  remains unknown. Review the remote ledger before any execution.
- The schema migration uses approved fixture IDs and maps. It intentionally
  raises an exception if nonempty data differs from the reviewed rows.
- Existing legacy columns are preserved. Required foreign-key delete actions
  are updated to the exam's required behavior; cascades may affect future
  deletes, so test these actions on disposable data.
- The requested UTC default expression is used exactly as supplied. Verify
  timestamp behavior in the target PostgreSQL environment before a live run.

## Required isolated verification

Before any live execution, test the migration and RLS behavior in a disposable
database: public reads, provider ownership and draft submission, provider
denial of approval, admin review, guest/authenticated booking insertion,
client booking-read denial, provider/admin booking reads, FK delete actions,
and grant boundaries. Record actual test outcomes separately from expected
behavior.
