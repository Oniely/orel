use super::{
    apply_pre_execution_state, apply_successful_statement_state, begin_session, commit_session,
    execute_control, rollback_session, ControlStatement, EditorConnection, EditorSession,
    SqlDialect, TransactionState,
};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use testcontainers_modules::{mysql::Mysql, testcontainers::runners::AsyncRunner};

// Build a session from a running container.
// testcontainers-modules Mysql::default() sets MYSQL_ALLOW_EMPTY_PASSWORD=yes
// (no root password) and MYSQL_DATABASE=test. The URL has no password field.
async fn make_session(
    container: &testcontainers_modules::testcontainers::ContainerAsync<Mysql>,
) -> EditorSession {
    let port = container.get_host_port_ipv4(3306).await.unwrap();
    let host = container.get_host().await.unwrap().to_string();
    let opts = MySqlConnectOptions::new()
        .host(&host)
        .port(port)
        .username("root")
        .database("test"); // MYSQL_DATABASE=test, MYSQL_ALLOW_EMPTY_PASSWORD=yes
    let pool = MySqlPoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .unwrap();
    let conn = pool.acquire().await.unwrap();
    EditorSession {
        connection_id: "test".to_string(),
        connection: EditorConnection::MySql(conn),
        transaction_state: TransactionState::Inactive,
        mysql_autocommit: true,
    }
}

async fn exec(session: &mut EditorSession, sql: &str) {
    if let EditorConnection::MySql(ref mut conn) = session.connection {
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .execute(&mut **conn)
            .await
            .unwrap();
    } else {
        panic!("not a MySQL session");
    }
}

async fn count(session: &mut EditorSession, table: &str) -> i64 {
    if let EditorConnection::MySql(ref mut conn) = session.connection {
        sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!("SELECT COUNT(*) FROM {table}")))
            .fetch_one(&mut **conn)
            .await
            .unwrap()
    } else {
        panic!("not a MySQL session");
    }
}

// Prior to the fix, `execute_control("BEGIN")` on MySQL returned error 1295
// because sqlx::query() uses the prepared-statement protocol, which MySQL
// rejects for control statements. The fix uses sqlx::raw_sql() (COM_QUERY).
#[tokio::test]
#[ignore = "requires Docker"]
async fn execute_control_begin_commit_no_error_1295() {
    let container = Mysql::default().start().await.unwrap();
    let mut session = make_session(&container).await;

    begin_session(&mut session).await.unwrap();
    assert_eq!(session.transaction_state, TransactionState::Active);
    commit_session(&mut session).await.unwrap();
    assert_eq!(session.transaction_state, TransactionState::Inactive);
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn begin_rollback_reverts_inserts() {
    let container = Mysql::default().start().await.unwrap();
    let mut session = make_session(&container).await;

    exec(
        &mut session,
        "CREATE TABLE items (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255)) ENGINE=InnoDB",
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

#[tokio::test]
#[ignore = "requires Docker"]
async fn begin_commit_persists_inserts() {
    let container = Mysql::default().start().await.unwrap();
    let mut session = make_session(&container).await;

    exec(
        &mut session,
        "CREATE TABLE items (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255)) ENGINE=InnoDB",
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

// MySQL DDL (ALTER TABLE, CREATE TABLE, etc.) implicitly commits any open
// InnoDB transaction before executing. apply_pre_execution_state updates the
// in-memory state to reflect this before the statement runs.
#[tokio::test]
#[ignore = "requires Docker"]
async fn ddl_implicitly_commits_transaction() {
    let container = Mysql::default().start().await.unwrap();
    let mut session = make_session(&container).await;

    exec(
        &mut session,
        "CREATE TABLE items (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255)) ENGINE=InnoDB",
    )
    .await;

    begin_session(&mut session).await.unwrap();
    exec(
        &mut session,
        "INSERT INTO items (name) VALUES ('committed_by_ddl')",
    )
    .await;

    // The DDL below will implicitly commit the INSERT. apply_pre_execution_state
    // marks the in-memory state as Inactive before execution.
    let implicitly_committed = apply_pre_execution_state(
        SqlDialect::MySql,
        "ALTER TABLE items ADD COLUMN extra INT",
        &mut session.transaction_state,
        session.mysql_autocommit,
    );
    assert!(implicitly_committed);
    assert_eq!(session.transaction_state, TransactionState::Inactive);

    exec(&mut session, "ALTER TABLE items ADD COLUMN extra INT").await;

    // Nothing left to roll back — the INSERT was committed by the DDL.
    rollback_session(&mut session).await.unwrap();
    assert_eq!(count(&mut session, "items").await, 1);
}

// SET autocommit = 0 pins the MySQL session in an active transaction until
// autocommit is restored. execute_control must handle this via COM_QUERY.
#[tokio::test]
#[ignore = "requires Docker"]
async fn autocommit_control_statements_execute_without_error() {
    let container = Mysql::default().start().await.unwrap();
    let mut session = make_session(&container).await;

    execute_control(&mut session.connection, "SET autocommit = 0")
        .await
        .unwrap();
    apply_successful_statement_state(
        SqlDialect::MySql,
        "SET autocommit = 0",
        ControlStatement::Other,
        &mut session.transaction_state,
        &mut session.mysql_autocommit,
    );
    assert!(!session.mysql_autocommit);
    assert_eq!(session.transaction_state, TransactionState::Active);

    execute_control(&mut session.connection, "SET autocommit = 1")
        .await
        .unwrap();
    apply_successful_statement_state(
        SqlDialect::MySql,
        "SET autocommit = 1",
        ControlStatement::Other,
        &mut session.transaction_state,
        &mut session.mysql_autocommit,
    );
    assert!(session.mysql_autocommit);
    assert_eq!(session.transaction_state, TransactionState::Inactive);
}
