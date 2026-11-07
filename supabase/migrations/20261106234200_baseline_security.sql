-- Deliberate least-privilege security baseline for the existing local API.
-- Intentional differences from public-schema.sql:
-- - Do not grant ALL table/function privileges or broad default privileges.
-- - Do not grant booking access or retain the old client/provider booking
--   SELECT policy or authenticated booking INSERT policy.
-- - Do not retain profile INSERT/UPDATE, service UPDATE/DELETE, or provider
--   mapping INSERT/DELETE/own-unapproved SELECT policies. These operations
--   are not used by the inspected services API.
-- - Do not grant service_role access; the inspected application uses the
--   request-scoped anon/authenticated client.
-- - Do not copy export ownership statements; local ownership follows the
--   role that creates these objects.
-- This is a fresh-local baseline, not a production migration or an exam
-- security migration.

BEGIN;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_category_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
  public.profiles,
  public.service_categories,
  public.services,
  public.service_category_mappings,
  public.bookings
FROM anon, authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.set_updated_at()
FROM PUBLIC, anon, authenticated, service_role;

-- The configured local API defaults to exposing new public objects. Prevent
-- broad inherited grants for future public objects created by postgres;
-- later migrations must grant only the operations they require.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Public service listing filters by status and returns these fields.
GRANT SELECT (
  id,
  name,
  description,
  price_amount,
  currency,
  status,
  created_at
) ON public.services TO anon;

-- Authenticated service creation uses provider_id and returns its own row.
GRANT SELECT (
  id,
  provider_id,
  name,
  description,
  price_amount,
  currency,
  status,
  created_at
) ON public.services TO authenticated;
GRANT INSERT (
  provider_id,
  name,
  description,
  price_amount,
  currency
) ON public.services TO authenticated;

-- Public GET embeds only these category and mapping fields. is_active is
-- granted because the active-category policy evaluates it.
GRANT SELECT (id, name, slug, is_active)
  ON public.service_categories TO anon, authenticated;
GRANT SELECT (service_id, category_id)
  ON public.service_category_mappings TO anon, authenticated;

-- The existing service POST checks that the authenticated user's profile
-- exists; it needs only the profile ID.
GRANT SELECT (id) ON public.profiles TO authenticated;

CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()));

CREATE POLICY service_categories_read_active
  ON public.service_categories
  FOR SELECT
  TO anon, authenticated
  USING (is_active);

CREATE POLICY services_read_approved
  ON public.services
  FOR SELECT
  TO anon, authenticated
  USING (status = 'approved');

-- Retained for the existing API's authenticated insert-returning behavior.
-- This legacy baseline policy checks ownership and draft status, but not a
-- profile role because the baseline schema has no role column.
CREATE POLICY services_providers_read_own
  ON public.services
  FOR SELECT
  TO authenticated
  USING (provider_id = (SELECT auth.uid()));

CREATE POLICY services_providers_insert_draft
  ON public.services
  FOR INSERT
  TO authenticated
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND status = 'draft'
  );

CREATE POLICY service_category_mappings_read_public
  ON public.service_category_mappings
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.services AS service
      JOIN public.service_categories AS category
        ON category.id = service_category_mappings.category_id
      WHERE service.id = service_category_mappings.service_id
        AND service.status = 'approved'
        AND category.is_active
    )
  );

COMMIT;
