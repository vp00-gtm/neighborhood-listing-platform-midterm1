-- CIS 3610 Version B: align the deployed legacy relationships with the rubric.
-- Run after the three previously recorded migrations; do not rerun/edit them.
-- This changes constraints/defaults only. No existing row or identifier is
-- rewritten. Future deletion of a service WILL cascade to its bookings;
-- future category deletion WILL cascade to its category mappings.

BEGIN;

-- Fail rather than wait indefinitely for application traffic to release locks.
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.profiles, public.service_categories, public.services,
  public.service_category_mappings, public.bookings IN ACCESS EXCLUSIVE MODE;

DO $align_foreign_keys$
DECLARE
  edge record;
  existing_fk record;
  child_attribute smallint;
  parent_attribute smallint;
  fk_count integer;
BEGIN
  FOR edge IN
    SELECT * FROM (VALUES
      ('services', 'provider_id', 'profiles', 'c', 'r', 'RESTRICT'),
      ('service_category_mappings', 'category_id', 'service_categories', 'r', 'c', 'CASCADE'),
      ('bookings', 'service_id', 'services', 'r', 'c', 'CASCADE')
    ) AS edges(child_table, child_column, parent_table,
               legacy_delete_code, target_delete_code, delete_clause)
  LOOP
    SELECT attnum INTO child_attribute
    FROM pg_catalog.pg_attribute
    WHERE attrelid = format('public.%I', edge.child_table)::regclass
      AND attname = edge.child_column AND NOT attisdropped;

    SELECT attnum INTO parent_attribute
    FROM pg_catalog.pg_attribute
    WHERE attrelid = format('public.%I', edge.parent_table)::regclass
      AND attname = 'id' AND NOT attisdropped;

    IF child_attribute IS NULL OR parent_attribute IS NULL THEN
      RAISE EXCEPTION 'Expected relationship columns are missing on % -> %; review before alignment',
        edge.child_table, edge.parent_table;
    END IF;

    SELECT count(*) INTO fk_count
    FROM pg_catalog.pg_constraint
    WHERE conrelid = format('public.%I', edge.child_table)::regclass
      AND contype = 'f' AND child_attribute = ANY(conkey);

    IF fk_count <> 1 THEN
      RAISE EXCEPTION 'Expected exactly one foreign key on %.%; found %. No relationships were guessed',
        edge.child_table, edge.child_column, fk_count;
    END IF;

    SELECT * INTO existing_fk
    FROM pg_catalog.pg_constraint
    WHERE conrelid = format('public.%I', edge.child_table)::regclass
      AND contype = 'f' AND child_attribute = ANY(conkey);

    -- Do not silently change a different target, update action, match mode,
    -- deferrability or an unvalidated relationship in an unexpected schema.
    IF existing_fk.conkey IS DISTINCT FROM ARRAY[child_attribute]::smallint[]
       OR existing_fk.confrelid <> format('public.%I', edge.parent_table)::regclass
       OR existing_fk.confkey IS DISTINCT FROM ARRAY[parent_attribute]::smallint[]
       OR existing_fk.confupdtype::text <> 'a'
       OR existing_fk.confmatchtype::text <> 's'
       OR existing_fk.condeferrable
       OR NOT existing_fk.convalidated
       OR existing_fk.confdeltype::text NOT IN (edge.legacy_delete_code, edge.target_delete_code)
    THEN
      RAISE EXCEPTION 'Unexpected foreign key definition on %.%; review before alignment',
        edge.child_table, edge.child_column;
    END IF;

    IF existing_fk.confdeltype::text <> edge.target_delete_code THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',
        edge.child_table, existing_fk.conname);
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I (id) ON DELETE %s',
        edge.child_table, existing_fk.conname, edge.child_column,
        edge.parent_table, edge.delete_clause
      );
    END IF;
  END LOOP;
END;
$align_foreign_keys$;

-- Validate before replacing the known legacy slug check. Existing slugs are
-- never lowercased, renamed or otherwise repaired by this migration.
DO $slug_preflight$
DECLARE
  slug_attribute smallint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.service_categories
    WHERE slug IS NULL OR slug !~* '^[a-z0-9-]+$'
  ) THEN
    RAISE EXCEPTION 'Existing category slugs do not meet the exam format; no slugs were changed';
  END IF;

  SELECT attnum INTO slug_attribute FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.service_categories'::regclass
    AND attname = 'slug' AND NOT attisdropped;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.service_categories'::regclass
      AND conname = 'service_categories_slug_check'
      AND (contype <> 'c' OR conkey IS DISTINCT FROM ARRAY[slug_attribute]::smallint[])
  ) THEN
    RAISE EXCEPTION 'The named slug constraint has an unexpected definition; review before alignment';
  END IF;
END;
$slug_preflight$;

ALTER TABLE public.service_categories
  DROP CONSTRAINT IF EXISTS service_categories_slug_check,
  ADD CONSTRAINT service_categories_slug_check
    CHECK (slug ~* '^[a-z0-9-]+$');

-- Use the rubric's exact expression. These defaults affect new rows only;
-- existing created_at/updated_at values remain untouched. As in Supabase's
-- normal UTC setup, sessions inserting timestamptz values should use UTC.
ALTER TABLE public.profiles
  ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
ALTER TABLE public.service_categories
  ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
ALTER TABLE public.services
  ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
ALTER TABLE public.service_category_mappings
  ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
ALTER TABLE public.bookings
  ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());

COMMIT;
