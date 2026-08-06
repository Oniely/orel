use super::{
    apply_pre_execution_state, apply_successful_statement_state, begin_session, classify_control,
    execute_sqlite, mysql_autocommit_change, mysql_implicitly_commits, rollback_session,
    split_statements, ControlStatement, EditorConnection, EditorSession, MySqlAutocommitChange,
    SqlDialect, TransactionState, MAX_QUERY_RESULT_ROWS,
};
use sqlx::{sqlite::SqlitePoolOptions, Connection, SqliteConnection};

mod statement_splitting {
    use super::*;

    #[test]
    fn splits_only_top_level_delimiters() {
        let statements = split_statements(
            "SELECT ';' AS semi; -- ignored ;\nSELECT \"a;b\"; SELECT `c;d`;",
            SqlDialect::Sqlite,
        );
        assert_eq!(statements.len(), 3);
    }

    #[test]
    fn keeps_postgres_dollar_quoted_bodies_together() {
        let statements = split_statements(
            "CREATE FUNCTION f() RETURNS void AS $$ BEGIN PERFORM 1; END; $$ LANGUAGE plpgsql; SELECT 1;",
            SqlDialect::Postgres,
        );
        assert_eq!(statements.len(), 2);
    }

    #[test]
    fn ignores_semicolons_inside_mysql_hash_comments() {
        let statements = split_statements(
            "# migration note; do not execute\nSELECT 1; # another ; comment\nSELECT 2;",
            SqlDialect::MySql,
        );
        assert_eq!(statements.len(), 2);
        assert!(statements[0].contains("SELECT 1"));
        assert!(statements[1].contains("SELECT 2"));
    }
}

mod transaction_classification {
    use super::*;

    #[test]
    fn recognizes_standard_transaction_boundaries() {
        assert_eq!(
            classify_control("/* hi */ BEGIN WORK", SqlDialect::Postgres),
            ControlStatement::Begin
        );
        assert_eq!(
            classify_control("START TRANSACTION", SqlDialect::MySql),
            ControlStatement::Begin
        );
        assert_eq!(
            classify_control("END", SqlDialect::Postgres),
            ControlStatement::Commit
        );
        assert_eq!(
            classify_control("ROLLBACK TO SAVEPOINT x", SqlDialect::Postgres),
            ControlStatement::Other
        );
    }

    #[test]
    fn distinguishes_chained_and_non_chained_completion() {
        assert_eq!(
            classify_control("COMMIT AND CHAIN", SqlDialect::Postgres),
            ControlStatement::CommitAndChain
        );
        assert_eq!(
            classify_control("ROLLBACK WORK AND CHAIN", SqlDialect::MySql),
            ControlStatement::RollbackAndChain
        );
        assert_eq!(
            classify_control("COMMIT AND NO CHAIN", SqlDialect::Postgres),
            ControlStatement::Commit
        );
        assert_eq!(
            classify_control("COMMIT AND /* continue */ CHAIN", SqlDialect::Postgres),
            ControlStatement::CommitAndChain
        );
    }

    #[test]
    fn chained_completion_keeps_the_session_active() {
        let mut state = TransactionState::Active;
        let mut autocommit = true;
        apply_successful_statement_state(
            SqlDialect::Postgres,
            "COMMIT AND CHAIN",
            ControlStatement::CommitAndChain,
            &mut state,
            &mut autocommit,
        );
        assert_eq!(state, TransactionState::Active);
    }
}

mod mysql_state_tracking {
    use super::*;

    #[test]
    fn temporary_table_ddl_does_not_implicitly_commit() {
        assert!(!mysql_implicitly_commits(
            "CREATE TEMPORARY TABLE scratch (id INT)"
        ));
        assert!(!mysql_implicitly_commits(
            "CREATE /* scoped */ TEMPORARY TABLE scratch (id INT)"
        ));
        assert!(!mysql_implicitly_commits(
            "DROP TEMPORARY TABLE IF EXISTS scratch"
        ));
        assert!(mysql_implicitly_commits("CREATE TABLE durable (id INT)"));
        assert!(mysql_implicitly_commits("DROP TABLE durable"));
    }

    #[test]
    fn implicit_commit_is_applied_before_a_statement_result() {
        let mut state = TransactionState::Active;
        let committed = apply_pre_execution_state(
            SqlDialect::MySql,
            "ALTER TABLE users ADD UNIQUE (email)",
            &mut state,
            true,
        );

        assert!(committed);
        assert_eq!(state, TransactionState::Inactive);
    }

    #[test]
    fn failed_temporary_ddl_leaves_the_existing_transaction_active() {
        let mut state = TransactionState::Active;
        let committed = apply_pre_execution_state(
            SqlDialect::MySql,
            "CREATE TEMPORARY TABLE scratch (id INT)",
            &mut state,
            true,
        );

        assert!(!committed);
        assert_eq!(state, TransactionState::Active);
    }

    #[test]
    fn parses_session_autocommit_assignments_but_not_global_ones() {
        assert_eq!(
            mysql_autocommit_change("SET autocommit = 0"),
            MySqlAutocommitChange::Set(false)
        );
        assert_eq!(
            mysql_autocommit_change("SET @@SESSION.autocommit = OFF"),
            MySqlAutocommitChange::Set(false)
        );
        assert_eq!(
            mysql_autocommit_change("SET autocommit = ON"),
            MySqlAutocommitChange::Set(true)
        );
        assert_eq!(
            mysql_autocommit_change("SET GLOBAL autocommit = 0"),
            MySqlAutocommitChange::Unchanged
        );
        assert_eq!(
            mysql_autocommit_change("SET autocommit = @@global.autocommit"),
            MySqlAutocommitChange::Dynamic
        );
    }

    #[test]
    fn disabling_autocommit_pins_the_manual_session_until_restored() {
        let mut state = TransactionState::Inactive;
        let mut autocommit = true;

        apply_successful_statement_state(
            SqlDialect::MySql,
            "SET autocommit = 0",
            ControlStatement::Other,
            &mut state,
            &mut autocommit,
        );
        assert!(!autocommit);
        assert_eq!(state, TransactionState::Active);

        apply_successful_statement_state(
            SqlDialect::MySql,
            "COMMIT",
            ControlStatement::Commit,
            &mut state,
            &mut autocommit,
        );
        assert_eq!(state, TransactionState::Active);

        apply_successful_statement_state(
            SqlDialect::MySql,
            "SET autocommit = 1",
            ControlStatement::Other,
            &mut state,
            &mut autocommit,
        );
        assert!(autocommit);
        assert_eq!(state, TransactionState::Inactive);
    }
}

mod sqlite_integration {
    use super::*;

    #[tokio::test]
    async fn select_preserves_columns_and_caps_rows() {
        let mut connection = SqliteConnection::connect(":memory:").await.unwrap();
        let result = execute_sqlite(
            &mut connection,
            "WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM n WHERE value < 150) SELECT value FROM n",
            1,
        )
        .await;

        assert_eq!(result.kind, "rows");
        assert_eq!(result.columns[0].name, "value");
        assert_eq!(result.rows.len(), MAX_QUERY_RESULT_ROWS);
        assert_eq!(result.row_count, 150);
        assert!(result.truncated);
    }

    #[tokio::test]
    async fn manual_transaction_rolls_back_and_reports_primary_keys() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(":memory:")
            .await
            .unwrap();
        let mut connection = pool.acquire().await.unwrap();
        sqlx::query("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)")
            .execute(&mut *connection)
            .await
            .unwrap();
        let mut session = EditorSession {
            connection_id: "test".to_string(),
            connection: EditorConnection::Sqlite(connection),
            transaction_state: TransactionState::Inactive,
            mysql_autocommit: true,
        };

        begin_session(&mut session).await.unwrap();
        if let EditorConnection::Sqlite(connection) = &mut session.connection {
            sqlx::query("INSERT INTO items (name) VALUES ('temporary')")
                .execute(&mut **connection)
                .await
                .unwrap();
        }
        rollback_session(&mut session).await.unwrap();

        if let EditorConnection::Sqlite(connection) = &mut session.connection {
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM items")
                .fetch_one(&mut **connection)
                .await
                .unwrap();
            assert_eq!(count, 0);

            let result = execute_sqlite(connection, "SELECT id, name FROM items", 1).await;
            assert!(result.columns[0].is_primary);
            assert!(!result.columns[1].is_primary);
        }
        assert_eq!(session.transaction_state, TransactionState::Inactive);
    }
}
