# CIS 3610 Midterm Version B — Local Services & Bookings

## Status and source of truth

The official assignment details supplied by the student take precedence over
older project notes. This file describes the local implementation target; it
does not claim that a migration has run against Supabase.

The local required migration is
`supabase/migrations/20261029140000_exam_services_persistence.sql`. The two
later baseline migration files are retained as no-op version placeholders so
they do not recreate tables after the reconciliation migration. No remote
migration history was inspected or changed.

## Schema and approved existing data

- Profiles use one role from `admin`, `merchant`, `provider`, or `client`.
  The approved existing assignments are one admin, two providers, and two
  clients. No merchant is assigned. Ordinary users cannot set their own role.
- Categories retain legacy columns and map `is_active` to
  `active_status`.
- Services retain `name`, `price_amount`, and other legacy columns. Existing
  `name` maps to the approved `title`; `price_amount` is not a source for
  `hourly_rate`. The four reviewed rates, durations, radii, and statuses are
  encoded in the migration.
- Bookings use the exam fields `service_id`, `client_email`, `requested_date`,
  `notes`, and `created_at`. Existing notes and requested dates are copied
  only using the student-approved mappings. The requested date is the UTC
  calendar date from `scheduled_at`; the original timestamp is retained.
  `client_id`, `scheduled_at`, and `client_notes` remain nullable/legacy
  columns so existing client relationships and booking information survive.
- New service submissions provide `title`, `hourly_rate`, `duration_minutes`,
  and `coverage_radius_miles`. A provider may optionally assign active
  categories through the mapping table. The server sets provider ownership
  and draft status.
- New booking submissions use only the official booking fields. The legacy
  `client_id` is not accepted from the request and remains null for new rows.

The migration aborts if nonempty profile, service, or booking data does not
match the approved mapping set. This avoids assigning fabricated values or
enforcing `NOT NULL` over unreviewed records.

## Workflow

1. A provider creates a draft service.
2. The owning provider can edit/delete only their own draft or suspended
   services.
3. The provider can submit a draft to `pending`.
4. An administrator may review a pending service as `approved` or
   `suspended`.
5. Providers cannot approve services. Admin authorization is based on the
   trusted `profiles.role` value.

## Booking behavior

- Public visitors and authenticated users can insert a booking for an
  approved service.
- The server validates the exact email pattern
  `^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$`, a real calendar date,
  and notes of at least ten trimmed characters.
- The API returns a generic confirmation and does not return the booking row.
- Only administrators and the provider who owns the associated service can
  read bookings. Clients and anonymous visitors cannot select bookings.

## Application routes

- `GET /api/services`: approved public services and active-category mappings.
- `GET /api/service-categories`: active categories for provider forms.
- `POST /api/services`: provider-only draft creation.
- `PATCH` and `DELETE /api/services/[id]`: provider-owned draft/suspended
  service changes.
- `POST /api/services/[id]/submit`: provider draft submission to review.
- `PATCH /api/services/[id]/review`: administrator approval or suspension of
  pending services.
- `GET /api/bookings`: administrator/provider reads, further restricted by
  RLS.
- `POST /api/bookings`: public/authenticated booking insertion.

All Supabase requests use the request-scoped anon client. The application does
not use service-role credentials.

## Verification state

Local validation tests, lint, type-check, and build are separate from database
verification. The integration RLS runner uses accounts and project settings
from its environment and must only be run against an isolated test project.
No live database command is part of local verification.
