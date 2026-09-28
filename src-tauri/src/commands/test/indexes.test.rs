use super::*;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use sqlx::postgres::PgPoolOptions;
use sqlx::sqlite::SqlitePoolOptions;
use testcontainers_modules::{mysql::Mysql, postgres::Postgres, testcontainers::runners::AsyncRunner};

// ── Helpers ──────────────────────────────────────────────────────────────────

fn index(name: &str, cols: &[&str]) -> TableIndex {
    TableIndex {
        name: name.to_string(),
        columns: cols.iter().map(|c| IndexColumn::plain(*c)).collect(),
        droppable: true,
        ..Default::default()
    }
}

fn primary(cols: &[&str]) -> TableIndex {
    TableIndex { is_primary: true, is_unique: true, droppable: false, ..index("PRIMARY", cols) }
}

fn add(name: &str, unique: bool, cols: &[(&str, bool, Option<u32>)]) -> IndexAddPayload {
    IndexAddPayload {
        name: name.to_string(),
        unique,
        columns: cols
            .iter()
            .map(|(c, desc, len)| IndexColumnPayload { name: c.to_string(), descending: *desc, prefix_length: *len })
            .collect(),
    }
}

fn cols(names: &[&str]) -> Vec<String> {
    names.iter().map(|s| s.to_string()).collect()
}

fn changes(drops: &[&str], adds: Vec<IndexAddPayload>) -> IndexChanges {
    IndexChanges { drops: cols(drops), adds }
}

// ── Validation ───────────────────────────────────────────────────────────────

#[test]
fn validate_accepts_drop_and_add() {
    let current = vec![primary(&["id"]), index("t_email_idx", &["email"])];
    let c = changes(&["t_email_idx"], vec![add("t_email_key", true, &[("email", false, None)])]);
    assert!(validate_index_changes(&current, &cols(&["id", "email"]), &c).is_ok());
}

#[test]
fn validate_rejects_primary_key_drop() {
    let current = vec![primary(&["id"])];
    let err = validate_index_changes(&current, &cols(&["id"]), &changes(&["PRIMARY"], vec![])).unwrap_err();
    assert!(err.contains("primary key"));
}

#[test]
fn validate_rejects_undroppable_index() {
    let current = vec![TableIndex { droppable: false, ..index("sqlite_autoindex_t_1", &["email"]) }];
    let err = validate_index_changes(&current, &cols(&["email"]), &changes(&["sqlite_autoindex_t_1"], vec![]))
        .unwrap_err();
    assert!(err.contains("can't be dropped"));
}

#[test]
fn validate_rejects_missing_drop_target() {
    let err = validate_index_changes(&[], &cols(&["a"]), &changes(&["gone"], vec![])).unwrap_err();
    assert!(err.contains("no longer exists"));
}

#[test]
fn validate_rejects_duplicate_names_case_insensitively() {
    let current = vec![index("t_a_idx", &["a"])];
    let err = validate_index_changes(&current, &cols(&["a"]), &changes(&[], vec![add("T_A_IDX", false, &[("a", false, None)])]))
        .unwrap_err();
    assert!(err.contains("already exists"));

    let two_new = changes(&[], vec![add("x", false, &[("a", false, None)]), add("x", true, &[("a", false, None)])]);
    assert!(validate_index_changes(&[], &cols(&["a"]), &two_new).is_err());
}

#[test]
fn validate_allows_reusing_a_dropped_name() {
    let current = vec![index("t_a_idx", &["a"])];
    let c = changes(&["t_a_idx"], vec![add("t_a_idx", true, &[("a", false, None)])]);
    assert!(validate_index_changes(&current, &cols(&["a"]), &c).is_ok());
}

#[test]
fn validate_rejects_empty_name_empty_columns_unknown_and_repeated_columns() {
    let a = cols(&["a"]);
    assert!(validate_index_changes(&[], &a, &changes(&[], vec![add("  ", false, &[("a", false, None)])]))
        .unwrap_err()
        .contains("needs a name"));
    assert!(validate_index_changes(&[], &a, &changes(&[], vec![add("x", false, &[])]))
        .unwrap_err()
        .contains("at least one column"));
    assert!(validate_index_changes(&[], &a, &changes(&[], vec![add("x", false, &[("b", false, None)])]))
        .unwrap_err()
        .contains("no longer exists"));
    assert!(validate_index_changes(&[], &a, &changes(&[], vec![add("x", false, &[("a", false, None), ("a", true, None)])]))
        .unwrap_err()
        .contains("more than once"));
}

// ── SQL generation ───────────────────────────────────────────────────────────

#[test]
fn standard_sql_drops_before_creates() {
    let current = vec![index("t_a_idx", &["a"])];
    let c = changes(
        &["t_a_idx"],
        vec![add("t_a_b_key", true, &[("a", false, None), ("b", true, None)])],
    );
    assert_eq!(
        generate_standard_index_sql("t", &current, &c),
        vec![
            "DROP INDEX \"t_a_idx\";",
            "CREATE UNIQUE INDEX \"t_a_b_key\" ON \"t\" (\"a\", \"b\" DESC);",
        ]
    );
}

#[test]
fn standard_sql_drops_constraint_backed_index_with_drop_constraint() {
    let current = vec![TableIndex { is_constraint: true, is_unique: true, ..index("t_email_key", &["email"]) }];
    assert_eq!(
        generate_standard_index_sql("t", &current, &changes(&["t_email_key"], vec![])),
        vec!["ALTER TABLE \"t\" DROP CONSTRAINT \"t_email_key\";"]
    );
}

#[test]
fn standard_sql_ignores_prefix_length_and_quotes_odd_names() {
    let c = changes(&[], vec![add(" we\"ird idx ", false, &[("my col", false, Some(10))])]);
    assert_eq!(
        generate_standard_index_sql("my\"table", &[], &c),
        vec!["CREATE INDEX \"we\"\"ird idx\" ON \"my\"\"table\" (\"my col\");"]
    );
}

#[test]
fn mysql_sql_is_one_alter_statement() {
    let c = changes(
        &["old_idx"],
        vec![
            add("t_bio_idx", false, &[("bio", false, Some(20)), ("id", true, None)]),
            add("t_email_key", true, &[("email", false, None)]),
        ],
    );
    assert_eq!(
        generate_mysql_index_sql("t", &c),
        vec![
            "ALTER TABLE `t` DROP INDEX `old_idx`, ADD INDEX `t_bio_idx` (`bio`(20), `id` DESC), \
             ADD UNIQUE INDEX `t_email_key` (`email`);"
        ]
    );
}

#[test]
fn mysql_sql_escapes_backticks_and_is_empty_without_changes() {
    assert!(generate_mysql_index_sql("t", &IndexChanges::default()).is_empty());
    assert_eq!(
        generate_mysql_index_sql("t", &changes(&["a`b"], vec![])),
        vec!["ALTER TABLE `t` DROP INDEX `a``b`;"]
    );
}

// ── SQLite (in-memory, no Docker) ────────────────────────────────────────────

async fn sqlite_pool() -> sqlx::SqlitePool {
    SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap()
}

#[tokio::test]
async fn sqlite_fetch_indexes_reports_kinds_and_order() {
    let pool = sqlite_pool().await;
    sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, email TEXT UNIQUE, a INT, b INT)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("CREATE INDEX t_a_b_idx ON t (a, b DESC)").execute(&pool).await.unwrap();

    let indexes = fetch_sqlite_indexes(&pool, "t").await.unwrap();

    // Rowid-alias PK is synthesized and locked
    assert!(indexes[0].is_primary && !indexes[0].droppable);
    assert_eq!(indexes[0].columns[0].name, "id");

    let auto = indexes.iter().find(|i| i.name.starts_with("sqlite_autoindex")).unwrap();
    assert!(auto.is_unique && !auto.droppable);

    let ab = indexes.iter().find(|i| i.name == "t_a_b_idx").unwrap();
    assert!(ab.droppable && !ab.is_unique);
    assert_eq!(ab.columns.iter().map(|c| (c.name.as_str(), c.descending)).collect::<Vec<_>>(), [("a", false), ("b", true)]);
}

#[tokio::test]
async fn sqlite_apply_drop_and_add_round_trips() {
    let pool = sqlite_pool().await;
    sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, a INT, b INT)").execute(&pool).await.unwrap();
    sqlx::query("CREATE INDEX t_a_idx ON t (a)").execute(&pool).await.unwrap();

    let current = fetch_sqlite_indexes(&pool, "t").await.unwrap();
    let c = changes(&["t_a_idx"], vec![add("t_a_b_key", true, &[("a", false, None), ("b", false, None)])]);
    validate_index_changes(&current, &cols(&["id", "a", "b"]), &c).unwrap();
    DbPool::Sqlite(pool.clone())
        .execute_in_transaction(&generate_standard_index_sql("t", &current, &c))
        .await
        .unwrap();

    let after = fetch_sqlite_indexes(&pool, "t").await.unwrap();
    assert!(after.iter().all(|i| i.name != "t_a_idx"));
    let key = after.iter().find(|i| i.name == "t_a_b_key").unwrap();
    assert!(key.is_unique);
    assert_eq!(key.columns.len(), 2);
}

// ── Docker-backed integration tests ──────────────────────────────────────────

#[tokio::test]
#[ignore = "requires Docker"]
async fn pg_indexes_round_trip_and_apply() {
    let container = Postgres::default().start().await.unwrap();
    let port = container.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");
    let pool = PgPoolOptions::new().max_connections(1).connect(&url).await.unwrap();

    sqlx::query("CREATE TABLE t (id SERIAL PRIMARY KEY, email TEXT UNIQUE, a INT, b INT, name TEXT)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("CREATE INDEX t_a_b_idx ON t (a, b DESC)").execute(&pool).await.unwrap();
    sqlx::query("CREATE INDEX t_lower_name_idx ON t (lower(name))").execute(&pool).await.unwrap();

    let indexes = fetch_pg_indexes(&pool, "t").await.unwrap();
    assert!(indexes[0].is_primary && !indexes[0].droppable);

    let email = indexes.iter().find(|i| i.name == "t_email_key").unwrap();
    assert!(email.is_unique && email.is_constraint);

    let ab = indexes.iter().find(|i| i.name == "t_a_b_idx").unwrap();
    assert_eq!(ab.method.as_deref(), Some("btree"));
    assert_eq!(ab.columns.iter().map(|c| (c.name.as_str(), c.descending)).collect::<Vec<_>>(), [("a", false), ("b", true)]);

    let expr = indexes.iter().find(|i| i.name == "t_lower_name_idx").unwrap();
    assert!(expr.columns[0].is_expression);
    assert!(expr.columns[0].name.contains("lower"));

    // Constraint-backed and plain drops, plus a new index, in one save
    let c = changes(&["t_email_key", "t_a_b_idx"], vec![add("t_name_idx", false, &[("name", false, None)])]);
    DbPool::Postgres(pool.clone())
        .execute_in_transaction(&generate_standard_index_sql("t", &indexes, &c))
        .await
        .unwrap();

    let names: Vec<String> = fetch_pg_indexes(&pool, "t").await.unwrap().into_iter().map(|i| i.name).collect();
    assert!(names.contains(&"t_name_idx".to_string()));
    assert!(!names.contains(&"t_email_key".to_string()));
    assert!(!names.contains(&"t_a_b_idx".to_string()));
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn pg_failed_index_save_rolls_back_drops() {
    let container = Postgres::default().start().await.unwrap();
    let port = container.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");
    let pool = PgPoolOptions::new().max_connections(1).connect(&url).await.unwrap();

    sqlx::query("CREATE TABLE t (a INT)").execute(&pool).await.unwrap();
    sqlx::query("CREATE INDEX t_a_idx ON t (a)").execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO t VALUES (1), (1)").execute(&pool).await.unwrap();

    // The drop succeeds, then the unique index fails on the duplicate rows.
    let current = fetch_pg_indexes(&pool, "t").await.unwrap();
    let c = changes(&["t_a_idx"], vec![add("t_a_key", true, &[("a", false, None)])]);
    assert!(DbPool::Postgres(pool.clone())
        .execute_in_transaction(&generate_standard_index_sql("t", &current, &c))
        .await
        .is_err());

    let names: Vec<String> = fetch_pg_indexes(&pool, "t").await.unwrap().into_iter().map(|i| i.name).collect();
    assert_eq!(names, ["t_a_idx"]);
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn mysql_indexes_round_trip_and_apply() {
    let container = Mysql::default().start().await.unwrap();
    let port = container.get_host_port_ipv4(3306).await.unwrap();
    let host = container.get_host().await.unwrap().to_string();
    let opts = MySqlConnectOptions::new().host(&host).port(port).username("root").database("test");
    let pool = MySqlPoolOptions::new().max_connections(1).connect_with(opts).await.unwrap();

    sqlx::query(
        "CREATE TABLE t ( \
            id INT PRIMARY KEY, \
            email VARCHAR(100) UNIQUE, \
            bio TEXT, \
            a INT, \
            b INT, \
            INDEX t_a_b_idx (a, b DESC) \
         )",
    )
    .execute(&pool)
    .await
    .unwrap();

    let indexes = fetch_mysql_indexes(&pool, "t").await.unwrap();
    assert!(indexes[0].is_primary && !indexes[0].droppable);
    assert!(indexes.iter().find(|i| i.name == "email").unwrap().is_unique);
    let ab = indexes.iter().find(|i| i.name == "t_a_b_idx").unwrap();
    assert_eq!(ab.columns.iter().map(|c| (c.name.as_str(), c.descending)).collect::<Vec<_>>(), [("a", false), ("b", true)]);

    // TEXT needs a prefix length; everything lands in one ALTER
    let c = changes(
        &["t_a_b_idx", "email"],
        vec![add("t_bio_idx", false, &[("bio", false, Some(20))]), add("t_email_key", true, &[("email", false, None)])],
    );
    let stmts = generate_mysql_index_sql("t", &c);
    assert_eq!(stmts.len(), 1);
    DbPool::MySql(pool.clone()).execute_in_transaction(&stmts).await.unwrap();

    let after = fetch_mysql_indexes(&pool, "t").await.unwrap();
    let bio = after.iter().find(|i| i.name == "t_bio_idx").unwrap();
    assert_eq!(bio.columns[0].prefix_length, Some(20));
    assert!(after.iter().find(|i| i.name == "t_email_key").unwrap().is_unique);
    assert!(after.iter().all(|i| i.name != "t_a_b_idx" && i.name != "email"));
}
