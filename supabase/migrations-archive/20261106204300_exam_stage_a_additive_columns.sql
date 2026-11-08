-- Stage A: add nullable exam compatibility columns without backfilling data
-- or changing existing policies, grants, triggers, functions, or foreign keys.

BEGIN;

ALTER TABLE public.service_categories
  ADD COLUMN active_status boolean;

ALTER TABLE public.services
  ADD COLUMN title text,
  ADD COLUMN hourly_rate numeric(10, 2),
  ADD COLUMN duration_minutes integer,
  ADD COLUMN coverage_radius_miles integer;

ALTER TABLE public.bookings
  ADD COLUMN client_email text,
  ADD COLUMN requested_date date,
  ADD COLUMN notes text,
  ALTER COLUMN client_id DROP NOT NULL;

COMMIT;
