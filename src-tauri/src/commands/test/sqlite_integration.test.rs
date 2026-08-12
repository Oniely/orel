use super::{
    begin_session, execute_sqlite, rollback_session, EditorConnection, EditorSession,
    TransactionState,
};
use sqlx::{sqlite::SqlitePoolOptions, Connection, SqliteConnection};

// Complements the existing SQLite tests (editor.test.rs) with scenarios that
// exercise the session across multiple write/read operations.

// Rows inserted inside BEGIN are visible on the same connection before COMMIT.
#[tokio::test]
async fn write_read_roundtrip_in_transaction() {
    let mut conn = SqliteConnection::connect(":memory:").await.unwrap();
    sqlx::query("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)")
        .execute(&mut conn)
        .await
        .unwrap();

    // BEGIN via raw execute to avoid needing a PoolConnection for this check.
    sqlx::query("BEGIN").execute(&mut conn).await.unwrap();
    sqlx::query("INSERT INTO items (name) VALUES ('in_flight')")
        .execute(&mut conn)
        .await
        .unwrap();

    // The row is visible on the same connection inside the transaction.
    let result = execute_sqlite(&mut conn, "SELECT * FROM items", 0).await;
    assert_eq!(result.kind, "rows");
    assert_eq!(result.row_count, 1);
    assert!(result.error.is_none());

    sqlx::query("ROLLBACK").execute(&mut conn).await.unwrap();

    // After rollback the row is gone.
    let after = execute_sqlite(&mut conn, "SELECT * FROM items", 0).await;
    assert_eq!(after.row_count, 0);
}

// Multiple inserts inside a session transaction all roll back together.
#[tokio::test]
async fn rollback_undoes_multiple_inserts() {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect(":memory:")
        .await
        .unwrap();
    let mut conn = pool.acquire().await.unwrap();
    sqlx::query("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)")
        .execute(&mut *conn)
        .await
        .unwrap();

    let mut session = EditorSession {
        connection_id: "test".to_string(),
        connection: EditorConnection::Sqlite(conn),
        transaction_state: TransactionState::Inactive,
        mysql_autocommit: true,
    };

    begin_session(&mut session).await.unwrap();
    if let EditorConnection::Sqlite(ref mut c) = session.connection {
        for name in ["a", "b", "c"] {
            sqlx::query("INSERT INTO items (name) VALUES (?)")
                .bind(name)
                .execute(&mut **c)
                .await
                .unwrap();
        }
    }
    rollback_session(&mut session).await.unwrap();

    assert_eq!(session.transaction_state, TransactionState::Inactive);
    if let EditorConnection::Sqlite(ref mut c) = session.connection {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM items")
            .fetch_one(&mut **c)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }
}
