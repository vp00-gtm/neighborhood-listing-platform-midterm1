-- CIS 3610 Midterm Version B schema and security reconciliation.
-- Preserves legacy columns and existing row identifiers while adding the
-- required exam fields. This migration is local source only until explicitly
-- reviewed and applied to a database.

BEGIN;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE IF NOT EXISTS public.service_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  active_status boolean NOT NULL DEFAULT true,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT service_categories_name_key UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  title text NOT NULL,
  hourly_rate numeric(10, 2) NOT NULL,
  duration_minutes integer NOT NULL,
  coverage_radius_miles integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  name text,
  description text,
  price_amount numeric(10, 2),
  currency text NOT NULL DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE IF NOT EXISTS public.service_category_mappings (
  service_id uuid NOT NULL REFERENCES public.services (id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.service_categories (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (service_id, category_id)
);

CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES public.services (id) ON DELETE RESTRICT,
  client_email text NOT NULL,
  requested_date date NOT NULL,
  notes text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  client_id uuid REFERENCES public.profiles (id) ON DELETE CASCADE,
  scheduled_at timestamptz,
  client_notes text,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text;

ALTER TABLE public.service_categories
  ADD COLUMN IF NOT EXISTS active_status boolean DEFAULT true;

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS hourly_rate numeric(10, 2),
  ADD COLUMN IF NOT EXISTS duration_minutes integer,
  ADD COLUMN IF NOT EXISTS coverage_radius_miles integer;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS client_email text,
  ADD COLUMN IF NOT EXISTS requested_date date,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.services
  ALTER COLUMN name DROP NOT NULL,
  ALTER COLUMN description DROP NOT NULL,
  ALTER COLUMN price_amount DROP NOT NULL;

ALTER TABLE public.bookings
  ALTER COLUMN client_id DROP NOT NULL,
  ALTER COLUMN scheduled_at DROP NOT NULL;

DO $disable_update_triggers$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'profiles_set_updated_at' AND NOT tgisinternal) THEN
    ALTER TABLE public.profiles DISABLE TRIGGER profiles_set_updated_at;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.service_categories'::regclass AND tgname = 'service_categories_set_updated_at' AND NOT tgisinternal) THEN
    ALTER TABLE public.service_categories DISABLE TRIGGER service_categories_set_updated_at;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.services'::regclass AND tgname = 'services_set_updated_at' AND NOT tgisinternal) THEN
    ALTER TABLE public.services DISABLE TRIGGER services_set_updated_at;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.bookings'::regclass AND tgname = 'bookings_set_updated_at' AND NOT tgisinternal) THEN
    ALTER TABLE public.bookings DISABLE TRIGGER bookings_set_updated_at;
  END IF;
END;
$disable_update_triggers$;

DO $preflight$
DECLARE
  profile_count bigint;
  mapped_profile_count bigint;
  service_count bigint;
BEGIN
  SELECT count(*) INTO profile_count FROM public.profiles;
  IF profile_count > 0 THEN
    SELECT count(*) INTO mapped_profile_count
    FROM public.profiles
    WHERE id IN (
      '1fbdbbfb-33d8-4dbe-af0c-55b5b57e97c0'::uuid,
      '46e4e555-f621-4c9d-bbff-fb07de4cc2e0'::uuid,
      '6d963fc7-8a0e-443c-a01c-b68ef42cc2f4'::uuid,
      'a9658e7b-ec7a-4984-bbfb-fe973ebe0476'::uuid,
      'efaf1676-705e-412d-9280-7183714e1817'::uuid
    );
    IF mapped_profile_count <> 5 THEN
      RAISE EXCEPTION 'Expected all five approved profile IDs before applying role assignments';
    END IF;

    UPDATE public.profiles
    SET role = CASE id
      WHEN '1fbdbbfb-33d8-4dbe-af0c-55b5b57e97c0'::uuid THEN 'admin'
      WHEN '46e4e555-f621-4c9d-bbff-fb07de4cc2e0'::uuid THEN 'provider'
      WHEN '6d963fc7-8a0e-443c-a01c-b68ef42cc2f4'::uuid THEN 'client'
      WHEN 'a9658e7b-ec7a-4984-bbfb-fe973ebe0476'::uuid THEN 'provider'
      WHEN 'efaf1676-705e-412d-9280-7183714e1817'::uuid THEN 'client'
      ELSE role
    END;

    IF EXISTS (SELECT 1 FROM public.profiles WHERE role IS NULL) THEN
      RAISE EXCEPTION 'Every existing profile needs an approved role before role can be NOT NULL';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.service_categories
    WHERE is_active IS NULL
  ) THEN
    RAISE EXCEPTION 'A category has no legacy is_active value to map';
  END IF;
  UPDATE public.service_categories SET active_status = is_active;

  SELECT count(*) INTO service_count FROM public.services;
  IF service_count > 0 THEN
    IF service_count <> 4 OR (
      SELECT count(DISTINCT name)
      FROM public.services
      WHERE name IN (
        'House Cleaning',
        'Garden Maintenance',
        'Plumbing Repair',
        'Painting Service'
      )
    ) <> 4 THEN
      RAISE EXCEPTION 'Service data differs from the four reviewed sample records; review before migration';
    END IF;

    UPDATE public.services
    SET
      title = name,
      hourly_rate = CASE name
        WHEN 'House Cleaning' THEN 35.00
        WHEN 'Garden Maintenance' THEN 40.00
        WHEN 'Plumbing Repair' THEN 75.00
        WHEN 'Painting Service' THEN 45.00
      END,
      duration_minutes = CASE name
        WHEN 'House Cleaning' THEN 120
        WHEN 'Garden Maintenance' THEN 120
        WHEN 'Plumbing Repair' THEN 90
        WHEN 'Painting Service' THEN 180
      END,
      coverage_radius_miles = CASE name
        WHEN 'House Cleaning' THEN 15
        WHEN 'Garden Maintenance' THEN 20
        WHEN 'Plumbing Repair' THEN 20
        WHEN 'Painting Service' THEN 15
      END;
  END IF;

  -- The approved email source is auth.users, not profiles (which has no
  -- email column). Populate only absent emails; never replace an existing
  -- booking contact or create a placeholder when the account has no email.
  UPDATE public.bookings AS booking
  SET client_email = account.email
  FROM auth.users AS account
  WHERE booking.client_email IS NULL
    AND account.id = booking.client_id;

  -- Preserve historical values. Only fill missing exam fields from the
  -- approved legacy sources; retain the original timestamp and client notes.
  UPDATE public.bookings
  SET
    requested_date = COALESCE(requested_date, (scheduled_at AT TIME ZONE 'UTC')::date),
    notes = COALESCE(notes, client_notes)
  WHERE requested_date IS NULL OR notes IS NULL;

  -- Keep the official NOT NULL/check constraints without fabricating data or
  -- silently normalizing historical values. Abort this transaction for review
  -- if authoritative booking information is missing or incompatible.
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE client_email IS NULL
       OR client_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
  ) THEN
    RAISE EXCEPTION 'Historical bookings require valid existing client_email or auth.users.email values; review missing/invalid contacts without placeholders';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bookings WHERE requested_date IS NULL) THEN
    RAISE EXCEPTION 'Historical bookings lack requested_date and scheduled_at; review authoritative dates before migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE notes IS NULL OR char_length(btrim(notes)) < 10
  ) THEN
    RAISE EXCEPTION 'Historical booking notes do not meet the required ten-character minimum; review before migration without replacing original notes';
  END IF;
END;
$preflight$;

DO $enable_update_triggers$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'profiles_set_updated_at' AND NOT tgisinternal) THEN
    ALTER TABLE public.profiles ENABLE TRIGGER profiles_set_updated_at;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.service_categories'::regclass AND tgname = 'service_categories_set_updated_at' AND NOT tgisinternal) THEN
    ALTER TABLE public.service_categories ENABLE TRIGGER service_categories_set_updated_at;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.services'::regclass AND tgname = 'services_set_updated_at' AND NOT tgisinternal) THEN
    ALTER TABLE public.services ENABLE TRIGGER services_set_updated_at;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.bookings'::regclass AND tgname = 'bookings_set_updated_at' AND NOT tgisinternal) THEN
    ALTER TABLE public.bookings ENABLE TRIGGER bookings_set_updated_at;
  END IF;
END;
$enable_update_triggers$;

ALTER TABLE public.profiles
  ALTER COLUMN role SET NOT NULL,
  DROP CONSTRAINT IF EXISTS profiles_role_check,
  ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('admin', 'merchant', 'provider', 'client'));

ALTER TABLE public.service_categories
  ALTER COLUMN active_status SET DEFAULT true,
  ALTER COLUMN active_status SET NOT NULL,
  DROP CONSTRAINT IF EXISTS service_categories_name_check,
  ADD CONSTRAINT service_categories_name_check
    CHECK (char_length(btrim(name)) >= 3);

ALTER TABLE public.services
  ALTER COLUMN title SET NOT NULL,
  ALTER COLUMN hourly_rate SET NOT NULL,
  ALTER COLUMN duration_minutes SET NOT NULL,
  ALTER COLUMN coverage_radius_miles SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'draft',
  DROP CONSTRAINT IF EXISTS services_title_check,
  DROP CONSTRAINT IF EXISTS services_hourly_rate_check,
  DROP CONSTRAINT IF EXISTS services_duration_minutes_check,
  DROP CONSTRAINT IF EXISTS services_coverage_radius_miles_check,
  DROP CONSTRAINT IF EXISTS services_status_check,
  ADD CONSTRAINT services_title_check
    CHECK (char_length(btrim(title)) >= 5),
  ADD CONSTRAINT services_hourly_rate_check
    CHECK (hourly_rate >= 0),
  ADD CONSTRAINT services_duration_minutes_check
    CHECK (duration_minutes >= 15),
  ADD CONSTRAINT services_coverage_radius_miles_check
    CHECK (coverage_radius_miles > 0),
  ADD CONSTRAINT services_status_check
    CHECK (status IN ('draft', 'pending', 'approved', 'suspended'));

ALTER TABLE public.bookings
  ALTER COLUMN client_email SET NOT NULL,
  ALTER COLUMN requested_date SET NOT NULL,
  ALTER COLUMN notes SET NOT NULL,
  DROP CONSTRAINT IF EXISTS bookings_client_email_check,
  DROP CONSTRAINT IF EXISTS bookings_requested_date_check,
  DROP CONSTRAINT IF EXISTS bookings_notes_check,
  ADD CONSTRAINT bookings_client_email_check
    CHECK (client_email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  ADD CONSTRAINT bookings_notes_check
    CHECK (char_length(btrim(notes)) >= 10);

-- Preserve existing timestamp defaults. pg_catalog.now() above is already
-- timezone-safe for timestamptz; do not reinterpret a UTC timestamp without
-- a time zone through the migration session's TimeZone setting.

-- Existing foreign keys already have the required deletion behavior. Keep
-- their definitions/names and the mapping composite primary key untouched:
-- profiles.id -> auth.users.id CASCADE; services.provider_id -> profiles.id
-- CASCADE; mappings.service_id -> services.id CASCADE; mappings.category_id
-- -> service_categories.id RESTRICT; bookings.client_id -> profiles.id CASCADE;
-- bookings.service_id -> services.id RESTRICT (protects historical bookings).

CREATE INDEX IF NOT EXISTS services_provider_status_idx
  ON public.services (provider_id, status);
CREATE INDEX IF NOT EXISTS services_status_idx
  ON public.services (status);
CREATE INDEX IF NOT EXISTS service_category_mappings_category_idx
  ON public.service_category_mappings (category_id);
CREATE INDEX IF NOT EXISTS bookings_service_created_idx
  ON public.bookings (service_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$function$;

DO $triggers$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'profiles_set_updated_at' AND NOT tgisinternal) THEN
    CREATE TRIGGER profiles_set_updated_at
      BEFORE UPDATE ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.service_categories'::regclass AND tgname = 'service_categories_set_updated_at' AND NOT tgisinternal) THEN
    CREATE TRIGGER service_categories_set_updated_at
      BEFORE UPDATE ON public.service_categories
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.services'::regclass AND tgname = 'services_set_updated_at' AND NOT tgisinternal) THEN
    CREATE TRIGGER services_set_updated_at
      BEFORE UPDATE ON public.services
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.bookings'::regclass AND tgname = 'bookings_set_updated_at' AND NOT tgisinternal) THEN
    CREATE TRIGGER bookings_set_updated_at
      BEFORE UPDATE ON public.bookings
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END;
$triggers$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_category_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

DO $policies$
DECLARE
  policy record;
BEGIN
  FOR policy IN
    SELECT schemaname, tablename, policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'profiles',
        'service_categories',
        'services',
        'service_category_mappings',
        'bookings'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON %I.%I',
      policy.policyname,
      policy.schemaname,
      policy.tablename
    );
  END LOOP;
END;
$policies$;

-- Reset only application-role access on this subsystem, then grant the exact
-- columns/operations below. RLS still controls ownership and booking privacy.
-- Leave administrative grants and defaults for future objects unchanged.
REVOKE ALL PRIVILEGES ON TABLE
  public.profiles,
  public.service_categories,
  public.services,
  public.service_category_mappings,
  public.bookings
FROM PUBLIC, anon, authenticated;

REVOKE ALL PRIVILEGES ON FUNCTION public.set_updated_at()
  FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.current_profile_has_role(required_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = (SELECT auth.uid())
      AND role = required_role
  );
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.current_profile_has_role(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_profile_has_role(text) TO authenticated;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO anon, authenticated;

CREATE OR REPLACE FUNCTION private.is_approved_service(service_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.services
    WHERE id = service_uuid
      AND status = 'approved'
  );
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION private.is_approved_service(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_approved_service(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_service_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF public.current_profile_has_role('provider')
     AND OLD.status = 'draft'
     AND NEW.status = 'pending' THEN
    RETURN NEW;
  END IF;

  IF public.current_profile_has_role('admin')
     AND (
       (OLD.status = 'pending' AND NEW.status = 'approved')
       OR
       (OLD.status IN ('pending', 'approved') AND NEW.status = 'suspended')
     ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'This service status transition is not permitted'
    USING ERRCODE = '42501';
END;
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.enforce_service_status_transition()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS services_status_transition_guard ON public.services;
CREATE TRIGGER services_status_transition_guard
  BEFORE UPDATE OF status ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.enforce_service_status_transition();

GRANT SELECT (id, role) ON public.profiles TO authenticated;
GRANT SELECT (id, name, slug, active_status)
  ON public.service_categories TO anon, authenticated;
GRANT SELECT (
  id, title, description, hourly_rate, duration_minutes,
  coverage_radius_miles, status, created_at
) ON public.services TO anon;
GRANT SELECT (
  id, provider_id, title, description, hourly_rate, duration_minutes,
  coverage_radius_miles, status, created_at
) ON public.services TO authenticated;
GRANT INSERT (provider_id, title, hourly_rate, duration_minutes, coverage_radius_miles)
  ON public.services TO authenticated;
GRANT UPDATE (title, hourly_rate, duration_minutes, coverage_radius_miles, status)
  ON public.services TO authenticated;
GRANT DELETE ON public.services TO authenticated;
GRANT SELECT (service_id, category_id)
  ON public.service_category_mappings TO anon, authenticated;
GRANT INSERT (service_id, category_id)
  ON public.service_category_mappings TO authenticated;
GRANT DELETE ON public.service_category_mappings TO authenticated;
GRANT INSERT (service_id, client_email, requested_date, notes)
  ON public.bookings TO anon, authenticated;
GRANT SELECT (id, service_id, client_email, requested_date, notes, created_at)
  ON public.bookings TO authenticated;

CREATE POLICY profiles_select_own
  ON public.profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

CREATE POLICY service_categories_read_active
  ON public.service_categories FOR SELECT TO anon, authenticated
  USING (active_status);

CREATE POLICY services_read_approved
  ON public.services FOR SELECT TO anon
  USING (status = 'approved');

CREATE POLICY services_authenticated_read_approved
  ON public.services FOR SELECT TO authenticated
  USING (
    status = 'approved'
    AND NOT public.current_profile_has_role('provider')
  );

CREATE POLICY services_providers_read_own
  ON public.services FOR SELECT TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    AND public.current_profile_has_role('provider')
  );

CREATE POLICY services_admin_read
  ON public.services FOR SELECT TO authenticated
  USING (public.current_profile_has_role('admin'));

CREATE POLICY services_providers_insert_draft
  ON public.services FOR INSERT TO authenticated
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND status = 'draft'
    AND public.current_profile_has_role('provider')
  );

CREATE POLICY services_providers_update_own_unapproved
  ON public.services FOR UPDATE TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    AND status IN ('draft', 'suspended')
    AND public.current_profile_has_role('provider')
  )
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND status IN ('draft', 'suspended')
    AND public.current_profile_has_role('provider')
  );

CREATE POLICY services_providers_submit_draft
  ON public.services FOR UPDATE TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    AND status = 'draft'
    AND public.current_profile_has_role('provider')
  )
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND status = 'pending'
    AND public.current_profile_has_role('provider')
  );

CREATE POLICY services_providers_delete_own_unapproved
  ON public.services FOR DELETE TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    AND status IN ('draft', 'suspended')
    AND public.current_profile_has_role('provider')
  );

CREATE POLICY services_admin_update
  ON public.services FOR UPDATE TO authenticated
  USING (public.current_profile_has_role('admin'))
  WITH CHECK (public.current_profile_has_role('admin'));

CREATE POLICY service_category_mappings_read_approved
  ON public.service_category_mappings FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.services AS service
      WHERE service.id = service_category_mappings.service_id
        AND service.status = 'approved'
    )
  );

CREATE POLICY service_category_mappings_authenticated_read_approved
  ON public.service_category_mappings FOR SELECT TO authenticated
  USING (
    public.current_profile_has_role('admin')
    OR (
      NOT public.current_profile_has_role('provider')
      AND EXISTS (
        SELECT 1 FROM public.services AS service
        WHERE service.id = service_category_mappings.service_id
          AND service.status = 'approved'
      )
    )
  );

CREATE POLICY service_category_mappings_providers_read_own
  ON public.service_category_mappings FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.services AS service
      WHERE service.id = service_category_mappings.service_id
        AND service.provider_id = (SELECT auth.uid())
        AND public.current_profile_has_role('provider')
    )
  );

CREATE POLICY service_category_mappings_admin_read
  ON public.service_category_mappings FOR SELECT TO authenticated
  USING (public.current_profile_has_role('admin'));

CREATE POLICY service_category_mappings_providers_insert_own
  ON public.service_category_mappings FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.services AS service
      WHERE service.id = service_category_mappings.service_id
        AND service.provider_id = (SELECT auth.uid())
        AND service.status IN ('draft', 'suspended')
        AND public.current_profile_has_role('provider')
    )
    AND EXISTS (
      SELECT 1 FROM public.service_categories AS category
      WHERE category.id = service_category_mappings.category_id
        AND category.active_status
    )
  );

CREATE POLICY service_category_mappings_providers_delete_own
  ON public.service_category_mappings FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.services AS service
      WHERE service.id = service_category_mappings.service_id
        AND service.provider_id = (SELECT auth.uid())
        AND service.status IN ('draft', 'suspended')
        AND public.current_profile_has_role('provider')
    )
  );

CREATE POLICY bookings_insert_approved_service
  ON public.bookings FOR INSERT TO anon, authenticated
  WITH CHECK (
    private.is_approved_service(bookings.service_id)
  );

CREATE POLICY bookings_read_admin
  ON public.bookings FOR SELECT TO authenticated
  USING (public.current_profile_has_role('admin'));

CREATE POLICY bookings_read_designated_provider
  ON public.bookings FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.services AS service
      WHERE service.id = bookings.service_id
        AND service.provider_id = (SELECT auth.uid())
        AND public.current_profile_has_role('provider')
    )
  );

COMMIT;
