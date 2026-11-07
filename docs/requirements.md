# CIS 3610 Midterm Version B — Local Services & Bookings

## Scope and implementation status

This document records the assignment context, the confirmed target for the
Local Services & Bookings subsystem, and the current implementation status.
The status labels below distinguish plans from verified behavior:

- **Planned** — confirmed target behavior that has not been implemented.
- **Implemented, unverified** — code or SQL exists locally, but the behavior
  has not been confirmed against the target or a live database.
- **Tested** — a named test actually ran in an identified isolated environment
  and observed the stated outcome.
- **Not run/Blocked** — a test did not run; its prerequisite is stated.

The existing application contains a services `GET` and `POST` route at
`src/app/api/services/route.ts`. The current `GET` selects approved services
and public fields. The current `POST` validates the legacy service fields,
requires an authenticated user and profile, assigns the provider ID from the
session, and creates a draft. It does not yet enforce the confirmed provider
role or validate the exam-specific service fields. Its target behavior is
therefore **planned**, and current live database behavior is **unverified**.

The current UI remains focused on property listings and public service
browsing. There is no service-management form, booking form, booking API, or
service-update API in the repository. The assignment's API description names
only `src/app/api/services/route.ts` with `GET` and `POST`. A controlled
server-side booking API is an approved project direction, not a claim that the
assignment explicitly requires that endpoint.

The repository's original SQL files are currently in
`supabase/migrations-archive/`; the active `supabase/migrations/` directory was
empty at the last inspection. Their presence in the archive does not establish
that they are active, match the current live database, or have been applied.
A local schema-only export was created for review, but it has not yet been
reconciled with the remote migration history or independently verified as the
current live database state. The live schema, grants, RLS policies, and
migration history remain **unverified** until checked through an authorized,
read-only review.

## Confirmed data and role decisions

The database currently uses legacy service fields `name` and `price_amount`.
The exam fields `title` and `hourly_rate` are separate values during the
transition. New service submissions must provide both field sets; neither
field set is automatically copied from or substituted for the other. Existing
columns, records, and relationships are preserved. No backfill or rename is
planned.

The exam profile roles are exactly `admin`, `merchant`, `provider`, and
`client`, with one role per profile. Existing profiles are not assigned roles
automatically. The first admin role is assigned through a trusted manual
administrative process. Ordinary users cannot change their own role. Only
profiles with the `provider` role may create services; merchants do not
inherit provider permissions.

The exam service-submission validations are:

- Legacy `name`: trimmed, 1–120 characters.
- Legacy `description`: trimmed, 1–5,000 characters.
- Legacy `price_amount`: finite and nonnegative, retaining the existing
  database/API maximum where applicable.
- `currency`: three uppercase letters; the current API defaults it to `USD`.
- Exam `title`: trimmed, at least 5 characters.
- Exam `hourly_rate`: finite numeric value, nonnegative.
- Exam `duration_minutes`: integer of at least 15.
- Exam `coverage_radius_miles`: positive integer.

The server sets `provider_id` from the authenticated session and `status` to
`draft`; neither value is accepted from a service request.

For bookings, both guests and authenticated clients may submit requests for
approved services. Guest rows have `client_id = NULL`; authenticated-client
rows use the authenticated user's ID and require that profile's role to be
`client`. Both `requested_date` and `scheduled_at` are validated
independently. `scheduled_at` remains required; no timestamp is derived from
the requested date, and no date/timezone relationship is assumed. The API
writes the exam `notes` field. The existing `client_notes` field remains
separate; values are not copied or backfilled.

Neither guests nor clients may directly select booking records. Providers may
read bookings associated with their own services, and administrators may read
bookings for auditing. No booking update or delete permission is included in
the target.

## Story 1 — Browse approved neighborhood services

**User story:** As a neighborhood visitor, I want to browse approved
neighborhood services and active service categories so that I can discover
services available in my area.

**Acceptance criteria:**

- Visitors can retrieve only approved services and appropriate public fields.
- Visitors can retrieve only active categories and mappings for approved
  services.
- Draft, suspended, or otherwise unapproved services and their mappings are
  not publicly visible.
- Until a safe transition is separately approved, category activity continues
  to use the existing `is_active` field. The new `active_status` field is not
  treated as populated or authoritative, and no values are copied.

**Status:** The existing GET route selects approved services and a public
field list (**implemented, unverified**). Public category and mapping behavior
is defined in archived SQL but must be checked against the live policies
before it is called deployed or tested.

**Traceability:** The original persistence and RLS SQL are retained under
`supabase/migrations-archive/`. The provider-owned mapping-read addition is
also archived. Archived files are not proof of remote application.

## Story 2 — Providers create and manage their own services

**User story:** As a user with the provider role, I want to create and manage
my own services so that I can maintain the services I offer.

**Creation acceptance criteria:**

- The authenticated user's profile has the `provider` role.
- A new submission provides both the legacy database fields (`name`,
  `description`, `price_amount`, and `currency`) and the separate exam fields
  (`title`, `hourly_rate`, `duration_minutes`, and `coverage_radius_miles`).
- The service fields satisfy the validations listed above.
- The server assigns `provider_id` from the authenticated user and sets
  `status` to `draft`; the request cannot choose either value.
- Existing records and old columns remain intact. No semantic equivalence,
  field mapping, or backfill is assumed.

**Ownership acceptance criteria:** A provider may manage only services owned
by that provider and eligible for provider changes. A provider cannot change
ownership or approve their own service. No service-update API is currently
defined or implemented.

**Status:** The existing POST route creates drafts for an authenticated user
with a profile using the legacy fields (**implemented, unverified**). The
provider-role check and exam-field validation are **planned**, not implemented
or tested.

**Traceability:** The current API is `src/app/api/services/route.ts`. The
assignment's stated service API includes GET and POST; it does not specify an
update method or handler.

## Story 3 — Guests and clients submit bookings

**User story:** As a visitor or client, I want to request an approved
neighborhood service. Providers need to see bookings associated with their
services, and administrators need read access to audit bookings.

**Insert acceptance criteria:**

- A guest may submit a booking only for an approved service. The stored
  `client_id` is `NULL`.
- An authenticated client may submit a booking only for an approved service.
  The server derives `client_id` from the authenticated session, and the
  profile must have role `client`.
- The request cannot supply or override `client_id`.
- The API validates `client_email` as an email, `requested_date` as a
  calendar date, `scheduled_at` as a valid timestamp, and trimmed `notes` as
  at least 10 characters.
- `scheduled_at` is required. `requested_date` and `scheduled_at` are
  validated independently; the API does not derive one from the other or
  assume a timezone relationship.
- New booking requests write to `notes`. The existing `client_notes` column
  remains separate and is not copied or backfilled.
- The controlled server-side endpoint uses a non-privileged Supabase client
  so database RLS remains enforced. It returns a generic confirmation, not a
  booking record.
- Rate limiting or other abuse controls should be applied at the application
  or hosting layer where available. No external service is assumed or added
  without approval.

**Read acceptance criteria:**

- Guests and clients have no direct SELECT access to booking rows.
- Providers may read bookings only for services they own.
- Administrators may read bookings for auditing.
- No booking UPDATE or DELETE permission is included in the target.

**Status:** No booking API or booking form currently exists. The controlled
booking endpoint and its RLS support are **planned**, not implemented or
tested. The assignment's existing API description does not specify a booking
endpoint; this is an approved project implementation direction.

**Traceability:** The archived persistence SQL defines bookings and their
existing relationships. The archived RLS SQL describes prior booking
policies, including client reads; those policies do not satisfy the confirmed
target without review and replacement.

## Documentation and verification notes

Keep these states distinct:

1. A migration file exists locally.
2. A migration version is recorded in the remote migration ledger.
3. Migration SQL was executed against a database.
4. An API or policy behavior was tested in a named environment.

None of these states alone proves the others. Record a behavior as **tested**
only after the test actually runs and observes the expected result in an
identified isolated environment. Use **not run/blocked** for cases that did
not execute, with the reason. Do not describe the proposed APIs, migrations,
or RLS policies as implemented or tested before that evidence exists.
