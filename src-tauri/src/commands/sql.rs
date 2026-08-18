// ── list_tables ───────────────────────────────────────────────────────────────

pub const PG_LIST_TABLES: &str = "\
    SELECT t.table_name, \
    CASE t.table_type \
        WHEN 'BASE TABLE' THEN 'table' \
        WHEN 'VIEW' THEN 'view' \
        ELSE 'table' \
    END, \
    (SELECT reltuples::bigint FROM pg_class c \
        JOIN pg_namespace n ON n.oid = c.relnamespace \
        WHERE c.relname = t.table_name AND n.nspname = t.table_schema \
        LIMIT 1) \
    FROM information_schema.tables t \
    WHERE t.table_schema = 'public' \
    ORDER BY t.table_type DESC, t.table_name";

pub const MYSQL_LIST_TABLES: &str = "\
    SELECT CAST(TABLE_NAME AS CHAR), \
    CAST(CASE TABLE_TYPE \
        WHEN 'BASE TABLE' THEN 'table' \
        WHEN 'VIEW' THEN 'view' \
        ELSE 'table' \
    END AS CHAR), \
    CAST(TABLE_ROWS AS SIGNED) \
    FROM information_schema.TABLES \
    WHERE TABLE_SCHEMA = DATABASE() \
    ORDER BY TABLE_TYPE DESC, TABLE_NAME";

pub const SQLITE_LIST_TABLES: &str = "\
    SELECT name, type FROM sqlite_master \
    WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' \
    ORDER BY type DESC, name";

// ── column info ───────────────────────────────────────────────────────────────

/// Param: $1 = table name. Returns (name, is_nullable_str, is_primary, has_default).
/// data_type is NOT selected here — it comes from describe() via pg_describe_types().
pub const PG_COLUMN_INFO: &str = "\
    SELECT \
        a.attname, \
        CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END, \
        EXISTS( \
            SELECT 1 FROM pg_catalog.pg_constraint con \
            WHERE con.conrelid = cl.oid \
                AND con.contype = 'p' \
                AND a.attnum = ANY(con.conkey) \
        ), \
        (a.atthasdef OR a.attidentity != '') \
    FROM pg_catalog.pg_attribute a \
    JOIN pg_catalog.pg_class cl ON cl.oid = a.attrelid \
    JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace \
    WHERE cl.relname = $1 \
        AND n.nspname = 'public' \
        AND a.attnum > 0 \
        AND NOT a.attisdropped \
    ORDER BY a.attnum";

/// Param: ? = table name. Returns (name, is_nullable_str, is_primary, has_default).
/// data_type is NOT selected here — it comes from describe() via mysql_describe_types().
pub const MYSQL_COLUMN_INFO: &str = "\
    SELECT CAST(COLUMN_NAME AS CHAR), \
    CAST(IS_NULLABLE AS CHAR), IF(COLUMN_KEY = 'PRI', 1, 0), \
    IF(COLUMN_DEFAULT IS NOT NULL OR EXTRA LIKE '%auto_increment%', 1, 0) \
    FROM information_schema.COLUMNS \
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? \
    ORDER BY ORDINAL_POSITION";

/// Param: ? = table name
pub const SQLITE_COLUMN_INFO: &str = "SELECT * FROM pragma_table_info(?)";

// ── row count estimates ───────────────────────────────────────────────────────

/// Param: $1 = table name. Returns reltuples::bigint (may be -1 for unanalyzed tables).
pub const PG_ROW_ESTIMATE: &str =
    "SELECT reltuples::bigint FROM pg_class WHERE relname = $1";

/// Param: ? = table name. Returns TABLE_ROWS (approximate for InnoDB).
pub const MYSQL_ROW_ESTIMATE: &str = "\
    SELECT CAST(TABLE_ROWS AS SIGNED) FROM information_schema.TABLES \
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?";

