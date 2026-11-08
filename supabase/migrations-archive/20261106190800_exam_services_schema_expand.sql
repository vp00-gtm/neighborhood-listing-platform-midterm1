-- Stage A: add the exam service and booking fields while preserving legacy
-- columns and values. This migration does not change RLS or assign profile
-- roles/statuses.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN role text,
  ADD COLUMN active_status boolean;

ALTER TABLE public.service_categories
  ADD COLUMN active_status boolean;

UPDATE public.service_categories
SET active_status = is_active;

ALTER TABLE public.services
  ADD COLUMN title text,
  ADD COLUMN hourly_rate numeric(10, 2),
  ADD COLUMN duration_minutes integer,
  ADD COLUMN coverage_radius_miles integer;

UPDATE public.services
SET title = name;

ALTER TABLE public.bookings
  ADD COLUMN client_email text,
  ADD COLUMN requested_date date,
  ADD COLUMN notes text;

UPDATE public.bookings
SET notes = client_notes;

ALTER TABLE public.bookings
  ALTER COLUMN client_id DROP NOT NULL;

COMMIT;
