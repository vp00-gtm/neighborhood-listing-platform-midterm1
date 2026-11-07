-- Allow providers to read mappings for their own draft/suspended services.
-- Public reads remain governed by service_category_mappings_read_public.
-- The drop makes this forward migration safe to reapply without changing the
-- behavior of any other mapping policies.
-- Timestamp is this migration's creation time in the local examination environment.

BEGIN;

DROP POLICY IF EXISTS service_category_mappings_providers_read_own_unapproved
  ON public.service_category_mappings;

CREATE POLICY service_category_mappings_providers_read_own_unapproved
  ON public.service_category_mappings
  FOR SELECT
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

COMMIT;
