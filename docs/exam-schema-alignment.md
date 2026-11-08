# Version B schema alignment

## Status

The student reports that the original migration and both baseline placeholders
were applied successfully. The new migration
`supabase/migrations/20261107000000_exam_schema_alignment.sql` is a local,
unapplied correction based on the full exam instructions. No remote schema or
migration history was inspected during preparation.

Do not rerun the original migration: it contains sample-specific backfills and
is already recorded remotely. Apply this later migration separately only after
review and verification against a disposable database. No execution is claimed
by the local static checks.

## Required changes

| Relationship | Previous behavior | Rubric behavior after alignment |
| --- | --- | --- |
| services.provider_id -> profiles.id | CASCADE | RESTRICT |
| service_category_mappings.category_id -> service_categories.id | RESTRICT | CASCADE |
| bookings.service_id -> services.id | RESTRICT | CASCADE |

The migration keeps existing foreign-key names and refuses unexpected targets,
duplicate/missing single-column foreign keys, nonstandard update/match rules,
deferrable constraints, or unvalidated foreign keys. Already-aligned deletion
actions are accepted. Other relationships and the mapping composite primary key
are not changed.

It also installs the case-insensitive slug check `^[a-z0-9-]+$` and the rubric's
exact `timezone('utc'::text, now())` created_at defaults on all five tables.
The slug remains unique and NOT NULL. Incompatible existing slugs abort the
transaction instead of being rewritten. Only the known slug check is replaced;
any additional custom slug constraints need separate review.

## Data and access preservation

- No INSERT, UPDATE, DELETE, TRUNCATE, table removal or data backfill occurs.
- IDs, service prices, descriptions, currencies, category records/mappings,
  historical booking contents and existing timestamps are preserved.
- RLS policies, grants, role assignments, authentication and service statuses
  are unchanged.
- Future category deletion removes its mappings. Future service deletion
  removes its bookings and service mappings. Provider-profile deletion is
  blocked while services reference it. These changes follow the rubric and
  replace the earlier historical-booking deletion restriction.

## Execution considerations

The transaction takes exclusive locks on the five tables and uses a five-second
lock timeout; a busy database may require retrying in a maintenance window.
Rebuilding foreign keys validates existing references. Missing prerequisites,
orphans, incompatible slugs or unsupported custom constraints stop execution;
the transaction must not be committed after an error.

The exact exam timestamp expression returns a timestamp without a time zone
before conversion to TIMESTAMPTZ. Inserting sessions must use UTC to avoid
reinterpretation through another session time zone. No global timezone setting
is changed by this migration.

On disposable data, verify all three deletion behaviors, retained row counts
and IDs before deletions, rejected invalid slugs, default timestamps, and the
existing RLS positive/negative matrix. These checks have not been executed here.
