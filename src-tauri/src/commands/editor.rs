use std::{collections::HashSet, time::Instant};

use bigdecimal::BigDecimal;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{
    mysql::{MySqlConnection, MySqlRow},
    pool::PoolConnection,
    postgres::{PgConnection, PgRow},
    sqlite::{SqliteConnection, SqliteRow},
    Column, Executor, MySql, Postgres, Row, SqlSafeStr, Sqlite, TypeInfo, ValueRef,
};
use uuid::Uuid;

use super::connection::{AppState, DbPool};
use super::sql_util::{
    mysql_primary_columns, normalize_type, pg_primary_columns, sqlite_primary_columns, Dialect,
};

/// The editor intentionally retains a small, bounded preview. Change this one
/// constant when a configurable result-size preference is introduced.
pub const MAX_QUERY_RESULT_ROWS: usize = 100;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EditorMode {
    AutoCommit,
    Manual,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TransactionState {
    Inactive,
    Active,
    Failed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlCell {
    pub kind: &'static str,
    pub display: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlResultColumn {
    pub name: String,
    pub data_type: String,
    pub is_primary: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlErrorInfo {
    pub message: String,
    pub code: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementResult {
    pub index: usize,
    pub kind: &'static str,
    pub columns: Vec<SqlResultColumn>,
    pub rows: Vec<Vec<SqlCell>>,
    pub row_count: u64,
    pub rows_affected: u64,
    pub truncated: bool,
    pub row_limit: usize,
    pub elapsed_ms: u64,
    pub message: Option<String>,
    pub error: Option<SqlErrorInfo>,
}

impl StatementResult {
    fn error(index: usize, error: sqlx::Error, elapsed_ms: u64) -> Self {
        let code = error
            .as_database_error()
            .and_then(|database_error| database_error.code().map(|code| code.into_owned()));
        Self {
            index,
            kind: "error",
            columns: vec![],
            rows: vec![],
            row_count: 0,
            rows_affected: 0,
            truncated: false,
            row_limit: MAX_QUERY_RESULT_ROWS,
            elapsed_ms,
            message: None,
            error: Some(SqlErrorInfo {
                message: error.to_string(),
                code,
            }),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorExecutionResponse {
    pub results: Vec<StatementResult>,
    pub transaction_state: TransactionState,
    pub force_manual: bool,
    pub elapsed_ms: u64,
}

pub enum EditorConnection {
    Postgres(PoolConnection<Postgres>),
    MySql(PoolConnection<MySql>),
    Sqlite(PoolConnection<Sqlite>),
}

pub struct EditorSession {
    pub connection_id: String,
    connection: EditorConnection,
    transaction_state: TransactionState,
    mysql_autocommit: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ControlStatement {
    Begin,
    Commit,
    CommitAndChain,
    Rollback,
    RollbackAndChain,
    Other,
}

type SqlDialect = Dialect;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MySqlAutocommitChange {
    Unchanged,
    Set(bool),
    Dynamic,
}

impl EditorConnection {
    fn close_on_drop(&mut self) {
        match self {
            Self::Postgres(connection) => connection.close_on_drop(),
            Self::MySql(connection) => connection.close_on_drop(),
            Self::Sqlite(connection) => connection.close_on_drop(),
        }
    }
}

async fn acquire_connection(pool: &DbPool) -> Result<EditorConnection, String> {
    match pool {
        DbPool::Postgres(pool) => pool
            .acquire()
            .await
            .map(EditorConnection::Postgres)
            .map_err(|error| error.to_string()),
        DbPool::MySql(pool) => pool
            .acquire()
            .await
            .map(EditorConnection::MySql)
            .map_err(|error| error.to_string()),
        DbPool::Sqlite(pool) => pool
            .acquire()
            .await
            .map(EditorConnection::Sqlite)
            .map_err(|error| error.to_string()),
    }
}

fn connection_dialect(state: &AppState, connection_id: &str) -> Result<SqlDialect, String> {
    let pools = state.pools.lock().unwrap();
    pools
        .get(connection_id)
        .map(|pool| pool.dialect())
        .ok_or_else(|| "Connection not found".to_string())
}

async fn take_or_create_session(
    state: &AppState,
    editor_id: &str,
    connection_id: &str,
) -> Result<EditorSession, String> {
    if let Some(session) = state.editor_sessions.lock().await.remove(editor_id) {
        if session.connection_id != connection_id {
            state
                .editor_sessions
                .lock()
                .await
                .insert(editor_id.to_string(), session);
            return Err("Editor session belongs to a different connection".to_string());
        }
        return Ok(session);
    }

    let pool = {
        let pools = state.pools.lock().unwrap();
        pools
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "Connection not found".to_string())?
    };
    let connection = acquire_connection(&pool).await?;
    Ok(EditorSession {
        connection_id: connection_id.to_string(),
        connection,
        transaction_state: TransactionState::Inactive,
        mysql_autocommit: true,
    })
}

async fn put_session(state: &AppState, editor_id: &str, session: EditorSession) {
    state
        .editor_sessions
        .lock()
        .await
        .insert(editor_id.to_string(), session);
}

async fn take_session(state: &AppState, editor_id: &str) -> Result<EditorSession, String> {
    state
        .editor_sessions
        .lock()
        .await
        .remove(editor_id)
        .ok_or_else(|| "No active transaction".to_string())
}

async fn restore_on_error<T>(
    state: &AppState,
    editor_id: &str,
    session: EditorSession,
    result: Result<T, sqlx::Error>,
) -> Result<T, String> {
    match result {
        Ok(value) => Ok(value),
        Err(error) => {
            put_session(state, editor_id, session).await;
            Err(error.to_string())
        }
    }
}

async fn execute_control(connection: &mut EditorConnection, sql: &str) -> Result<u64, sqlx::Error> {
    match connection {
        EditorConnection::Postgres(connection) => sqlx::query(sqlx::AssertSqlSafe(sql))
            .execute(&mut **connection)
            .await
            .map(|r| r.rows_affected()),
        // MySQL rejects BEGIN/COMMIT/ROLLBACK through the prepared-statement protocol
        // (error 1295). raw_sql uses COM_QUERY (text protocol) instead.
        EditorConnection::MySql(connection) => sqlx::raw_sql(sqlx::AssertSqlSafe(sql))
            .execute(&mut **connection)
            .await
            .map(|r| r.rows_affected()),
        EditorConnection::Sqlite(connection) => sqlx::query(sqlx::AssertSqlSafe(sql))
            .execute(&mut **connection)
            .await
            .map(|r| r.rows_affected()),
    }
}

async fn begin_session(session: &mut EditorSession) -> Result<(), sqlx::Error> {
    execute_control(&mut session.connection, "BEGIN").await?;
    session.transaction_state = TransactionState::Active;
    Ok(())
}

async fn rollback_session(session: &mut EditorSession) -> Result<(), sqlx::Error> {
    match execute_control(&mut session.connection, "ROLLBACK").await {
        Ok(_) => {}
        Err(error)
            if matches!(session.connection, EditorConnection::Sqlite(_))
                && error.to_string().contains("no transaction is active") =>
        {
            session.transaction_state = TransactionState::Inactive;
            return Ok(());
        }
        Err(error) => return Err(error),
    }
    normalize_mysql_autocommit(session).await?;
    session.transaction_state = TransactionState::Inactive;
    Ok(())
}

async fn commit_session(session: &mut EditorSession) -> Result<(), sqlx::Error> {
    execute_control(&mut session.connection, "COMMIT").await?;
    normalize_mysql_autocommit(session).await?;
    session.transaction_state = TransactionState::Inactive;
    Ok(())
}

async fn normalize_mysql_autocommit(session: &mut EditorSession) -> Result<(), sqlx::Error> {
    if matches!(session.connection, EditorConnection::MySql(_)) && !session.mysql_autocommit {
        execute_control(&mut session.connection, "SET autocommit = 1").await?;
        session.mysql_autocommit = true;
    }
    Ok(())
}

fn cell(kind: &'static str, display: impl Into<String>) -> SqlCell {
    SqlCell {
        kind,
        display: Some(display.into()),
    }
}

fn null_cell() -> SqlCell {
    SqlCell {
        kind: "null",
        display: None,
    }
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789ABCDEF";
    let mut output = String::with_capacity(bytes.len() * 2 + 2);
    output.push_str("0x");
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}

fn decode_pg(row: &PgRow, index: usize) -> SqlCell {
    let raw = match row.try_get_raw(index) {
        Ok(raw) => raw,
        Err(error) => return cell("text", format!("<decode error: {error}>")),
    };
    if raw.is_null() {
        return null_cell();
    }
    let type_name = row.columns()[index].type_info().name().to_ascii_lowercase();
    macro_rules! decoded {
        ($ty:ty, $kind:literal) => {
            if let Ok(value) = row.try_get::<$ty, _>(index) {
                return cell($kind, value.to_string());
            }
        };
    }
    match type_name.as_str() {
        "bool" => decoded!(bool, "boolean"),
        "int2" => decoded!(i16, "number"),
        "int4" => decoded!(i32, "number"),
        "int8" => decoded!(i64, "number"),
        "float4" => decoded!(f32, "number"),
        "float8" => decoded!(f64, "number"),
        "numeric" => decoded!(BigDecimal, "number"),
        "uuid" => decoded!(Uuid, "text"),
        "date" => decoded!(NaiveDate, "text"),
        "time" => decoded!(NaiveTime, "text"),
        "timestamp" => decoded!(NaiveDateTime, "text"),
        "timestamptz" => decoded!(DateTime<Utc>, "text"),
        "json" | "jsonb" => decoded!(Value, "json"),
        "jsonb[]" | "json[]" => {
            if let Ok(values) = row.try_get::<Vec<Value>, _>(index) {
                return cell("json", serde_json::to_string(&values).unwrap_or_default());
            }
        }
        "text[]" | "varchar[]" | "bpchar[]" | "name[]" => {
            if let Ok(values) = row.try_get::<Vec<String>, _>(index) {
                return cell("text", serde_json::to_string(&values).unwrap_or_default());
            }
        }
        "bytea" => {
            if let Ok(value) = row.try_get::<Vec<u8>, _>(index) {
                return cell("binary", hex(&value));
            }
        }
        _ => decoded!(String, "text"),
    }
    match raw.as_bytes() {
        Ok(bytes) => match std::str::from_utf8(bytes) {
            Ok(text) => cell("text", text),
            Err(_) => cell("binary", hex(bytes)),
        },
        Err(error) => cell("text", format!("<unsupported {type_name}: {error}>")),
    }
}

fn decode_mysql(row: &MySqlRow, index: usize) -> SqlCell {
    if row.try_get_raw(index).map_or(true, |raw| raw.is_null()) {
        return null_cell();
    }
    let type_name = row.columns()[index].type_info().name().to_ascii_lowercase();
    macro_rules! decoded {
        ($ty:ty, $kind:literal) => {
            if let Ok(value) = row.try_get::<$ty, _>(index) {
                return cell($kind, value.to_string());
            }
        };
    }
    match type_name.as_str() {
        "boolean" | "bool" => decoded!(bool, "boolean"),
        "tinyint" | "tinyint unsigned" | "smallint" | "smallint unsigned" | "mediumint"
        | "mediumint unsigned" | "int" | "int unsigned" | "bigint" | "bigint unsigned" => {
            decoded!(i64, "number");
            decoded!(u64, "number");
        }
        "float" | "double" => {
            decoded!(f64, "number");
            decoded!(String, "text");
        }
        "decimal" | "newdecimal" => {
            decoded!(BigDecimal, "number");
            decoded!(String, "text");
        }
        "date" => {
            decoded!(NaiveDate, "text");
            decoded!(String, "text");
        }
        "time" => {
            decoded!(NaiveTime, "text");
            decoded!(String, "text");
        }
        "datetime" => {
            decoded!(NaiveDateTime, "text");
            decoded!(String, "text");
        }
        "timestamp" => {
            if let Ok(value) = row.try_get::<DateTime<Utc>, _>(index) {
                return cell("text", value.format("%Y-%m-%d %H:%M:%S").to_string());
            }
            decoded!(NaiveDateTime, "text");
            decoded!(String, "text");
        }
        "json" => {
            decoded!(Value, "json");
            decoded!(String, "text");
        }
        "tinyblob" | "blob" | "mediumblob" | "longblob" | "binary" | "varbinary" => {
            if let Ok(value) = row.try_get::<Vec<u8>, _>(index) {
                return cell("binary", hex(&value));
            }
        }
        _ => decoded!(String, "text"),
    }
    cell("text", format!("<unsupported {type_name} value>"))
}

fn decode_sqlite(row: &SqliteRow, index: usize) -> SqlCell {
    if row.try_get_raw(index).map_or(true, |raw| raw.is_null()) {
        return null_cell();
    }
    let type_name = row.columns()[index].type_info().name().to_ascii_lowercase();
    match type_name.as_str() {
        "boolean" | "bool" => row
            .try_get::<bool, _>(index)
            .map(|value| cell("boolean", value.to_string()))
            .unwrap_or_else(|_| {
                row.try_get::<i64, _>(index)
                    .map(|value| {
                        cell(
                            "boolean",
                            if value != 0 { "true" } else { "false" }.to_string(),
                        )
                    })
                    .unwrap_or_else(|error| cell("text", format!("<decode error: {error}>")))
            }),
        "integer" | "int" => row
            .try_get::<i64, _>(index)
            .map(|value| cell("number", value.to_string()))
            .unwrap_or_else(|error| cell("text", format!("<decode error: {error}>"))),
        "real" | "float" => row
            .try_get::<f64, _>(index)
            .map(|value| cell("number", value.to_string()))
            .unwrap_or_else(|error| cell("text", format!("<decode error: {error}>"))),
        "blob" => row
            .try_get::<Vec<u8>, _>(index)
            .map(|value| cell("binary", hex(&value)))
            .unwrap_or_else(|error| cell("text", format!("<decode error: {error}>"))),
        _ => row
            .try_get::<String, _>(index)
            .map(|value| cell("text", value))
            .unwrap_or_else(|error| cell("text", format!("<decode error: {error}>"))),
    }
}

fn columns_from_row<R: Row>(
    row: &R,
    primary_columns: &HashSet<String>,
    dialect: Dialect,
) -> Vec<SqlResultColumn> {
    row.columns()
        .iter()
        .map(|column| SqlResultColumn {
            name: column.name().to_string(),
            data_type: normalize_type(dialect, column.type_info().name()),
            is_primary: primary_columns.contains(column.name()),
        })
        .collect()
}

fn sql_tokens(sql: &str) -> Vec<String> {
    let chars: Vec<char> = sql.chars().collect();
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        let character = chars[index];
        if character.is_whitespace() {
            index += 1;
            continue;
        }
        if character == '-' && chars.get(index + 1) == Some(&'-') {
            index += 2;
            while index < chars.len() && chars[index] != '\n' {
                index += 1;
            }
            continue;
        }
        if character == '/' && chars.get(index + 1) == Some(&'*') {
            index += 2;
            while index + 1 < chars.len() && !(chars[index] == '*' && chars[index + 1] == '/') {
                index += 1;
            }
            index = (index + 2).min(chars.len());
            continue;
        }
        if character == '\'' {
            index += 1;
            while index < chars.len() {
                if chars[index] == '\\' {
                    index += 2;
                } else if chars[index] == '\'' {
                    if chars.get(index + 1) == Some(&'\'') {
                        index += 2;
                    } else {
                        index += 1;
                        break;
                    }
                } else {
                    index += 1;
                }
            }
            continue;
        }
        if character == '"' || character == '`' {
            let quote = character;
            index += 1;
            let mut identifier = String::new();
            while index < chars.len() {
                if chars[index] == quote {
                    if chars.get(index + 1) == Some(&quote) {
                        identifier.push(quote);
                        index += 2;
                    } else {
                        index += 1;
                        break;
                    }
                } else {
                    identifier.push(chars[index]);
                    index += 1;
                }
            }
            tokens.push(identifier);
            continue;
        }
        if character.is_alphanumeric() || character == '_' || character == '$' {
            let start = index;
            index += 1;
            while index < chars.len()
                && (chars[index].is_alphanumeric() || chars[index] == '_' || chars[index] == '$')
            {
                index += 1;
            }
            tokens.push(chars[start..index].iter().collect());
            continue;
        }
        if matches!(character, '.' | '(' | ')' | ',') {
            tokens.push(character.to_string());
        }
        index += 1;
    }
    tokens
}

fn source_tables(sql: &str) -> Vec<String> {
    let tokens = sql_tokens(sql);
    let mut tables = Vec::new();
    let mut index = 0;
    while index < tokens.len() {
        let keyword = tokens[index].to_ascii_uppercase();
        if keyword != "FROM" && keyword != "JOIN" {
            index += 1;
            continue;
        }
        index += 1;
        while tokens
            .get(index)
            .is_some_and(|token| matches!(token.to_ascii_uppercase().as_str(), "ONLY" | "LATERAL"))
        {
            index += 1;
        }
        if tokens.get(index).map(String::as_str) == Some("(") {
            continue;
        }
        let Some(mut table) = tokens.get(index).cloned() else {
            break;
        };
        if tokens.get(index + 1).map(String::as_str) == Some(".") {
            if let Some(name) = tokens.get(index + 2) {
                table = name.clone();
            }
        }
        if !tables.contains(&table) {
            tables.push(table);
        }
        index += 1;
    }
    tables
}

macro_rules! execute_statement {
    ($fn_name:ident, $connection:ty, $row:ty, $decoder:ident, $primary_columns:ident, $dialect:expr) => {
        async fn $fn_name(
            connection: &mut $connection,
            sql: &str,
            index: usize,
        ) -> StatementResult {
            let started = Instant::now();
            let described = connection
                .describe(sqlx::AssertSqlSafe(sql).into_sql_str())
                .await;
            let primary_columns = if described
                .as_ref()
                .is_ok_and(|description| !description.columns().is_empty())
            {
                $primary_columns(connection, &source_tables(sql)).await
            } else {
                HashSet::new()
            };
            let described_columns = described
                .map(|description| {
                    description
                        .columns()
                        .iter()
                        .map(|column| SqlResultColumn {
                            name: column.name().to_string(),
                            data_type: normalize_type($dialect, column.type_info().name()),
                            is_primary: primary_columns.contains(column.name()),
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let mut columns = described_columns;
            let mut rows = Vec::new();
            let mut row_count = 0_u64;
            let mut rows_affected = 0_u64;
            if columns.is_empty() {
                match sqlx::query(sqlx::AssertSqlSafe(sql))
                    .execute(&mut *connection)
                    .await
                {
                    Ok(result) => rows_affected = result.rows_affected(),
                    Err(error) => {
                        return StatementResult::error(
                            index,
                            error,
                            started.elapsed().as_millis() as u64,
                        )
                    }
                }
            } else {
                let mut stream = sqlx::query(sqlx::AssertSqlSafe(sql)).fetch(&mut *connection);
                while let Some(item) = stream.next().await {
                    match item {
                        Ok(row) => {
                            if columns.is_empty() {
                                columns = columns_from_row(&row, &primary_columns, $dialect);
                            }
                            row_count += 1;
                            if rows.len() < MAX_QUERY_RESULT_ROWS {
                                rows.push(
                                    (0..row.len())
                                        .map(|cell_index| $decoder(&row, cell_index))
                                        .collect(),
                                );
                            }
                        }
                        Err(error) => {
                            return StatementResult::error(
                                index,
                                error,
                                started.elapsed().as_millis() as u64,
                            )
                        }
                    }
                }
            }
            StatementResult {
                index,
                kind: if columns.is_empty() {
                    "affected"
                } else {
                    "rows"
                },
                columns,
                rows,
                row_count,
                rows_affected,
                truncated: row_count > MAX_QUERY_RESULT_ROWS as u64,
                row_limit: MAX_QUERY_RESULT_ROWS,
                elapsed_ms: started.elapsed().as_millis() as u64,
                message: None,
                error: None,
            }
        }
    };
}

execute_statement!(
    execute_pg,
    PgConnection,
    PgRow,
    decode_pg,
    pg_primary_columns,
    Dialect::Postgres
);
execute_statement!(
    execute_mysql,
    MySqlConnection,
    MySqlRow,
    decode_mysql,
    mysql_primary_columns,
    Dialect::MySql
);
execute_statement!(
    execute_sqlite,
    SqliteConnection,
    SqliteRow,
    decode_sqlite,
    sqlite_primary_columns,
    Dialect::Sqlite
);

async fn run_statement(
    connection: &mut EditorConnection,
    sql: &str,
    index: usize,
    control: ControlStatement,
) -> StatementResult {
    if control != ControlStatement::Other {
        let started = Instant::now();
        return match execute_control(connection, sql).await {
            Ok(rows_affected) => StatementResult {
                index,
                kind: "affected",
                columns: vec![],
                rows: vec![],
                row_count: 0,
                rows_affected,
                truncated: false,
                row_limit: MAX_QUERY_RESULT_ROWS,
                elapsed_ms: started.elapsed().as_millis() as u64,
                message: None,
                error: None,
            },
            Err(error) => {
                StatementResult::error(index, error, started.elapsed().as_millis() as u64)
            }
        };
    }
    match connection {
        EditorConnection::Postgres(connection) => execute_pg(connection, sql, index).await,
        EditorConnection::MySql(connection) => execute_mysql(connection, sql, index).await,
        EditorConnection::Sqlite(connection) => execute_sqlite(connection, sql, index).await,
    }
}

#[derive(Clone, Copy)]
enum CommentScanState {
    Normal,
    SingleQuote,
    DoubleQuote,
    Backtick,
    LineComment,
    BlockComment(usize),
}

fn sql_without_comments(sql: &str, dialect: SqlDialect) -> String {
    let bytes = sql.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut state = CommentScanState::Normal;
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        match state {
            CommentScanState::Normal => match byte {
                b'\'' => {
                    output.push(byte);
                    state = CommentScanState::SingleQuote;
                }
                b'"' => {
                    output.push(byte);
                    state = CommentScanState::DoubleQuote;
                }
                b'`' => {
                    output.push(byte);
                    state = CommentScanState::Backtick;
                }
                b'-' if bytes.get(index + 1) == Some(&b'-') => {
                    output.extend_from_slice(b"  ");
                    index += 1;
                    state = CommentScanState::LineComment;
                }
                b'#' if dialect == SqlDialect::MySql => {
                    output.push(b' ');
                    state = CommentScanState::LineComment;
                }
                b'/' if bytes.get(index + 1) == Some(&b'*') => {
                    output.extend_from_slice(b"  ");
                    index += 1;
                    state = CommentScanState::BlockComment(1);
                }
                _ => output.push(byte),
            },
            CommentScanState::SingleQuote => {
                output.push(byte);
                if byte == b'\\' && index + 1 < bytes.len() {
                    index += 1;
                    output.push(bytes[index]);
                } else if byte == b'\'' {
                    if bytes.get(index + 1) == Some(&b'\'') {
                        index += 1;
                        output.push(bytes[index]);
                    } else {
                        state = CommentScanState::Normal;
                    }
                }
            }
            CommentScanState::DoubleQuote | CommentScanState::Backtick => {
                output.push(byte);
                let quote = if matches!(state, CommentScanState::DoubleQuote) {
                    b'"'
                } else {
                    b'`'
                };
                if byte == quote {
                    if bytes.get(index + 1) == Some(&quote) {
                        index += 1;
                        output.push(bytes[index]);
                    } else {
                        state = CommentScanState::Normal;
                    }
                }
            }
            CommentScanState::LineComment => {
                if byte == b'\n' {
                    output.push(byte);
                    state = CommentScanState::Normal;
                } else {
                    output.push(b' ');
                }
            }
            CommentScanState::BlockComment(mut depth) => {
                output.push(b' ');
                if byte == b'/' && bytes.get(index + 1) == Some(&b'*') {
                    output.push(b' ');
                    index += 1;
                    depth += 1;
                } else if byte == b'*' && bytes.get(index + 1) == Some(&b'/') {
                    output.push(b' ');
                    index += 1;
                    depth -= 1;
                }
                state = if depth == 0 {
                    CommentScanState::Normal
                } else {
                    CommentScanState::BlockComment(depth)
                };
            }
        }
        index += 1;
    }
    String::from_utf8(output).expect("comment stripping preserves UTF-8")
}

fn first_words(sql: &str, count: usize, dialect: SqlDialect) -> Vec<String> {
    sql_without_comments(sql, dialect)
        .split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        .filter(|word| !word.is_empty())
        .take(count)
        .map(str::to_ascii_uppercase)
        .collect()
}

fn has_chain_clause(words: &[String]) -> bool {
    words
        .windows(2)
        .any(|window| window[0] == "AND" && window[1] == "CHAIN")
}

fn classify_control(sql: &str, dialect: SqlDialect) -> ControlStatement {
    let words = first_words(sql, 6, dialect);
    let chained = has_chain_clause(&words);
    match words.first().map(String::as_str) {
        Some("BEGIN") => ControlStatement::Begin,
        Some("START") if words.get(1).map(String::as_str) == Some("TRANSACTION") => {
            ControlStatement::Begin
        }
        Some("COMMIT") | Some("END") if chained => ControlStatement::CommitAndChain,
        Some("COMMIT") | Some("END") => ControlStatement::Commit,
        Some("ROLLBACK") if words.get(1).map(String::as_str) != Some("TO") && chained => {
            ControlStatement::RollbackAndChain
        }
        Some("ROLLBACK") if words.get(1).map(String::as_str) != Some("TO") => {
            ControlStatement::Rollback
        }
        _ => ControlStatement::Other,
    }
}

fn mysql_implicitly_commits(sql: &str) -> bool {
    let words = first_words(sql, 4, SqlDialect::MySql);
    if matches!(words.first().map(String::as_str), Some("CREATE" | "DROP"))
        && words.get(1).map(String::as_str) == Some("TEMPORARY")
        && words.get(2).map(String::as_str) == Some("TABLE")
    {
        return false;
    }

    matches!(
        words.first().map(String::as_str),
        Some(
            "ALTER"
                | "ANALYZE"
                | "CACHE"
                | "CHANGE"
                | "CREATE"
                | "DROP"
                | "FLUSH"
                | "GRANT"
                | "INSTALL"
                | "LOAD"
                | "LOCK"
                | "OPTIMIZE"
                | "RENAME"
                | "REPAIR"
                | "RESET"
                | "REVOKE"
                | "TRUNCATE"
                | "UNINSTALL"
                | "UNLOCK"
        )
    )
}

fn mysql_autocommit_change(sql: &str) -> MySqlAutocommitChange {
    let words = first_words(sql, 8, SqlDialect::MySql);
    if words.first().map(String::as_str) != Some("SET") {
        return MySqlAutocommitChange::Unchanged;
    }
    let Some(autocommit_index) = words.iter().position(|word| word == "AUTOCOMMIT") else {
        return MySqlAutocommitChange::Unchanged;
    };
    if words[..autocommit_index]
        .iter()
        .any(|word| word == "GLOBAL")
    {
        return MySqlAutocommitChange::Unchanged;
    }
    match words.get(autocommit_index + 1).map(String::as_str) {
        Some("1" | "ON" | "TRUE") => MySqlAutocommitChange::Set(true),
        Some("0" | "OFF" | "FALSE") => MySqlAutocommitChange::Set(false),
        _ => MySqlAutocommitChange::Dynamic,
    }
}

fn apply_pre_execution_state(
    dialect: SqlDialect,
    statement: &str,
    transaction_state: &mut TransactionState,
    mysql_autocommit: bool,
) -> bool {
    let implicit_commit = dialect == SqlDialect::MySql
        && *transaction_state != TransactionState::Inactive
        && mysql_implicitly_commits(statement);
    if implicit_commit {
        *transaction_state = if mysql_autocommit {
            TransactionState::Inactive
        } else {
            TransactionState::Active
        };
    }
    implicit_commit
}

fn apply_successful_statement_state(
    dialect: SqlDialect,
    statement: &str,
    control: ControlStatement,
    transaction_state: &mut TransactionState,
    mysql_autocommit: &mut bool,
) {
    match control {
        ControlStatement::Begin
        | ControlStatement::CommitAndChain
        | ControlStatement::RollbackAndChain => *transaction_state = TransactionState::Active,
        ControlStatement::Commit | ControlStatement::Rollback => {
            *transaction_state = if dialect == SqlDialect::MySql && !*mysql_autocommit {
                TransactionState::Active
            } else {
                TransactionState::Inactive
            };
        }
        ControlStatement::Other if dialect == SqlDialect::MySql => {
            match mysql_autocommit_change(statement) {
                MySqlAutocommitChange::Set(enabled) => {
                    *mysql_autocommit = enabled;
                    *transaction_state = if enabled {
                        TransactionState::Inactive
                    } else {
                        TransactionState::Active
                    };
                }
                MySqlAutocommitChange::Dynamic => {
                    // Pin ambiguous session-level assignments and normalize them
                    // when the user commits, rolls back, or closes the tab.
                    *mysql_autocommit = false;
                    *transaction_state = TransactionState::Active;
                }
                MySqlAutocommitChange::Unchanged if !*mysql_autocommit => {
                    *transaction_state = TransactionState::Active;
                }
                MySqlAutocommitChange::Unchanged => {}
            }
        }
        ControlStatement::Other => {}
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum ScanState {
    Normal,
    SingleQuote,
    DoubleQuote,
    Backtick,
    LineComment,
    BlockComment(usize),
    DollarQuote(String),
}

fn split_statements(sql: &str, dialect: SqlDialect) -> Vec<String> {
    let bytes = sql.as_bytes();
    let mut state = ScanState::Normal;
    let mut statements = Vec::new();
    let mut start = 0;
    let mut index = 0;
    while index < bytes.len() {
        match &mut state {
            ScanState::Normal => match bytes[index] {
                b'\'' => state = ScanState::SingleQuote,
                b'"' => state = ScanState::DoubleQuote,
                b'`' => state = ScanState::Backtick,
                b'-' if bytes.get(index + 1) == Some(&b'-') => {
                    state = ScanState::LineComment;
                    index += 1;
                }
                b'#' if dialect == SqlDialect::MySql => state = ScanState::LineComment,
                b'/' if bytes.get(index + 1) == Some(&b'*') => {
                    state = ScanState::BlockComment(1);
                    index += 1;
                }
                b'$' => {
                    if let Some(relative_end) =
                        bytes[index + 1..].iter().position(|byte| *byte == b'$')
                    {
                        let end = index + 1 + relative_end;
                        let tag = &sql[index..=end];
                        if tag[1..tag.len() - 1]
                            .chars()
                            .all(|character| character.is_ascii_alphanumeric() || character == '_')
                        {
                            state = ScanState::DollarQuote(tag.to_string());
                            index = end;
                        }
                    }
                }
                b';' => {
                    let statement = sql[start..index].trim();
                    if !statement.is_empty() && !first_words(statement, 1, dialect).is_empty() {
                        statements.push(statement.to_string());
                    }
                    start = index + 1;
                }
                _ => {}
            },
            ScanState::SingleQuote => match bytes[index] {
                b'\\' => index += usize::from(index + 1 < bytes.len()),
                b'\'' if bytes.get(index + 1) == Some(&b'\'') => index += 1,
                b'\'' => state = ScanState::Normal,
                _ => {}
            },
            ScanState::DoubleQuote => {
                if bytes[index] == b'"' {
                    if bytes.get(index + 1) == Some(&b'"') {
                        index += 1;
                    } else {
                        state = ScanState::Normal;
                    }
                }
            }
            ScanState::Backtick => {
                if bytes[index] == b'`' {
                    if bytes.get(index + 1) == Some(&b'`') {
                        index += 1;
                    } else {
                        state = ScanState::Normal;
                    }
                }
            }
            ScanState::LineComment => {
                if bytes[index] == b'\n' {
                    state = ScanState::Normal;
                }
            }
            ScanState::BlockComment(depth) => {
                if bytes[index] == b'/' && bytes.get(index + 1) == Some(&b'*') {
                    *depth += 1;
                    index += 1;
                } else if bytes[index] == b'*' && bytes.get(index + 1) == Some(&b'/') {
                    *depth -= 1;
                    index += 1;
                    if *depth == 0 {
                        state = ScanState::Normal;
                    }
                }
            }
            ScanState::DollarQuote(tag) => {
                if sql[index..].starts_with(tag.as_str()) {
                    index += tag.len() - 1;
                    state = ScanState::Normal;
                }
            }
        }
        index += 1;
    }
    let statement = sql[start..].trim();
    if !statement.is_empty() && !first_words(statement, 1, dialect).is_empty() {
        statements.push(statement.to_string());
    }
    statements
}

#[tauri::command]
pub async fn execute_editor_sql(
    connection_id: String,
    editor_id: String,
    sql: String,
    mode: EditorMode,
    state: tauri::State<'_, AppState>,
) -> Result<EditorExecutionResponse, String> {
    let dialect = connection_dialect(&state, &connection_id)?;
    let statements = split_statements(&sql, dialect);
    if statements.is_empty() {
        return Err("Enter a SQL statement to run".to_string());
    }
    let total_started = Instant::now();
    let mut session = take_or_create_session(&state, &editor_id, &connection_id).await?;
    let mut results = Vec::with_capacity(statements.len());

    for (offset, statement) in statements.into_iter().enumerate() {
        let index = offset + 1;
        let control = classify_control(&statement, dialect);
        if mode == EditorMode::Manual
            && session.transaction_state == TransactionState::Inactive
            && control == ControlStatement::Other
        {
            if let Err(error) = begin_session(&mut session).await {
                results.push(StatementResult::error(index, error, 0));
                break;
            }
        }

        let mysql_implicit_commit = apply_pre_execution_state(
            dialect,
            &statement,
            &mut session.transaction_state,
            session.mysql_autocommit,
        );

        let mut result = run_statement(&mut session.connection, &statement, index, control).await;
        if mysql_implicit_commit {
            result.message = Some(
                "MySQL implicitly committed the previous transaction before this statement"
                    .to_string(),
            );
        }
        let failed = result.error.is_some();

        if failed {
            if session.transaction_state != TransactionState::Inactive
                && dialect == SqlDialect::Postgres
            {
                session.transaction_state = TransactionState::Failed;
            }
            results.push(result);
            break;
        }

        apply_successful_statement_state(
            dialect,
            &statement,
            control,
            &mut session.transaction_state,
            &mut session.mysql_autocommit,
        );
        results.push(result);
    }

    let transaction_state = session.transaction_state;
    if transaction_state != TransactionState::Inactive {
        put_session(&state, &editor_id, session).await;
    }

    Ok(EditorExecutionResponse {
        results,
        transaction_state,
        force_manual: transaction_state != TransactionState::Inactive,
        elapsed_ms: total_started.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
pub async fn begin_editor_transaction(
    connection_id: String,
    editor_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<TransactionState, String> {
    let mut session = take_or_create_session(&state, &editor_id, &connection_id).await?;
    if session.transaction_state != TransactionState::Inactive {
        put_session(&state, &editor_id, session).await;
        return Err("A transaction is already active".to_string());
    }
    let result = begin_session(&mut session).await;
    if let Err(error) = result {
        return Err(error.to_string());
    }
    let transaction_state = session.transaction_state;
    put_session(&state, &editor_id, session).await;
    Ok(transaction_state)
}

#[tauri::command]
pub async fn commit_editor_transaction(
    editor_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<TransactionState, String> {
    let mut session = take_session(&state, &editor_id).await?;
    if session.transaction_state == TransactionState::Failed {
        put_session(&state, &editor_id, session).await;
        return Err("The transaction failed and must be rolled back".to_string());
    }
    let result = commit_session(&mut session).await;
    restore_on_error(&state, &editor_id, session, result).await?;
    Ok(TransactionState::Inactive)
}

#[tauri::command]
pub async fn rollback_editor_transaction(
    editor_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<TransactionState, String> {
    let mut session = take_session(&state, &editor_id).await?;
    let result = rollback_session(&mut session).await;
    restore_on_error(&state, &editor_id, session, result).await?;
    Ok(TransactionState::Inactive)
}

#[tauri::command]
pub async fn discard_editor_session(
    editor_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let session = state.editor_sessions.lock().await.remove(&editor_id);
    if let Some(session) = session {
        discard_session(session).await?;
    }
    Ok(())
}

async fn discard_session(mut session: EditorSession) -> Result<(), String> {
    if session.transaction_state == TransactionState::Inactive {
        return Ok(());
    }
    if let Err(error) = rollback_session(&mut session).await {
        session.connection.close_on_drop();
        return Err(format!(
            "Failed to roll back discarded editor session: {error}"
        ));
    }
    Ok(())
}

pub async fn discard_sessions_for_connection(state: &AppState, connection_id: &str) {
    let sessions = {
        let mut all_sessions = state.editor_sessions.lock().await;
        let editor_ids = all_sessions
            .iter()
            .filter(|(_, session)| session.connection_id == connection_id)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        editor_ids
            .into_iter()
            .filter_map(|editor_id| all_sessions.remove(&editor_id))
            .collect::<Vec<_>>()
    };

    for session in sessions {
        // Failed connections are already marked close-on-drop by discard_session.
        let _ = discard_session(session).await;
    }
}

#[cfg(test)]
#[path = "test/editor.test.rs"]
mod tests;

#[cfg(test)]
#[path = "test/mysql_integration.test.rs"]
mod mysql_integration_tests;

#[cfg(test)]
#[path = "test/postgres_integration.test.rs"]
mod postgres_integration_tests;

#[cfg(test)]
#[path = "test/sqlite_integration.test.rs"]
mod sqlite_integration_tests;
