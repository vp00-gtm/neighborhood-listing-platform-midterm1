# CIS 3610 Midterm Version B — Requirements

## Scope and implementation status

These stories describe the Local Services & Bookings subsystem required for the
midterm. The repository contains the schema and RLS migrations listed below.
The services API `GET` and `POST` handlers are implemented, but have not been
verified against a live Supabase database. The application UI remains focused
on property listings; service-management and booking UI are not implemented.
No booking API handler or service-update handler is defined by the assignment.

The schema is defined in
`supabase/migrations/20261029140000_exam_services_persistence.sql`; row-level
access is defined in
`supabase/migrations/20261106092700_exam_services_rls.sql`, with the provider
mapping-read addition in
`supabase/migrations/20261106152900_exam_provider_mapping_read.sql`. The
assignment's API requirements explicitly define only
`src/app/api/services/route.ts` with `GET` and `POST`. Migration files being
present in the repository does not establish that they have been applied to a
live database.

## Story 1 — Browse approved neighborhood services

**User story:** As a neighborhood visitor, I want to browse approved
neighborhood services and active service categories so that I can discover
services available in my area.

**Acceptance criteria:**

- **Given** a visitor opens the services listing, **when** approved services
  are requested, **then** the response contains only services approved for
  public viewing and only appropriate public service fields.
- **Given** active service categories and category mappings exist, **when** a
  visitor views service categories, **then** only active categories and
  mappings associated with publicly approved services are visible.
- **Given** a service is a draft, suspended, or otherwise not approved,
  **when** a visitor requests the public listing, **then** that service is not
  returned.

**Size:** Small

**Traceability:**

- **Database migration:** `supabase/migrations/20261029140000_exam_services_persistence.sql`
  (services, service categories, and category mappings); public visibility is
  enforced by
  `supabase/migrations/20261106092700_exam_services_rls.sql`.
- **API route handler:** `src/app/api/services/route.ts` — implemented `GET`
  returns approved services with public fields and visible active-category
  mappings. Live database behavior remains unverified.

## Story 2 — Providers create and manage their own services

**User story:** As a service provider, I want to create and manage my own
services so that I can maintain the services I offer to my neighborhood.

**Acceptance criteria:**

- **Given** an authenticated provider submits valid service details, **when**
  the service is created, **then** the server associates it with the
  authenticated provider rather than trusting a provider ID from the request.
- **Given** a provider owns a service, **when** that provider updates the
  service through an authorized operation, **then** the change is permitted
  only for that provider's service.
- **Given** a provider attempts to update another provider's service, **when**
  the change is authorized, **then** it is denied and the other provider's
  service remains unchanged.

**Size:** Medium

**Traceability:**

- **Database migration:** `supabase/migrations/20261029140000_exam_services_persistence.sql`
  (provider-to-service relationship), with provider ownership enforced by
  `supabase/migrations/20261106092700_exam_services_rls.sql`.
- **API route handler:** `src/app/api/services/route.ts` — implemented `POST`
  validates service fields and creates a draft for the authenticated user.
  Provider service updates are not implemented; the assignment does not
  specify their API method or handler.

## Story 3 — Clients book services and view associated bookings

**User story:** As a client, I want to book a neighborhood service and view
bookings associated with me, so that I can request services and review my
bookings.

**Acceptance criteria:**

- **Given** a client submits a booking for a service, **when** the booking is
  accepted under the configured booking-insert policy, **then** it is stored
  with the associated service and client.
- **Given** a client or provider is associated with a booking, **when** that
  authorized user requests the booking, **then** the booking is visible to
  that user.
- **Given** a user is not the booking's client or the provider associated with
  its service, **when** that user requests the booking, **then** access is
  denied.

**Size:** Medium

**Traceability:**

- **Database migration:** `supabase/migrations/20261029140000_exam_services_persistence.sql`
  (bookings and their client/service relationships; row-level security limits
  booking reads to the associated client or provider in
  `supabase/migrations/20261106092700_exam_services_rls.sql`).
- **API route handlers:** The assignment's API requirements specify only
  `src/app/api/services/route.ts` (`GET` and `POST`); they do not specify a
  booking handler. A booking create/read handler is not currently defined, so
  the API surface for these operations must be clarified before treating them
  as implemented. Database access must still enforce the stated booking
  authorization rules.

## Traceability note

The assignment requires database persistence and booking authorization, but
its API section names only the services `GET` and `POST` methods. This document
does not assume service-update or booking endpoints exist. Service creation
requires an existing profile for the authenticated Supabase user. The services
route uses the configured Supabase URL and anon key, relies on the user's
cookie-backed session and database RLS, and must still be exercised against an
approved Supabase setup before its live behavior is confirmed.
