-- CIS 3610 Midterm Version B: Local Services & Bookings persistence.
-- Part 4 must add and verify RLS policies before exposing these tables through
-- the Supabase API.

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text NOT NULL
    CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
  created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE public.service_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  slug text NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL
    REFERENCES public.profiles (id) ON DELETE CASCADE,
  name text NOT NULL
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description text NOT NULL
    CHECK (char_length(btrim(description)) BETWEEN 1 AND 5000),
  price_amount numeric(10, 2) NOT NULL
    CHECK (price_amount >= 0),
  currency text NOT NULL DEFAULT 'USD'
    CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'suspended')),
  created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE public.service_category_mappings (
  service_id uuid NOT NULL
    REFERENCES public.services (id) ON DELETE CASCADE,
  category_id uuid NOT NULL
    REFERENCES public.service_categories (id) ON DELETE RESTRICT,
  created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (service_id, category_id)
);

CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL
    REFERENCES public.profiles (id) ON DELETE CASCADE,
  service_id uuid NOT NULL
    REFERENCES public.services (id) ON DELETE RESTRICT,
  scheduled_at timestamp with time zone NOT NULL,
  client_notes text
    CHECK (client_notes IS NULL OR char_length(client_notes) <= 2000),
  created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX services_provider_status_idx
  ON public.services (provider_id, status);

CREATE INDEX services_status_idx
  ON public.services (status);

CREATE INDEX service_category_mappings_category_idx
  ON public.service_category_mappings (category_id);

CREATE INDEX bookings_client_created_idx
  ON public.bookings (client_id, created_at DESC);

CREATE INDEX bookings_service_created_idx
  ON public.bookings (service_id, created_at DESC);

CREATE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER service_categories_set_updated_at
  BEFORE UPDATE ON public.service_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER services_set_updated_at
  BEFORE UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER bookings_set_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
