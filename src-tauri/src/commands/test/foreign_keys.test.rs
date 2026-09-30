use super::*;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use sqlx::postgres::PgPoolOptions;
use sqlx::sqlite::SqlitePoolOptions;
use testcontainers_modules::{mysql::Mysql, postgres::Postgres, testcontainers::runners::AsyncRunner};

use ReferentialAction::{Cascade, NoAction, SetDefault, SetNull};

// ── Helpers ──────────────────────────────────────────────────────────────────

fn fk(name: &str, cols: &[&str], ref_table: &str, ref_cols: &[&str]) -> ForeignKey {
    ForeignKey {
        name: Some(name.to_string()),
        columns: strings(cols),
        referenced_table: ref_table.to_string(),
        referenced_columns: strings(ref_cols),
        ..Default::default()
    }
}

fn add(name: &str, col: &str, ref_table: &str, ref_col: &str) -> ForeignKeyAddPayload {
    ForeignKeyAddPayload {
        name: name.to_string(),
        columns: strings(&[col]),
        referenced_table: ref_table.to_string(),
        referenced_columns: strings(&[ref_col]),
        on_update: NoAction,
        on_delete: NoAction,
    }
}

fn column(name: &str, nullable: bool) -> ColumnInfo {
    ColumnInfo {
        name: name.to_string(),
        data_type: "integer".to_string(),
        is_nullable: nullable,
        is_primary: false,
        has_default: false,
    }
}

fn strings(names: &[&str]) -> Vec<String> {
    names.iter().map(|s| s.to_string()).collect()
}

fn changes(drops: &[&str], adds: Vec<ForeignKeyAddPayload>) -> ForeignKeyChanges {
    ForeignKeyChanges { drops: strings(drops), adds }
}

/// `orders (id, user_id NULL, owner_id NOT NULL)` referencing `users (id)`
fn local() -> Vec<ColumnInfo> {
    vec![column("id", false), column("user_id", true), column("owner_id", false)]
}

fn referenced() -> HashMap<String, Vec<ColumnInfo>> {
    HashMap::from([("users".to_string(), vec![column("id", false)])])
}

fn validate(dialect: Dialect, current: &[ForeignKey], c: &ForeignKeyChanges) -> Result<(), String> {
    validate_fk_changes(dialect, "orders", current, &local(), &referenced(), &[], c)
}

fn validate_mysql_with_indexes(indexes: &[TableIndex], current: &[ForeignKey], c: &ForeignKeyChanges) -> Result<(), String> {
    validate_fk_changes(Dialect::MySql, "orders", current, &local(), &referenced(), indexes, c)
}

fn index(name: &str, cols: &[&str]) -> TableIndex {
    TableIndex {
        name: name.to_string(),
        columns: cols.iter().map(|c| crate::commands::indexes::IndexColumn::plain(*c)).collect(),
        ..Default::default()
    }
}

// ── Validation ───────────────────────────────────────────────────────────────

#[test]
fn validate_accepts_drop_and_add() {
    let current = vec![fk("orders_user_id_fkey", &["user_id"], "users", &["id"])];
    let c = changes(&["orders_user_id_fkey"], vec![add("orders_owner_id_fkey", "owner_id", "users", "id")]);
    assert!(validate(Dialect::Postgres, &current, &c).is_ok());
}

#[test]
fn validate_rejects_missing_drop_target() {
    let err = validate(Dialect::Postgres, &[], &changes(&["gone"], vec![])).unwrap_err();
    assert!(err.contains("no longer exists"));
}

#[test]
fn validate_rejects_duplicate_names_case_insensitively_but_allows_reusing_a_dropped_name() {
    let current = vec![fk("orders_user_id_fkey", &["user_id"], "users", &["id"])];
    let dup = changes(&[], vec![add("ORDERS_USER_ID_FKEY", "owner_id", "users", "id")]);
    assert!(validate(Dialect::MySql, &current, &dup).unwrap_err().contains("already exists"));

    let two_new = changes(&[], vec![add("x", "user_id", "users", "id"), add("x", "owner_id", "users", "id")]);
    assert!(validate(Dialect::Postgres, &[], &two_new).is_err());

    let reuse = changes(&["orders_user_id_fkey"], vec![add("orders_user_id_fkey", "owner_id", "users", "id")]);
    assert!(validate(Dialect::Postgres, &current, &reuse).is_ok());
}

#[test]
fn validate_rejects_incomplete_adds() {
    let empty_name = changes(&[], vec![add("  ", "user_id", "users", "id")]);
    assert!(validate(Dialect::Postgres, &[], &empty_name).unwrap_err().contains("needs a name"));

    let no_table = changes(&[], vec![add("x", "user_id", "", "id")]);
    assert!(validate(Dialect::Postgres, &[], &no_table).unwrap_err().contains("referenced table"));

    let mut mismatched = add("x", "user_id", "users", "id");
    mismatched.referenced_columns.push("id".to_string());
    let err = validate(Dialect::Postgres, &[], &changes(&[], vec![mismatched])).unwrap_err();
    assert!(err.contains("as many columns"));

    let mut no_cols = add("x", "user_id", "users", "id");
    no_cols.columns.clear();
    no_cols.referenced_columns.clear();
    assert!(validate(Dialect::Postgres, &[], &changes(&[], vec![no_cols])).unwrap_err().contains("at least one"));

    let mut repeated = add("x", "user_id", "users", "id");
    repeated.columns.push("user_id".to_string());
    repeated.referenced_columns.push("id".to_string());
    assert!(validate(Dialect::Postgres, &[], &changes(&[], vec![repeated])).unwrap_err().contains("more than once"));
}

#[test]
fn validate_rejects_stale_columns_and_tables() {
    let local_gone = changes(&[], vec![add("x", "gone", "users", "id")]);
    let err = validate(Dialect::Postgres, &[], &local_gone).unwrap_err();
    assert!(err.contains("\"gone\"") && err.contains("\"orders\""));

    let ref_col_gone = changes(&[], vec![add("x", "user_id", "users", "gone")]);
    let err = validate(Dialect::Postgres, &[], &ref_col_gone).unwrap_err();
    assert!(err.contains("\"gone\"") && err.contains("\"users\""));

    let table_gone = changes(&[], vec![add("x", "user_id", "teams", "id")]);
    assert!(validate(Dialect::Postgres, &[], &table_gone).unwrap_err().contains("\"teams\" no longer exists"));
}

#[test]
fn validate_rejects_set_null_on_not_null_column() {
    let mut a = add("x", "owner_id", "users", "id");
    a.on_delete = SetNull;
    let err = validate(Dialect::Postgres, &[], &changes(&[], vec![a])).unwrap_err();
    assert!(err.contains("NOT NULL"));

    let mut nullable = add("x", "user_id", "users", "id");
    nullable.on_delete = SetNull;
    assert!(validate(Dialect::Postgres, &[], &changes(&[], vec![nullable])).is_ok());
}

#[test]
fn validate_rejects_set_default_on_mysql_only() {
    let mut a = add("x", "user_id", "users", "id");
    a.on_update = SetDefault;
    let c = changes(&[], vec![a]);
    assert!(validate(Dialect::MySql, &[], &c).unwrap_err().contains("SET DEFAULT"));
    assert!(validate(Dialect::Postgres, &[], &c).is_ok());
}

#[test]
fn validate_rejects_every_sqlite_change() {
    let current = vec![fk("x", &["user_id"], "users", &["id"])];
    assert!(validate(Dialect::Sqlite, &current, &changes(&["x"], vec![])).unwrap_err().contains("SQLite"));
    let c = changes(&[], vec![add("y", "user_id", "users", "id")]);
    assert!(validate(Dialect::Sqlite, &[], &c).unwrap_err().contains("SQLite"));
    assert!(validate(Dialect::Sqlite, &current, &changes(&[], vec![])).is_ok());
}

#[test]
fn validate_mysql_rejects_reusing_a_name_dropped_in_the_same_save() {
    let current = vec![fk("orders_user_id_fkey", &["user_id"], "users", &["id"])];
    // The common "change ON DELETE" flow: drop and re-add under the same auto-name
    let c = changes(&["orders_user_id_fkey"], vec![add("ORDERS_USER_ID_FKEY", "user_id", "users", "id")]);
    let err = validate(Dialect::MySql, &current, &c).unwrap_err();
    assert!(err.contains("same save that drops it"), "{err}");
    // Postgres runs the drop first in one transaction, so reuse is fine there
    assert!(validate(Dialect::Postgres, &current, &c).is_ok());
}

#[test]
fn validate_mysql_rejects_a_name_taken_by_an_index_that_doesnt_cover_the_columns() {
    // A leftover index from a dropped foreign key, on another column
    let indexes = vec![index("PRIMARY", &["id"]), index("old_fkey", &["user_id"])];
    let c = changes(&[], vec![add("old_fkey", "owner_id", "users", "id")]);
    let err = validate_mysql_with_indexes(&indexes, &[], &c).unwrap_err();
    assert!(err.contains("An index named \"old_fkey\" already exists"), "{err}");

    // Case-insensitive, like MySQL's index names
    let upper = changes(&[], vec![add("OLD_FKEY", "owner_id", "users", "id")]);
    assert!(validate_mysql_with_indexes(&indexes, &[], &upper).is_err());
}

#[test]
fn validate_mysql_allows_an_index_name_when_an_index_already_covers_the_columns() {
    // Same column: MySQL reuses the existing index instead of creating one
    let same_column = vec![index("old_fkey", &["user_id"])];
    let c = changes(&[], vec![add("old_fkey", "user_id", "users", "id")]);
    assert!(validate_mysql_with_indexes(&same_column, &[], &c).is_ok());

    // Another index whose leading column is the foreign key's column also covers it
    let covering = vec![index("clash", &["id"]), index("owner_lookup", &["owner_id", "id"])];
    let c = changes(&[], vec![add("clash", "owner_id", "users", "id")]);
    assert!(validate_mysql_with_indexes(&covering, &[], &c).is_ok());

    // Only a leading-column match counts
    let not_leading = vec![index("clash", &["id", "owner_id"])];
    assert!(validate_mysql_with_indexes(&not_leading, &[], &c).is_err());
}

// ── SQL generation ───────────────────────────────────────────────────────────

#[test]
fn pg_sql_drops_before_adds() {
    let mut a = add("orders_user_id_fkey", "user_id", "users", "id");
    a.on_delete = Cascade;
    let c = changes(&["old_fkey"], vec![a]);
    assert_eq!(
        generate_pg_fk_sql("orders", &c),
        vec![
            "ALTER TABLE \"orders\" DROP CONSTRAINT \"old_fkey\";",
            "ALTER TABLE \"orders\" ADD CONSTRAINT \"orders_user_id_fkey\" FOREIGN KEY (\"user_id\") \
             REFERENCES \"users\" (\"id\") ON UPDATE NO ACTION ON DELETE CASCADE;",
        ]
    );
}

#[test]
fn pg_sql_quotes_odd_names_and_trims_the_constraint_name() {
    let c = changes(&[], vec![add("  my\"fk ", "we\"ird", "par\"ent", "i\"d")]);
    assert_eq!(
        generate_pg_fk_sql("t", &c),
        vec![
            "ALTER TABLE \"t\" ADD CONSTRAINT \"my\"\"fk\" FOREIGN KEY (\"we\"\"ird\") \
             REFERENCES \"par\"\"ent\" (\"i\"\"d\") ON UPDATE NO ACTION ON DELETE NO ACTION;"
        ]
    );
}

#[test]
fn mysql_sql_is_one_alter_statement() {
    let mut a = add("orders_user_id_fkey", "user_id", "users", "id");
    a.on_update = Cascade;
    a.on_delete = SetNull;
    let c = changes(&["old_fkey"], vec![a]);
    assert_eq!(
        generate_mysql_fk_sql("orders", &c),
        vec![
            "ALTER TABLE `orders` DROP FOREIGN KEY `old_fkey`, ADD CONSTRAINT `orders_user_id_fkey` \
             FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE ON DELETE SET NULL;"
        ]
    );
}

#[test]
fn mysql_sql_escapes_backticks_and_is_empty_without_changes() {
    assert!(generate_mysql_fk_sql("t", &changes(&[], vec![])).is_empty());
    assert_eq!(
        generate_mysql_fk_sql("t", &changes(&["a`b"], vec![])),
        vec!["ALTER TABLE `t` DROP FOREIGN KEY `a``b`;"]
    );
}

#[test]
fn referential_actions_parse_from_each_dialect() {
    assert_eq!(ReferentialAction::from_pg_code("c"), Cascade);
    assert_eq!(ReferentialAction::from_pg_code("n"), SetNull);
    assert_eq!(ReferentialAction::from_pg_code("a"), NoAction);
    assert_eq!(ReferentialAction::from_rule("set default"), SetDefault);
    assert_eq!(ReferentialAction::from_rule("RESTRICT"), ReferentialAction::Restrict);
    assert_eq!(ReferentialAction::from_rule("NO ACTION"), NoAction);
}

// ── SQLite (in-memory, no Docker) ────────────────────────────────────────────

#[tokio::test]
async fn sqlite_fetch_foreign_keys_groups_composites_and_resolves_implicit_pk() {
    let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
    for sql in [
        "CREATE TABLE users (id INTEGER PRIMARY KEY)",
        "CREATE TABLE regions (country TEXT, code TEXT, PRIMARY KEY (country, code))",
        "CREATE TABLE orders ( \
            id INTEGER PRIMARY KEY, \
            user_id INT REFERENCES users ON DELETE CASCADE, \
            country TEXT, \
            code TEXT, \
            FOREIGN KEY (country, code) REFERENCES regions (country, code) ON UPDATE SET NULL \
         )",
    ] {
        sqlx::query(sql).execute(&pool).await.unwrap();
    }

    let fks = fetch_sqlite_foreign_keys(&pool, "orders").await.unwrap();
    assert_eq!(fks.len(), 2);
    assert!(fks.iter().all(|f| f.name.is_none()));

    let user = fks.iter().find(|f| f.referenced_table == "users").unwrap();
    assert_eq!(user.columns, ["user_id"]);
    // `REFERENCES users` with no column list points at the parent's PK
    assert_eq!(user.referenced_columns, ["id"]);
    assert_eq!(user.on_delete, Cascade);

    let region = fks.iter().find(|f| f.referenced_table == "regions").unwrap();
    assert_eq!(region.columns, ["country", "code"]);
    assert_eq!(region.referenced_columns, ["country", "code"]);
    assert_eq!(region.on_update, SetNull);
    assert_eq!(region.on_delete, NoAction);
}

#[tokio::test]
async fn sqlite_apply_rejects_changes_and_ignores_empty_saves() {
    let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
    sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY)").execute(&pool).await.unwrap();
    let pool = DbPool::Sqlite(pool);

    assert_eq!(apply_changes(&pool, "t", &changes(&[], vec![])).await.unwrap(), Vec::<String>::new());
    let err = apply_changes(&pool, "t", &changes(&[], vec![add("t_id_fkey", "id", "t", "id")])).await.unwrap_err();
    assert!(err.contains("SQLite"), "{err}");
}

// ── Docker-backed integration tests ──────────────────────────────────────────
// These go through `apply_changes`, the command's real fetch → validate → execute path.

async fn start_pg() -> (testcontainers_modules::testcontainers::ContainerAsync<Postgres>, DbPool, sqlx::PgPool) {
    let container = Postgres::default().start().await.unwrap();
    let port = container.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");
    let pool = PgPoolOptions::new().max_connections(1).connect(&url).await.unwrap();
    (container, DbPool::Postgres(pool.clone()), pool)
}

async fn start_mysql() -> (testcontainers_modules::testcontainers::ContainerAsync<Mysql>, DbPool, sqlx::MySqlPool) {
    let container = Mysql::default().start().await.unwrap();
    let port = container.get_host_port_ipv4(3306).await.unwrap();
    let host = container.get_host().await.unwrap().to_string();
    let opts = MySqlConnectOptions::new().host(&host).port(port).username("root").database("test");
    let pool = MySqlPoolOptions::new().max_connections(1).connect_with(opts).await.unwrap();
    (container, DbPool::MySql(pool.clone()), pool)
}

async fn run_all(db: &DbPool, stmts: &[&str]) {
    for sql in stmts {
        db.execute(sql).await.unwrap();
    }
}

fn names(fks: &[ForeignKey]) -> Vec<&str> {
    fks.iter().filter_map(|f| f.name.as_deref()).collect()
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn pg_foreign_keys_round_trip_and_apply() {
    let (_container, db, pool) = start_pg().await;
    run_all(&db, &[
        "CREATE TABLE users (id SERIAL PRIMARY KEY)",
        "CREATE TABLE regions (country TEXT, code TEXT, PRIMARY KEY (country, code))",
        "CREATE TABLE orders ( \
            id SERIAL PRIMARY KEY, \
            user_id INT REFERENCES users (id) ON DELETE CASCADE, \
            owner_id INT, \
            country TEXT, \
            code TEXT, \
            CONSTRAINT orders_region_fkey FOREIGN KEY (country, code) REFERENCES regions (country, code) ON UPDATE SET NULL \
         )",
    ])
    .await;

    let fks = fetch_pg_foreign_keys(&pool, "orders").await.unwrap();
    let region = fks.iter().find(|f| f.name.as_deref() == Some("orders_region_fkey")).unwrap();
    assert_eq!(region.columns, ["country", "code"]);
    assert_eq!(region.referenced_columns, ["country", "code"]);
    assert_eq!(region.on_update, SetNull);
    assert!(region.referenced_schema.is_none());

    let user = fks.iter().find(|f| f.name.as_deref() == Some("orders_user_id_fkey")).unwrap();
    assert_eq!(user.on_delete, Cascade);

    // Drop one, add one reusing the dropped name, and add a self-reference, in one save
    let mut owner = add("orders_user_id_fkey", "owner_id", "users", "id");
    owner.on_delete = SetNull;
    let c = changes(&["orders_user_id_fkey"], vec![owner, add("orders_parent_fkey", "id", "orders", "id")]);
    apply_changes(&db, "orders", &c).await.unwrap();

    let after = fetch_pg_foreign_keys(&pool, "orders").await.unwrap();
    let reused = after.iter().find(|f| f.name.as_deref() == Some("orders_user_id_fkey")).unwrap();
    assert_eq!(reused.columns, ["owner_id"]);
    assert_eq!(reused.on_delete, SetNull);
    assert!(after.iter().any(|f| f.name.as_deref() == Some("orders_parent_fkey") && f.referenced_table == "orders"));
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn pg_failed_foreign_key_save_rolls_back_drops() {
    let (_container, db, pool) = start_pg().await;
    run_all(&db, &[
        "CREATE TABLE users (id INT PRIMARY KEY)",
        "CREATE TABLE orders (user_id INT CONSTRAINT orders_user_id_fkey REFERENCES users (id), owner_id INT)",
        // An orphan owner_id makes the new foreign key fail after validation passes
        "INSERT INTO orders VALUES (NULL, 42)",
    ])
    .await;

    let c = changes(&["orders_user_id_fkey"], vec![add("orders_owner_id_fkey", "owner_id", "users", "id")]);
    let err = apply_changes(&db, "orders", &c).await.unwrap_err();
    assert!(err.contains("violates foreign key constraint"), "{err}");

    let after = fetch_pg_foreign_keys(&pool, "orders").await.unwrap();
    assert_eq!(names(&after), ["orders_user_id_fkey"]);
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn pg_apply_catches_stale_tables_and_reports_other_schemas() {
    let (_container, db, pool) = start_pg().await;
    run_all(&db, &[
        "CREATE SCHEMA billing",
        "CREATE TABLE billing.accounts (id INT PRIMARY KEY)",
        "CREATE TABLE orders (id INT PRIMARY KEY, account_id INT REFERENCES billing.accounts (id))",
    ])
    .await;

    let fks = fetch_pg_foreign_keys(&pool, "orders").await.unwrap();
    assert_eq!(fks[0].referenced_schema.as_deref(), Some("billing"));
    assert_eq!(fks[0].referenced_table, "accounts");

    // A table dropped since the UI loaded is caught by validation, not the database
    let gone = changes(&[], vec![add("orders_gone_fkey", "account_id", "gone", "id")]);
    let err = apply_changes(&db, "orders", &gone).await.unwrap_err();
    assert!(err.contains("\"gone\" no longer exists"), "{err}");

    let stale_drop = changes(&["already_dropped"], vec![]);
    assert!(apply_changes(&db, "orders", &stale_drop).await.unwrap_err().contains("no longer exists"));
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn mysql_foreign_keys_round_trip_and_apply() {
    let (_container, db, pool) = start_mysql().await;
    run_all(&db, &[
        "CREATE TABLE users (id INT PRIMARY KEY)",
        "CREATE TABLE regions (country VARCHAR(2), code VARCHAR(8), PRIMARY KEY (country, code))",
        "CREATE TABLE orders ( \
            id INT PRIMARY KEY, \
            user_id INT, \
            owner_id INT, \
            country VARCHAR(2), \
            code VARCHAR(8), \
            CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE, \
            CONSTRAINT orders_region_fkey FOREIGN KEY (country, code) REFERENCES regions (country, code) ON UPDATE SET NULL \
         )",
    ])
    .await;

    let fks = fetch_mysql_foreign_keys(&pool, "orders").await.unwrap();
    let region = fks.iter().find(|f| f.name.as_deref() == Some("orders_region_fkey")).unwrap();
    assert_eq!(region.columns, ["country", "code"]);
    assert_eq!(region.referenced_columns, ["country", "code"]);
    assert_eq!(region.on_update, SetNull);
    assert!(region.referenced_schema.is_none());
    let user = fks.iter().find(|f| f.name.as_deref() == Some("orders_user_id_fkey")).unwrap();
    assert_eq!(user.on_delete, Cascade);

    // Drops and an add under a new name go through as one ALTER TABLE
    let mut owner = add("orders_owner_id_fkey", "owner_id", "users", "id");
    owner.on_update = Cascade;
    let c = changes(&["orders_user_id_fkey", "orders_region_fkey"], vec![owner]);
    let stmts = apply_changes(&db, "orders", &c).await.unwrap();
    assert_eq!(stmts.len(), 1);

    let after = fetch_mysql_foreign_keys(&pool, "orders").await.unwrap();
    assert_eq!(names(&after), ["orders_owner_id_fkey"]);
    assert_eq!(after[0].on_update, Cascade);

    // MySQL indexed the new foreign key's column under the foreign key's name
    let indexes = crate::commands::indexes::fetch_mysql_indexes(&pool, "orders").await.unwrap();
    let auto = indexes.iter().find(|i| i.name == "orders_owner_id_fkey").unwrap();
    assert_eq!(auto.columns[0].name, "owner_id");
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn mysql_name_reuse_gets_clear_errors_and_changes_nothing() {
    let (_container, db, pool) = start_mysql().await;
    run_all(&db, &[
        "CREATE TABLE users (id INT PRIMARY KEY)",
        "CREATE TABLE orders ( \
            id INT PRIMARY KEY, \
            user_id INT, \
            owner_id INT, \
            CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) \
         )",
    ])
    .await;

    // Changing ON DELETE by dropping and re-adding under the same name in one save
    let mut same = add("orders_user_id_fkey", "user_id", "users", "id");
    same.on_delete = Cascade;
    let err = apply_changes(&db, "orders", &changes(&["orders_user_id_fkey"], vec![same])).await.unwrap_err();
    assert!(err.contains("same save that drops it"), "{err}");
    assert_eq!(names(&fetch_mysql_foreign_keys(&pool, "orders").await.unwrap()), ["orders_user_id_fkey"]);

    // Saving the drop first, then re-adding on the same column, works
    apply_changes(&db, "orders", &changes(&["orders_user_id_fkey"], vec![])).await.unwrap();
    let mut readd = add("orders_user_id_fkey", "user_id", "users", "id");
    readd.on_delete = Cascade;
    apply_changes(&db, "orders", &changes(&[], vec![readd])).await.unwrap();
    let after = fetch_mysql_foreign_keys(&pool, "orders").await.unwrap();
    assert_eq!(after[0].on_delete, Cascade);

    // The dropped key's leftover index blocks that name on another column
    apply_changes(&db, "orders", &changes(&["orders_user_id_fkey"], vec![])).await.unwrap();
    let moved = changes(&[], vec![add("orders_user_id_fkey", "owner_id", "users", "id")]);
    let err = apply_changes(&db, "orders", &moved).await.unwrap_err();
    assert!(err.contains("An index named \"orders_user_id_fkey\" already exists"), "{err}");
    assert!(fetch_mysql_foreign_keys(&pool, "orders").await.unwrap().is_empty());
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn mysql_reports_the_database_of_a_cross_database_reference() {
    let (_container, db, pool) = start_mysql().await;
    run_all(&db, &[
        "CREATE DATABASE billing",
        "CREATE TABLE billing.accounts (id INT PRIMARY KEY)",
        "CREATE TABLE users (id INT PRIMARY KEY)",
        "CREATE TABLE orders ( \
            id INT PRIMARY KEY, \
            account_id INT, \
            user_id INT, \
            CONSTRAINT orders_account_fkey FOREIGN KEY (account_id) REFERENCES billing.accounts (id), \
            CONSTRAINT orders_user_fkey FOREIGN KEY (user_id) REFERENCES users (id) \
         )",
    ])
    .await;

    let fks = fetch_mysql_foreign_keys(&pool, "orders").await.unwrap();
    let account = fks.iter().find(|f| f.name.as_deref() == Some("orders_account_fkey")).unwrap();
    assert_eq!(account.referenced_schema.as_deref(), Some("billing"));
    let user = fks.iter().find(|f| f.name.as_deref() == Some("orders_user_fkey")).unwrap();
    assert!(user.referenced_schema.is_none());
}
