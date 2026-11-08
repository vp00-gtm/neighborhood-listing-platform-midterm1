# CIS 3610 Midterm Version B — requirements and traceability

## Scope and evidence

This document follows the student's supplied examination: Local Merchant Services
and Client Appointment Bookings. Acceptance criteria below are requirements;
verification status is explicitly distinguished from intended behavior.

The student reports applying the original three migrations and the alignment
migration. The latest production read-only audit passed 20 checks. Local unit
tests and isolated PostgreSQL write tests are separate evidence; see
[security audit](security-audit.md). Deployment and Canvas submission are not
claimed complete.

## Story S1 — authenticated service provider / merchant

**Size: Medium.** As an authenticated local service provider, I want to submit
service listing drafts with hourly rates so that residents can book appointments
after administrator approval.

The exam's merchant/provider business persona is implemented by the trusted
`profiles.role = 'provider'` authorization role. The distinct enum value
`merchant` does not automatically grant provider permissions.

| ID | Given | When | Then |
| --- | --- | --- | --- |
| S1-1 | An authenticated user whose profile role is provider | They POST a valid service payload | HTTP 201 returns the persisted service; provider_id comes from the verified user and status defaults to draft |
| S1-2 | A payload with a title shorter than 5 trimmed characters, negative rate, duration below 15/non-integer, nonpositive radius, or unrecognized fields | It is submitted to POST /api/services | HTTP 400 returns structured field issues and no service is inserted |
| S1-3 | A browser-supplied provider_id, role or status | It is submitted as an extra field | Strict validation rejects it; the browser cannot choose ownership or approval |
| S1-4 | An unauthenticated user or a non-provider profile | They attempt creation | Access is denied without database writes |
| S1-5 | Provider A owns a draft/suspended listing | A updates or deletes it | The operation is permitted under the authenticated session and ownership/status RLS |
| S1-6 | Provider A targets Provider B's listing or A's approved listing | A attempts an ordinary edit/delete | The operation is denied and the target remains unchanged |
| S1-7 | An owned draft | Its provider submits it for review | Status changes to pending; the provider cannot approve it |
| S1-8 | Optional active category IDs | A provider creates a service with them | Relationships use the mapping table; nonexistent/inactive categories are rejected before creation |

## Story S2 — neighborhood client / resident

**Size: Medium.** As a neighborhood resident, I want to browse approved services
with active category/coverage information and request an appointment without
seeing bookings or contact information submitted by other clients.

| ID | Given | When | Then |
| --- | --- | --- | --- |
| S2-1 | An anonymous visitor and existing approved/private service controls | They request GET /api/services | Only approved services and public fields are returned; no provider profile or account information is exposed |
| S2-2 | Active and inactive categories | The visitor requests categories or views service categories | Only active category information is returned/displayed |
| S2-3 | An approved service and a valid email, real calendar date, and notes of at least 10 trimmed characters | A visitor/client submits a booking | The booking is persisted and a generic success message is returned without exposing the stored booking record |
| S2-4 | Invalid email/date, short notes, or extra booking fields | A booking is submitted | Validation rejects the request before persistence |
| S2-5 | Existing bookings and an anonymous/client session | They attempt SELECT on bookings | Permission is denied or no rows are returned, even when bookings exist |
| S2-6 | Mobile/tablet/desktop viewports and a keyboard user | They browse cards and open the booking form | Cards render in 1/2/3 columns; named buttons and labeled inputs have visible focus; Tab, Shift+Tab, Enter and Space operate the controls |
| S2-7 | A pending request, empty result, failed response or stalled request | The explorer loads services | A loading, empty, error or bounded timeout state is shown, with an accessible retry control |

**Coverage interpretation:** The prescribed schema supplies categories,
active_status and a numeric coverage radius; it defines no district/zone entity
or geographic lookup. This slice displays active category labels and service
radii. It does not claim district filtering. Approved services without active
category mappings remain visible, matching Part 5's approved-service query.
The broader story wording about active neighborhood districts is not evidence
that geographic filtering has been implemented.

## Story S3 — platform administrator

**Size: Large.** As a platform administrator, I want oversight to approve service
listings, suspend offending listings, and audit client bookings.

| ID | Given | When | Then |
| --- | --- | --- | --- |
| S3-1 | An authenticated admin and a pending service | The admin reviews it as approved | The service becomes approved and can appear in public service results |
| S3-2 | An authenticated admin and a pending or approved service | The admin suspends it | Status becomes suspended and public service queries exclude it |
| S3-3 | A provider/client/anonymous caller | They attempt administrator review | The API and database deny the action |
| S3-4 | Existing bookings associated with multiple providers | An admin queries bookings | Admin can read all controls; each provider can read only bookings for their own services |
| S3-5 | A verified administrator operating through authorized elevated server execution | Administrative writes are performed | Application tables can be administered without exposing service credentials to browsers |
| S3-6 | Existing historical records and the reviewed alignment migration | Schema deletion rules are aligned | Existing IDs/data are preserved; future provider deletion is restricted, category deletion cascades mappings, and service deletion cascades bookings |

Suspending listings implements the bad-actor moderation action in this slice.
An Auth-account banning interface is not implemented or claimed. A complete
login/admin dashboard is not a separate required UI deliverable in the supplied
rubric; authenticated sessions are still required to exercise protected routes.

## Direct traceability

| Story | Database migration / roles | Route handlers | UI / local checks |
| --- | --- | --- | --- |
| S1 | [Required migration](../supabase/migrations/20261029140000_exam_services_persistence.sql), [alignment](../supabase/migrations/20261107000000_exam_schema_alignment.sql); provider ownership and draft/suspended policies | [Create/list services](../src/app/api/services/route.ts), [edit/delete](../src/app/api/services/[id]/route.ts), [submit](../src/app/api/services/[id]/submit/route.ts), [categories](../src/app/api/service-categories/route.ts) | [Strict schema](../src/schemas/service.ts), [provider form](../src/components/ProviderServiceForm.tsx), [API tests](../tests/services-api.test.mjs), [PATCH tests](../tests/service-patch.test.mjs) |
| S2 | [Required migration](../supabase/migrations/20261029140000_exam_services_persistence.sql), [alignment](../supabase/migrations/20261107000000_exam_schema_alignment.sql); public approved reads, client booking-read denial | [Public services](../src/app/api/services/route.ts), [categories](../src/app/api/service-categories/route.ts), [bookings](../src/app/api/bookings/route.ts) | [Explorer](../src/components/ServicesExplorer.tsx), [card](../src/components/ServiceCard.tsx), [booking form](../src/components/BookingForm.tsx), [explorer tests](../tests/services-explorer.test.mjs), [card tests](../tests/service-card.test.mjs) |
| S3 | [Required migration](../supabase/migrations/20261029140000_exam_services_persistence.sql), [alignment](../supabase/migrations/20261107000000_exam_schema_alignment.sql); admin review, provider ownership, elevated administration | [Admin review](../src/app/api/services/[id]/review/route.ts), [booking reads](../src/app/api/bookings/route.ts) | [Production read-only runner](../scripts/rls-readonly-tests.mjs), [isolated SQL runner](../scripts/rls-isolated-tests.mjs), [audit evidence](security-audit.md) |

## Contracts, authentication and preservation

- The canonical strict validation rules are reused through
  `src/schemas/service.ts`; explicitly supported optional category IDs do not
  permit arbitrary extra properties.
- GET services uses a server-only privileged client with an explicit public
  projection and approved filter. It also includes public descriptions,
  timestamps and active category metadata needed by the existing UI.
- POST services validates first, verifies cookie-backed identity/profile role,
  and inserts using the provider's session. The database draft default is used;
  providers are not granted INSERT access to status.
- Privileged keys stay in `src/lib/supabaseServer.ts`, guarded by server-only.
  No account credentials belong in documentation or browser bundles.
- Legacy names, prices, currencies, descriptions, is_active values, identifiers,
  booking references and timestamps are retained by the additive upgrade.
  Missing booking emails use the linked auth.users.email source, never
  profiles.email. Existing booking contact values are not replaced.
- Do not rerun applied backfills. The later alignment migration preserves rows
  while changing future deletion behavior and exact exam checks/defaults.
- Actual live migration-history state, test outcomes and remaining limitations
  belong in the audit and [submission checklist](submission-checklist.md).
