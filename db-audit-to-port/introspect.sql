-- Qwickly DB audit: live-state introspection
-- Writes CSVs to /out (mounted from the scratchpad dbaudit dir).
-- Read-only. No DDL, no DML.

\set ON_ERROR_STOP on

-- 1. TABLES: exact row counts + access stats.
--    seq_scan + idx_scan = 0 means nothing has read this table since stats were
--    last reset. Combined with 0 rows it is a near-certain dead table.
\echo '>> tables.csv'
\copy (WITH counts AS (SELECT c.oid, n.nspname AS schema, c.relname AS table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint AS exact_rows FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname = 'public') SELECT co.schema, co.table_name, co.exact_rows, COALESCE(s.seq_scan,0) AS seq_scan, COALESCE(s.idx_scan,0) AS idx_scan, COALESCE(s.n_tup_ins,0) AS inserts, COALESCE(s.n_tup_upd,0) AS updates, COALESCE(s.n_tup_del,0) AS deletes, pg_size_pretty(pg_total_relation_size(co.oid)) AS total_size, obj_description(co.oid) AS comment FROM counts co LEFT JOIN pg_stat_user_tables s ON s.relid = co.oid ORDER BY co.exact_rows DESC, co.table_name) TO '/out/tables.csv' CSV HEADER;

-- 2. COLUMNS: full inventory + null_frac from the planner's stats.
--    null_frac = 1 on a populated table means every row is NULL -> the column
--    is written by nothing and is a prime deletion candidate.
\echo '>> columns.csv'
\copy (SELECT c.table_name, c.ordinal_position, c.column_name, c.data_type, c.is_nullable, c.column_default, s.null_frac, s.n_distinct FROM information_schema.columns c LEFT JOIN pg_stats s ON s.schemaname = c.table_schema AND s.tablename = c.table_name AND s.attname = c.column_name WHERE c.table_schema = 'public' ORDER BY c.table_name, c.ordinal_position) TO '/out/columns.csv' CSV HEADER;

-- 3. INDEXES: idx_scan = 0 means the index has never been used to serve a query.
\echo '>> indexes.csv'
\copy (SELECT s.relname AS table_name, s.indexrelname AS index_name, s.idx_scan, pg_size_pretty(pg_relation_size(s.indexrelid)) AS size, i.indisunique AS is_unique, i.indisprimary AS is_primary, pg_get_indexdef(s.indexrelid) AS definition FROM pg_stat_user_indexes s JOIN pg_index i ON i.indexrelid = s.indexrelid WHERE s.schemaname = 'public' ORDER BY s.idx_scan, s.relname) TO '/out/indexes.csv' CSV HEADER;

-- 4. FOREIGN KEYS: the dependency graph. A table nothing references and that
--    references nothing is an island - easier to drop safely.
\echo '>> foreign_keys.csv'
\copy (SELECT con.conname AS constraint_name, src.relname AS from_table, (SELECT string_agg(a.attname, ',' ORDER BY x.ord) FROM unnest(con.conkey) WITH ORDINALITY x(attnum, ord) JOIN pg_attribute a ON a.attrelid = src.oid AND a.attnum = x.attnum) AS from_columns, tgt.relname AS to_table, con.confdeltype AS on_delete FROM pg_constraint con JOIN pg_class src ON src.oid = con.conrelid JOIN pg_class tgt ON tgt.oid = con.confrelid JOIN pg_namespace n ON n.oid = con.connamespace WHERE con.contype = 'f' AND n.nspname = 'public' ORDER BY src.relname, con.conname) TO '/out/foreign_keys.csv' CSV HEADER;

-- 5. RLS POLICIES: these reference columns in their USING/WITH CHECK clauses.
--    Dropping a column referenced here fails or silently changes access rules.
--    Must be read before any deletion.
\echo '>> rls_policies.csv'
\copy (SELECT p.tablename, p.policyname, p.permissive, p.roles::text, p.cmd, p.qual, p.with_check FROM pg_policies p WHERE p.schemaname = 'public' ORDER BY p.tablename, p.policyname) TO '/out/rls_policies.csv' CSV HEADER;

-- 6. RLS ENABLED FLAG: a table with RLS enabled and zero policies is
--    unreachable by anon/authenticated - often an abandoned table.
\echo '>> rls_status.csv'
\copy (SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced, (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename = c.relname) AS policy_count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname = 'public' ORDER BY c.relname) TO '/out/rls_status.csv' CSV HEADER;

-- 7. TRIGGERS: trigger bodies reference columns too.
\echo '>> triggers.csv'
\copy (SELECT c.relname AS table_name, t.tgname AS trigger_name, p.proname AS function_name, pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE NOT t.tgisinternal AND n.nspname = 'public' ORDER BY c.relname, t.tgname) TO '/out/triggers.csv' CSV HEADER;

-- 8. FUNCTIONS / RPCs: full source. The public booking flow uses RPCs, so these
--    are real consumers of tables that grep over the TS code will never find.
\echo '>> functions.csv'
\copy (SELECT p.proname AS function_name, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef AS security_definer, pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' ORDER BY p.proname) TO '/out/functions.csv' CSV HEADER;

-- 9. VIEWS
\echo '>> views.csv'
\copy (SELECT table_name AS view_name, view_definition FROM information_schema.views WHERE table_schema = 'public' ORDER BY table_name) TO '/out/views.csv' CSV HEADER;

-- 10. GRANTS: what anon / authenticated / service_role can actually reach.
\echo '>> grants.csv'
\copy (SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon','authenticated','service_role') GROUP BY table_name, grantee ORDER BY table_name, grantee) TO '/out/grants.csv' CSV HEADER;

-- 11. SEQUENCES: last_value = 1 and never advanced implies the owning table has
--     never had a row inserted through it.
\echo '>> sequences.csv'
\copy (SELECT schemaname, sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename) TO '/out/sequences.csv' CSV HEADER;

-- 12. EXTENSIONS + stats freshness. If stats were reset recently, the
--     "never scanned" signals above are unreliable - this tells us how much to
--     trust them.
\echo '>> stats_meta.csv'
\copy (SELECT (SELECT stats_reset FROM pg_stat_database WHERE datname = current_database()) AS stats_reset, now() AS collected_at, current_database() AS db, version() AS pg_version) TO '/out/stats_meta.csv' CSV HEADER;

\echo '>> introspection complete'
