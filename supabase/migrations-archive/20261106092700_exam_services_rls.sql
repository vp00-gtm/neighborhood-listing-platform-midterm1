-- CIS 3610 Midterm Version B: row-level security for services and bookings.
-- Apply after 20261029140000_exam_services_persistence.sql.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_category_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()));

CREATE POLICY profiles_insert_own
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

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

CREATE POLICY services_providers_update_own_unapproved
  ON public.services
  FOR UPDATE
  TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    AND status IN ('draft', 'suspended')
  )
  WITH CHECK (
    provider_id = (SELECT auth.uid())
    AND status IN ('draft', 'suspended')
  );

CREATE POLICY services_providers_delete_own_unapproved
  ON public.services
  FOR DELETE
  TO authenticated
  USING (
    provider_id = (SELECT auth.uid())
    AND status IN ('draft', 'suspended')
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

CREATE POLICY service_category_mappings_providers_insert_own_unapproved
  ON public.service_category_mappings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.services AS service
      WHERE service.id = service_category_mappings.service_id
        AND service.provider_id = (SELECT auth.uid())
        AND service.status IN ('draft', 'suspended')
    )
    AND EXISTS (
      SELECT 1
      FROM public.service_categories AS category
      WHERE category.id = service_category_mappings.category_id
        AND category.is_active
    )
  );

CREATE POLICY service_category_mappings_providers_delete_own_unapproved
  ON public.service_category_mappings
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.services AS service
      WHERE service.id = service_category_mappings.service_id
        AND service.provider_id = (SELECT auth.uid())
        AND service.status IN ('draft', 'suspended')
    )
  );

CREATE POLICY bookings_read_associated
  ON public.bookings
  FOR SELECT
  TO authenticated
  USING (
    client_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.services AS service
      WHERE service.id = bookings.service_id
        AND service.provider_id = (SELECT auth.uid())
    )
  );

CREATE POLICY bookings_insert_as_client_for_approved_service
  ON public.bookings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    client_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.services AS service
      WHERE service.id = bookings.service_id
        AND service.status = 'approved'
    )
  );
