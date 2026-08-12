use super::{
    begin_session, commit_session, execute_pg, rollback_session, split_statements,
    EditorConnection, EditorSession, SqlDialect, TransactionState,
};
use sqlx::postgres::PgPoolOptions;
use testcontainers_modules::{postgres::Postgres, testcontainers::runners::AsyncRunner};

async fn make_session(url: &str) -> EditorSession {
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(url)
        .await
        .unwrap();
    let conn = pool.acquire().await.unwrap();
    EditorSession {
        connection_id: "test".to_string(),
        connection: EditorConnection::Postgres(conn),
        transaction_state: TransactionState::Inactive,
        mysql_autocommit: true,
    }
}

async fn exec(session: &mut EditorSession, sql: &str) {
    if let EditorConnection::Postgres(ref mut conn) = session.connection {
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .execute(&mut **conn)
            .await
            .unwrap();
    } else {
        panic!("not a Postgres session");
    }
}

async fn count(session: &mut EditorSession, table: &str) -> i64 {
    if let EditorConnection::Postgres(ref mut conn) = session.connection {
        sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!("SELECT COUNT(*) FROM {table}")))
            .fetch_one(&mut **conn)
            .await
            .unwrap()
    } else {
        panic!("not a Postgres session");
    }
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn begin_commit_persists_inserts() {
    let container = Postgres::default().start().await.unwrap();
    let port = container.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");

    let mut session = make_session(&url).await;
    exec(
        &mut session,
        "CREATE TABLE items (id SERIAL PRIMARY KEY, name TEXT)",
    )
    .await;

    begin_session(&mut session).await.unwrap();
    exec(
        &mut session,
        "INSERT INTO items (name) VALUES ('permanent')",
    )
    .await;
    commit_session(&mut session).await.unwrap();

    assert_eq!(session.transaction_state, TransactionState::Inactive);
    assert_eq!(count(&mut session, "items").await, 1);
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn begin_rollback_reverts_inserts() {
    let container = Postgres::default().start().await.unwrap();
    let port = container.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");

    let mut session = make_session(&url).await;
    exec(
        &mut session,
        "CREATE TABLE items (id SERIAL PRIMARY KEY, name TEXT)",
    )
    .await;

    begin_session(&mut session).await.unwrap();
    exec(
        &mut session,
        "INSERT INTO items (name) VALUES ('temporary')",
    )
    .await;
    rollback_session(&mut session).await.unwrap();

    assert_eq!(session.transaction_state, TransactionState::Inactive);
    assert_eq!(count(&mut session, "items").await, 0);
}

// When a statement fails inside a Postgres transaction the connection enters
// an aborted state where only ROLLBACK is accepted. The app tracks this as
// TransactionState::Failed. This test verifies that rollback_session can
// recover the connection from the aborted state.
#[tokio::test]
#[ignore = "requires Docker"]
async fn rollback_recovers_failed_postgres_transaction() {
    let container = Postgres::default().start().await.unwrap();
    let port = container.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");

    let mut session = make_session(&url).await;
    exec(
        &mut session,
        "CREATE TABLE items (id SERIAL PRIMARY KEY, name TEXT)",
    )
    .await;

    begin_session(&mut session).await.unwrap();
    exec(
        &mut session,
        "INSERT INTO items (name) VALUES ('before_error')",
    )
    .await;

    // Force the Postgres connection into an aborted state by running bad SQL.
    if let EditorConnection::Postgres(ref mut conn) = session.connection {
        let _ = sqlx::query("INSERT INTO nonexistent_table VALUES (1)")
            .execute(&mut **conn)
            .await;
    }
    // Simulate the state the app sets after a statement failure in a transaction.
    session.transaction_state = TransactionState::Failed;

    // rollback_session must be able to send ROLLBACK even on an aborted connection.
    rollback_session(&mut session).await.unwrap();
    assert_eq!(session.transaction_state, TransactionState::Inactive);

    // Connection is usable again after rollback; the INSERT is gone.
    assert_eq!(count(&mut session, "items").await, 0);
}

// split_statements handles dollar-quoted bodies ($$...$$) and execute_pg
// executes each resulting statement cleanly on a real Postgres connection.
#[tokio::test]
#[ignore = "requires Docker"]
async fn dollar_quoted_function_executes() {
    let container = Postgres::default().start().await.unwrap();
    let port = container.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");

    let mut session = make_session(&url).await;

    let sql = "CREATE OR REPLACE FUNCTION add_one(n INT) RETURNS INT AS $$\n\
               BEGIN RETURN n + 1; END;\n\
               $$ LANGUAGE plpgsql;\n\
               SELECT add_one(5);";

    let statements = split_statements(sql, SqlDialect::Postgres);
    assert_eq!(statements.len(), 2);

    if let EditorConnection::Postgres(ref mut conn) = session.connection {
        // First statement: CREATE FUNCTION
        let create_result = execute_pg(conn, &statements[0], 0).await;
        assert!(create_result.error.is_none(), "{:?}", create_result.error);

        // Second statement: SELECT add_one(5) → should return 6
        let select_result = execute_pg(conn, &statements[1], 1).await;
        assert!(select_result.error.is_none(), "{:?}", select_result.error);
        assert_eq!(select_result.kind, "rows");
        assert_eq!(select_result.row_count, 1);
    }
}
