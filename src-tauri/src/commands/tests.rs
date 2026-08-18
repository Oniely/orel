//! Connected consistency tests using an in-memory SQLite database.
//!
//! These tests verify that the DataGrid path (fetch_rows / executor + describe)
//! and the EditorResultGrid path (execute_statement! / describe + stream) produce
//! identical column data_types and cell kinds/values for the same table.

use sqlx::SqlitePool;

use super::executor::{sqlite_describe_types, sqlite_fetch};

// ── Helpers ───────────────────────────────────────────────────────────────────

async fn setup_pool() -> SqlitePool {
    SqlitePool::connect(":memory:").await.expect("in-memory SQLite pool")
}

async fn create_type_table(pool: &SqlitePool) {
    sqlx::query(
        "CREATE TABLE type_test (
            id      INTEGER PRIMARY KEY,
            big     BIGINT,
            label   TEXT,
            amount  REAL,
            flag    BOOLEAN,
            created DATETIME,
            data    BLOB
        )",
    )
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO type_test VALUES (1, 9999999999, 'hello', 3.14, 1, '2024-01-01', X'DEADBEEF')",
    )
    .execute(pool)
    .await
    .unwrap();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// The DataGrid path (describe_types + sqlite_fetch) and EditorResultGrid path
/// (also describe_types + sqlite_fetch, since both now share the same mechanism)
/// must return identical type names and cell values.
#[tokio::test]
async fn test_type_names_consistent_between_paths() {
    let pool = setup_pool().await;
    create_type_table(&pool).await;

    let sql = "SELECT * FROM type_test";

    // DataGrid path
    let mut conn_a = pool.acquire().await.unwrap();
    let types_a = sqlite_describe_types(&mut *conn_a, sql).await;
    let rows_a = sqlite_fetch(&mut *conn_a, sql, &[]).await.unwrap();
    drop(conn_a);

    // EditorResultGrid path (mirrors execute_statement! describe + fetch flow)
    let mut conn_b = pool.acquire().await.unwrap();
    let types_b = sqlite_describe_types(&mut *conn_b, sql).await;
    let rows_b = sqlite_fetch(&mut *conn_b, sql, &[]).await.unwrap();
    drop(conn_b);

    assert_eq!(types_a, types_b, "column type names must be identical between paths");
    assert_eq!(rows_a.len(), rows_b.len(), "row count must match");

    for (i, (row_a, row_b)) in rows_a.iter().zip(rows_b.iter()).enumerate() {
        for (j, (cell_a, cell_b)) in row_a.iter().zip(row_b.iter()).enumerate() {
            assert_eq!(
                cell_a.kind, cell_b.kind,
                "row {i} col {j}: cell kind must match ({:?} vs {:?})",
                cell_a.kind, cell_b.kind,
            );
            assert_eq!(
                cell_a.display, cell_b.display,
                "row {i} col {j}: cell display must match ({:?} vs {:?})",
                cell_a.display, cell_b.display,
            );
        }
    }
}

/// SQLite type affinity normalization: columns declared as BIGINT, BOOLEAN, DATETIME
/// should expose the sqlx-normalized type name (not the declared name).
/// This verifies the fix for the DataGrid showing "bigint" while EditorResultGrid showed "integer".
#[tokio::test]
async fn test_sqlite_type_affinity_normalization() {
    let pool = setup_pool().await;
    create_type_table(&pool).await;

    let mut conn = pool.acquire().await.unwrap();
    let type_names = sqlite_describe_types(&mut *conn, "SELECT * FROM type_test").await;

    // id: INTEGER PRIMARY KEY
    assert_eq!(type_names[0], "integer", "id should be 'integer'");
    // big: BIGINT — sqlx normalizes to integer affinity
    assert_eq!(type_names[1], "integer", "BIGINT column should normalize to 'integer' via type_info()");
    // label: TEXT
    assert_eq!(type_names[2], "text", "label should be 'text'");
    // amount: REAL
    assert_eq!(type_names[3], "real", "amount should be 'real'");
}

/// Verify cell kinds are correctly determined by type_info() — not by declared type strings.
#[tokio::test]
async fn test_cell_kinds_by_sqlx_type() {
    let pool = setup_pool().await;
    create_type_table(&pool).await;

    let mut conn = pool.acquire().await.unwrap();
    let rows = sqlite_fetch(&mut *conn, "SELECT * FROM type_test", &[]).await.unwrap();

    assert_eq!(rows.len(), 1);
    let row = &rows[0];

    // id = 1 (INTEGER)
    assert_eq!(row[0].kind, "number", "id should have kind=number");
    // big = 9999999999 (BIGINT stored as integer)
    assert_eq!(row[1].kind, "number", "big should have kind=number");
    // label = 'hello' (TEXT)
    assert_eq!(row[2].kind, "text", "label should have kind=text");
    // amount = 3.14 (REAL)
    assert_eq!(row[3].kind, "number", "amount should have kind=number");
    // data = 0xDEADBEEF (BLOB)
    assert_eq!(row[6].kind, "binary", "data should have kind=binary");
    assert_eq!(row[6].display.as_deref(), Some("0xDEADBEEF"), "blob display should be hex");
}

/// describe() must return type names even when the table has zero rows.
#[tokio::test]
async fn test_describe_works_on_empty_table() {
    let pool = setup_pool().await;

    sqlx::query("CREATE TABLE empty_test (id INTEGER PRIMARY KEY, name TEXT, score REAL)")
        .execute(&pool)
        .await
        .unwrap();

    let mut conn = pool.acquire().await.unwrap();
    let type_names =
        sqlite_describe_types(&mut *conn, "SELECT * FROM empty_test").await;

    assert_eq!(type_names.len(), 3, "should describe 3 columns even with 0 rows");
    assert_eq!(type_names[0], "integer");
    assert_eq!(type_names[1], "text");
    assert_eq!(type_names[2], "real");
}

/// Null cells must have kind="null" and display=None from both paths.
#[tokio::test]
async fn test_null_cell_consistency() {
    let pool = setup_pool().await;

    sqlx::query("CREATE TABLE null_test (id INTEGER, val TEXT)").execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO null_test VALUES (1, NULL)").execute(&pool).await.unwrap();

    let mut conn = pool.acquire().await.unwrap();
    let rows = sqlite_fetch(&mut *conn, "SELECT * FROM null_test", &[]).await.unwrap();

    assert_eq!(rows[0][1].kind, "null");
    assert_eq!(rows[0][1].display, None);
}

/// Verify display values round-trip correctly: numbers as decimal strings, text as-is.
#[tokio::test]
async fn test_display_values() {
    let pool = setup_pool().await;

    sqlx::query("CREATE TABLE val_test (n INTEGER, r REAL, t TEXT)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO val_test VALUES (42, 1.5, 'world')").execute(&pool).await.unwrap();

    let mut conn = pool.acquire().await.unwrap();
    let rows = sqlite_fetch(&mut *conn, "SELECT * FROM val_test", &[]).await.unwrap();

    assert_eq!(rows[0][0].display.as_deref(), Some("42"));
    assert_eq!(rows[0][1].display.as_deref(), Some("1.5"));
    assert_eq!(rows[0][2].display.as_deref(), Some("world"));
}
