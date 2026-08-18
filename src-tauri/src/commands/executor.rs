use sqlx::{Column, Executor, Row, SqlSafeStr, TypeInfo};

use crate::commands::decode::{decode_mysql, decode_pg, decode_sqlite, SqlCell};

/// Generates a `pub async fn $name<'c, E>(executor, sql, params) -> Result<Vec<Vec<SqlCell>>>`
/// for each supported database. The function binds all params as `&str` and decodes every row
/// cell using the provided decode function.
macro_rules! make_fetch {
    ($name:ident, $db:ty, $args:ty, $decoder:ident) => {
        pub async fn $name<'c, E>(
            executor: E,
            sql: &str,
            params: &[String],
        ) -> Result<Vec<Vec<SqlCell>>, String>
        where
            E: sqlx::Executor<'c, Database = $db>,
        {
            use sqlx::Arguments as _;
            let mut args = <$args>::default();
            for p in params {
                args.add(p.as_str()).map_err(|e| e.to_string())?;
            }
            let rows = sqlx::query_with(sqlx::AssertSqlSafe(sql), args)
                .fetch_all(executor)
                .await
                .map_err(|e| e.to_string())?;
            Ok(rows
                .iter()
                .map(|row| (0..row.columns().len()).map(|i| $decoder(row, i)).collect())
                .collect())
        }
    };
}

make_fetch!(mysql_fetch, sqlx::MySql, sqlx::mysql::MySqlArguments, decode_mysql);
make_fetch!(sqlite_fetch, sqlx::Sqlite, sqlx::sqlite::SqliteArguments, decode_sqlite);

/// Like `make_fetch!` but takes pre-built arguments instead of `&[String]`.
/// Use this when parameters require typed binding (e.g. Postgres LIMIT/OFFSET need `i64`).
macro_rules! make_fetch_with {
    ($name:ident, $db:ty, $args:ty, $decoder:ident) => {
        pub async fn $name<'c, E>(
            executor: E,
            sql: &str,
            args: $args,
        ) -> Result<Vec<Vec<SqlCell>>, String>
        where
            E: sqlx::Executor<'c, Database = $db>,
        {
            let rows = sqlx::query_with(sqlx::AssertSqlSafe(sql), args)
                .fetch_all(executor)
                .await
                .map_err(|e| e.to_string())?;
            Ok(rows
                .iter()
                .map(|row| (0..row.columns().len()).map(|i| $decoder(row, i)).collect())
                .collect())
        }
    };
}

make_fetch_with!(pg_fetch_with, sqlx::Postgres, sqlx::postgres::PgArguments, decode_pg);

/// Generates `pub async fn $name(conn: &mut $conn, sql: &str) -> Vec<String>`.
///
/// Calls `describe()` on the connection — the same mechanism `editor.rs` uses inside
/// `execute_statement!` — and returns the lowercased type names from `type_info()`.
/// This is the single source of truth for column data_type in both DataGrid and EditorResultGrid.
macro_rules! make_describe {
    ($name:ident, $conn:ty) => {
        pub async fn $name(conn: &mut $conn, sql: &str) -> Vec<String> {
            conn.describe(sqlx::AssertSqlSafe(sql).into_sql_str())
                .await
                .map(|desc| {
                    desc.columns()
                        .iter()
                        .map(|c| c.type_info().name().to_ascii_lowercase())
                        .collect()
                })
                .unwrap_or_default()
        }
    };
}

make_describe!(pg_describe_types, sqlx::postgres::PgConnection);
make_describe!(mysql_describe_types, sqlx::mysql::MySqlConnection);
make_describe!(sqlite_describe_types, sqlx::sqlite::SqliteConnection);
