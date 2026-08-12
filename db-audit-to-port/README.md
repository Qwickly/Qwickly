# DB audit tooling

Read-only introspection for the Supabase database (`kzfixfcatknkkqttnvvi`).
Runs via Docker, so no local `psql` install is needed.

## Setup

Create `db.env` in this folder (gitignored — never commit it):

```
DATABASE_URL=postgresql://postgres.kzfixfcatknkkqttnvvi:PASSWORD@aws-1-eu-central-1.pooler.supabase.com:5432/postgres
```

Note the shape — these three catch people out:

- Host is the **session pooler** (`aws-1-eu-central-1`). The direct host
  `db.<ref>.supabase.co` is IPv6-only and unreachable from a Docker container.
- Port **5432**, not 6543. Transaction mode cannot serve `pg_dump`.
- Username is `postgres.kzfixfcatknkkqttnvvi`, not plain `postgres` — the pooler
  needs the project ref to route to the right tenant.

URL-encode special characters in the password (`@` → `%40`, `#` → `%23`).

## Run

```bash
bash run-audit.sh
```

Writes `schema.sql`, `schema-full.sql` and twelve CSVs into this folder. Entirely
read-only: `pg_dump --schema-only` plus `SELECT`s.

## What it is good for

The dead-table half has limited value — the migration history answers that. The
part that earns its keep is authorization, because nothing else surfaces it:

- `rls_policies.csv` — full `USING` / `WITH CHECK` text for every policy. Reading
  these is what found a `USING(true)` policy granting anonymous writes.
- `grants.csv` — what `anon` / `authenticated` can actually reach. Grants and RLS
  must agree; when they disagree, RLS is doing all the work alone.
- `functions.csv` — every function body, including `SECURITY DEFINER` ones. These
  bypass RLS entirely and are invisible to any grep over TypeScript.
- `tables.csv` — exact row counts plus scan/write stats since the database was
  created.

Worth re-running after adding tables, policies, or `SECURITY DEFINER` functions.

## Files here

| File | |
|---|---|
| `introspect.sql` | The twelve queries. |
| `run-audit.sh` | Docker wrapper. |
| `SECURITY.md` | The 2026-08-12 authorization review: what was fixed, what is still open. Read the provenance note at the top. |
| `schema-BEFORE-071-to-074.sql` | Schema snapshot from **before** migrations `071`–`074` were applied. Historical reference only — **not** current state. Re-run `run-audit.sh` for that. |

## Still open

See `SECURITY.md`, but the short version:

- `usage_tracking` can be written by any authenticated user, and the frontend
  increments its own counters. Cosmetic now that nothing sums the column
  platform-wide, but a client trusted to report its own quota cannot enforce one.
- `has_active_subscription(business_uuid)` is callable by `anon`, leaking whether
  any given business has an active subscription.
