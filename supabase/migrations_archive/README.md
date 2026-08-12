# Archived migrations (001–075)

These 86 files are the complete hand-applied migration history of this project,
from the first schema through `075_deposit_settings_public_read.sql`. **All of
them are already applied to the live database** (`kzfixfcatknkkqttnvvi`).

They were moved here on 2026-08-13 and replaced by a single CLI-generated
baseline, `supabase/migrations/20260812222443_remote_schema.sql`, which is
recorded as applied in `supabase_migrations.schema_migrations`. Local and remote
migration history now match with nothing pending, so `supabase db push` is safe.

Note for regenerating the baseline later: `supabase db pull` does not work
against this project — its pg-delta diff engine times out. Use `supabase db dump
--db-url <session-pooler-url> -f <file>` instead. See `db-audit-to-port/README.md`
for the pooler URL shape.

## Why they moved

They were applied by hand in the Supabase SQL editor and never recorded in
`supabase_migrations.schema_migrations`, so the CLI considered every one of them
pending. Their `NNN_name.sql` names also don't match the 14-digit timestamp
format the CLI expects. Rather than leave that ambiguity sitting next to a
production database, the whole set moves here and a fresh `supabase db pull`
becomes the single source of truth.

## Do not run these

The baseline in `supabase/migrations/` captures the live schema *as it is now*,
including everything these files did. Re-running one would at best be a no-op
and at worst revert something — several of them redefine the same functions
(`create_public_booking`, `reschedule_booking_by_manage_token`) that later files
changed again.

They are kept tracked in git rather than deleted because they are the only
readable record of *when* and *why* each schema change happened. Git history
would preserve them either way, but grepping a working-tree folder is how you
actually answer "when did this column appear, and what was it for".

## Notable entries

| File | |
|---|---|
| `071`–`074` | Security hardening from the 2026-08-12 authorization review. Written and applied from a stale replica checkout by mistake — see the `project-stale-qwickly-replica` note. |
| `075` | Fixes a regression `074` caused: its anon-grant list was traced against pre-deposits code and omitted `deposit_settings`, which took every public booking page down until it was applied. |
| Duplicate numbers | `014`, `034`, `038`, `039`, `062` each appear twice. That is pre-existing — both files in each pair were applied. |
