-- Synthetic fixtures for an isolated, network-disabled PostgreSQL container.
-- Never run against the production project.
INSERT INTO auth.users (id, email) VALUES
  ('1fbdbbfb-33d8-4dbe-af0c-55b5b57e97c0', 'admin@example.test'),
  ('46e4e555-f621-4c9d-bbff-fb07de4cc2e0', 'provider-a@example.test'),
  ('6d963fc7-8a0e-443c-a01c-b68ef42cc2f4', 'client-b@example.test'),
  ('a9658e7b-ec7a-4984-bbfb-fe973ebe0476', 'provider-b@example.test'),
  ('efaf1676-705e-412d-9280-7183714e1817', 'client-a@example.test');
INSERT INTO public.profiles (id, display_name)
  SELECT id, 'Isolated test profile' FROM auth.users;
INSERT INTO public.service_categories (id, name, slug, is_active) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'Active test category', 'active-test', true),
  ('a1000000-0000-4000-8000-000000000002', 'Inactive test category', 'inactive-test', false);
INSERT INTO public.services (id, provider_id, name, description, price_amount, currency, status) VALUES
  ('b1000000-0000-4000-8000-000000000001', '46e4e555-f621-4c9d-bbff-fb07de4cc2e0', 'House Cleaning', 'Synthetic cleaning description', 123.45, 'USD', 'approved'),
  ('b1000000-0000-4000-8000-000000000002', '46e4e555-f621-4c9d-bbff-fb07de4cc2e0', 'Garden Maintenance', 'Synthetic garden description', 234.56, 'USD', 'draft'),
  ('b1000000-0000-4000-8000-000000000003', 'a9658e7b-ec7a-4984-bbfb-fe973ebe0476', 'Plumbing Repair', 'Synthetic plumbing description', 345.67, 'USD', 'approved'),
  ('b1000000-0000-4000-8000-000000000004', 'a9658e7b-ec7a-4984-bbfb-fe973ebe0476', 'Painting Service', 'Synthetic painting description', 456.78, 'USD', 'suspended');
INSERT INTO public.service_category_mappings (service_id, category_id) VALUES
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000002');
INSERT INTO public.bookings (id, client_id, service_id, scheduled_at, client_notes) VALUES
  ('c1000000-0000-4000-8000-000000000001', 'efaf1676-705e-412d-9280-7183714e1817', 'b1000000-0000-4000-8000-000000000001', '2026-12-01 10:00:00+00', 'Synthetic booking notes A'),
  ('c1000000-0000-4000-8000-000000000002', '6d963fc7-8a0e-443c-a01c-b68ef42cc2f4', 'b1000000-0000-4000-8000-000000000003', '2026-12-02 11:00:00+00', 'Synthetic booking notes B');
