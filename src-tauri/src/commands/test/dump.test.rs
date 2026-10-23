use super::*;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use sqlx::postgres::PgPoolOptions;
use sqlx::sqlite::SqlitePoolOptions;
use testcontainers_modules::{mysql::Mysql, postgres::Postgres, testcontainers::runners::AsyncRunner};

// ── Helpers ──────────────────────────────────────────────────────────────────

fn fk_to(table: &str) -> ForeignKey {
    ForeignKey { referenced_table: table.to_string(), ..Default::default() }
}

fn strings(names: &[&str]) -> Vec<String> {
    names.iter().map(|s| s.to_string()).collect()
}

/// A fresh path in the temp dir; any leftover file from an earlier run is removed.
fn dump_path(name: &str) -> String {
    let path = std::env::temp_dir().join(format!("orel-dump-{}-{name}.sql", std::process::id()));
    let _ = std::fs::remove_file(&path);
    path.to_string_lossy().to_string()
}

async fn run_all(db: &DbPool, stmts: &[&str]) {
    for stmt in stmts {
        db.execute(stmt).await.unwrap_or_else(|e| panic!("{stmt}: {e}"));
    }
}

async fn sqlite_memory() -> (DbPool, sqlx::SqlitePool) {
    // One connection, so every query sees the same in-memory database
    let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
    (DbPool::Sqlite(pool.clone()), pool)
}

// ── Table ordering ───────────────────────────────────────────────────────────

#[test]
fn creation_order_puts_parents_first_and_allows_self_references() {
    let tables = strings(&["order_items", "orders", "users"]);
    let fks = vec![vec![fk_to("orders")], vec![fk_to("users"), fk_to("orders")], vec![]];
    let order = creation_order(&tables, &fks).unwrap();
    assert_eq!(order, vec![2, 1, 0]);
}

#[test]
fn creation_order_names_the_tables_in_a_cycle() {
    let tables = strings(&["audit", "customers", "orders"]);
    let fks = vec![vec![fk_to("orders")], vec![fk_to("orders")], vec![fk_to("customers")]];
    let err = creation_order(&tables, &fks).unwrap_err();
    assert!(err.starts_with("Cannot export: circular foreign key dependency between tables 'orders' and 'customers'."), "{err}");
    assert!(!err.contains("audit"));

    let three = strings(&["a", "b", "c"]);
    let fks = vec![vec![fk_to("b")], vec![fk_to("c")], vec![fk_to("a")]];
    assert!(creation_order(&three, &fks).unwrap_err().contains("tables 'a', 'b' and 'c'."));
}

#[test]
fn views_follow_the_views_they_select_from() {
    let views = vec![
        ("top_spenders".to_string(), "CREATE VIEW top_spenders AS SELECT * FROM spend_totals".to_string()),
        ("spend_totals".to_string(), "CREATE VIEW spend_totals AS SELECT 1".to_string()),
    ];
    let ordered = order_views(views);
    assert!(ordered[0].contains("spend_totals AS SELECT 1"));
}

// ── Import helpers ───────────────────────────────────────────────────────────

#[test]
fn hints_at_dialect_mismatches() {
    let mysql_stmt = "CREATE TABLE `users` (`id` INT AUTO_INCREMENT PRIMARY KEY)";
    assert_eq!(
        dialect_mismatch_hint(Dialect::Postgres, mysql_stmt).as_deref(),
        Some("This looks like a MySQL dump; this connection is PostgreSQL.")
    );
    assert_eq!(dialect_mismatch_hint(Dialect::MySql, mysql_stmt), None);

    let pg_stmt = "CREATE TABLE users (id SERIAL PRIMARY KEY)";
    assert_eq!(
        dialect_mismatch_hint(Dialect::Sqlite, pg_stmt).as_deref(),
        Some("This looks like a PostgreSQL dump; this connection is SQLite.")
    );
    assert_eq!(dialect_mismatch_hint(Dialect::Postgres, "INSERT INTO t VALUES (1)"), None);
}

#[test]
fn counts_distinct_tables_and_truncates_snippets() {
    let statements = strings(&[
        "CREATE TABLE \"users\" (id int)",
        "CREATE TABLE IF NOT EXISTS orders(id int)",
        "INSERT INTO `users` (id) VALUES (1)",
        "ALTER TABLE ONLY orders ADD CONSTRAINT x FOREIGN KEY (id) REFERENCES users (id)",
        "CREATE VIEW v AS SELECT 1",
    ]);
    assert_eq!(count_tables(&statements), 2);

    let long = "x".repeat(300);
    assert_eq!(snippet(&long).chars().count(), SNIPPET_CHARS + 1);
    assert_eq!(snippet("SELECT 1"), "SELECT 1");
}

// ── SQLite (in-memory, no Docker) ────────────────────────────────────────────

#[tokio::test]
async fn sqlite_round_trip_keeps_schema_data_and_views() {
    let (db, pool) = sqlite_memory().await;
    // "orders" sorts before "users", so the dump must reorder them
    run_all(&db, &[
        "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, avatar BLOB, score REAL)",
        "CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), note TEXT, parent_id INTEGER REFERENCES orders(id))",
        "CREATE INDEX orders_user_idx ON orders (user_id)",
        "CREATE VIEW user_orders AS SELECT u.name, o.note FROM users u JOIN orders o ON o.user_id = u.id",
        "INSERT INTO users (name, avatar, score) VALUES ('O''Brien; C:\\ \"q\"', X'00FF', 12.5), ('猫\nline two', NULL, NULL)",
        "INSERT INTO orders (id, user_id, note, parent_id) VALUES (1, 2, '-- not a comment; /* nor this */', NULL), (2, 1, NULL, 1)",
    ]).await;

    let path = dump_path("sqlite-round-trip");
    let summary = export_dump(&db, &path).await.unwrap();
    assert_eq!((summary.tables_exported, summary.views_exported, summary.rows_exported), (2, 1, 4));
    let dump = std::fs::read_to_string(&path).unwrap();
    assert!(dump.find("CREATE TABLE users").unwrap() < dump.find("CREATE TABLE orders").unwrap());

    let (target, target_pool) = sqlite_memory().await;
    let imported = import_dump(&target, &path).await.unwrap();
    assert_eq!(imported.tables_affected, 2);

    let rows = |pool: sqlx::SqlitePool| async move {
        let users: Vec<(i64, String, Option<String>, Option<f64>)> =
            sqlx::query_as("SELECT id, name, hex(avatar), score FROM users ORDER BY id").fetch_all(&pool).await.unwrap();
        let orders: Vec<(i64, i64, Option<String>, Option<i64>)> =
            sqlx::query_as("SELECT * FROM orders ORDER BY id").fetch_all(&pool).await.unwrap();
        let view: Vec<(String, Option<String>)> =
            sqlx::query_as("SELECT * FROM user_orders ORDER BY name").fetch_all(&pool).await.unwrap();
        let indexes: Vec<String> =
            sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name").fetch_all(&pool).await.unwrap();
        (users, orders, view, indexes)
    };
    assert_eq!(rows(pool).await, rows(target_pool.clone()).await);

    // AUTOINCREMENT keeps counting from the imported ids
    sqlx::query("INSERT INTO users (name) VALUES ('new')").execute(&target_pool).await.unwrap();
    let id: i64 = sqlx::query_scalar("SELECT id FROM users WHERE name = 'new'").fetch_one(&target_pool).await.unwrap();
    assert_eq!(id, 3);
    std::fs::remove_file(&path).unwrap();
}

#[tokio::test]
async fn sqlite_circular_foreign_keys_fail_without_writing_a_file() {
    let (db, _pool) = sqlite_memory().await;
    // SQLite allows forward references in CREATE TABLE, so the cycle can exist
    run_all(&db, &[
        "CREATE TABLE customers (id INTEGER PRIMARY KEY, last_order_id INTEGER REFERENCES orders(id))",
        "CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id))",
    ]).await;

    let path = dump_path("sqlite-cycle");
    let err = export_dump(&db, &path).await.unwrap_err();
    assert!(err.contains("between tables 'customers' and 'orders'"), "{err}");
    assert!(err.contains("SQLite does not support adding foreign key constraints"));
    assert!(!std::path::Path::new(&path).exists());
}

#[tokio::test]
async fn import_reports_missing_and_empty_files() {
    let (db, _pool) = sqlite_memory().await;
    let err = import_dump(&db, &dump_path("does-not-exist")).await.unwrap_err();
    assert!(err.message.starts_with("Couldn't read"));
    assert_eq!(err.line, None);

    let path = dump_path("comments-only");
    std::fs::write(&path, "-- nothing to run;\n/* ; */\n").unwrap();
    let err = import_dump(&db, &path).await.unwrap_err();
    assert!(err.message.contains("doesn't contain any SQL statements"));
    std::fs::remove_file(&path).unwrap();
}

// ── Docker-backed integration tests ──────────────────────────────────────────

async fn start_pg() -> (testcontainers_modules::testcontainers::ContainerAsync<Postgres>, DbPool, String) {
    let container = Postgres::default().start().await.unwrap();
    let port = container.get_host_port_ipv4(5432).await.unwrap();
    let base = format!("postgres://postgres:postgres@127.0.0.1:{port}");
    let pool = PgPoolOptions::new().max_connections(2).connect(&format!("{base}/postgres")).await.unwrap();
    (container, DbPool::Postgres(pool), base)
}

/// Creates `name` on the server and returns a pool connected to it.
async fn pg_database(admin: &DbPool, base: &str, name: &str) -> (DbPool, sqlx::PgPool) {
    admin.execute(&format!("CREATE DATABASE {name}")).await.unwrap();
    let pool = PgPoolOptions::new().max_connections(2).connect(&format!("{base}/{name}")).await.unwrap();
    (DbPool::Postgres(pool.clone()), pool)
}

async fn pg_snapshot(pool: &sqlx::PgPool) -> Vec<String> {
    let mut rows: Vec<String> = Vec::new();
    for sql in [
        "SELECT row_to_json(t)::text FROM (SELECT * FROM users ORDER BY id) t",
        "SELECT row_to_json(t)::text FROM (SELECT * FROM orders ORDER BY id) t",
        "SELECT row_to_json(t)::text FROM (SELECT * FROM user_totals ORDER BY email) t",
        "SELECT conname::text || ' ' || pg_get_constraintdef(oid) FROM pg_constraint \
         WHERE connamespace = 'public'::regnamespace ORDER BY conname",
        "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname",
    ] {
        rows.extend(sqlx::query_scalar::<_, String>(sqlx::AssertSqlSafe(sql)).fetch_all(pool).await.unwrap());
    }
    rows
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn postgres_round_trip_with_circular_foreign_keys() {
    let (_container, admin, base) = start_pg().await;
    let (source, source_pool) = pg_database(&admin, &base, "source_db").await;
    run_all(&source, &[
        "CREATE TABLE users (id SERIAL PRIMARY KEY, email text NOT NULL UNIQUE, tags text[], profile jsonb, \
         avatar bytea, active boolean DEFAULT true, balance numeric(12,2) CHECK (balance >= 0), \
         joined timestamptz DEFAULT now(), favorite_order_id integer)",
        "CREATE TABLE orders (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, \
         user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, note text)",
        "ALTER TABLE users ADD CONSTRAINT users_favorite_order_fkey FOREIGN KEY (favorite_order_id) REFERENCES orders(id)",
        "CREATE INDEX orders_note_idx ON orders (lower(note)) WHERE note IS NOT NULL",
        "CREATE VIEW user_totals AS SELECT u.email, count(o.id) AS orders FROM users u LEFT JOIN orders o ON o.user_id = u.id GROUP BY u.email",
        "INSERT INTO users (email, tags, profile, avatar, balance, joined) VALUES \
         ('a@x.io', ARRAY['x', 'y;z'], '{\"k\": \"it''s\"}', '\\xCAFE', 10.50, '2024-01-02 03:04:05+00'), \
         ('b@x.io', NULL, NULL, NULL, NULL, '2024-02-03 00:00:00+00')",
        "INSERT INTO orders (user_id, note) VALUES (1, E'line\\nbreak; and \\\\ backslash'), (2, NULL)",
        "UPDATE users SET favorite_order_id = 2 WHERE id = 1",
    ]).await;

    let path = dump_path("postgres-round-trip");
    let summary = export_dump(&source, &path).await.unwrap();
    assert_eq!((summary.tables_exported, summary.views_exported, summary.rows_exported), (2, 1, 4));

    let (target, target_pool) = pg_database(&admin, &base, "target_db").await;
    import_dump(&target, &path).await.unwrap();
    assert_eq!(pg_snapshot(&source_pool).await, pg_snapshot(&target_pool).await);

    // Sequences continue after the imported ids
    target.execute("INSERT INTO users (email) VALUES ('c@x.io')").await.unwrap();
    target.execute("INSERT INTO orders (user_id) VALUES (3)").await.unwrap();
    let ids: (i32, i32) = sqlx::query_as("SELECT (SELECT max(id) FROM users), (SELECT max(id) FROM orders)")
        .fetch_one(&target_pool)
        .await
        .unwrap();
    assert_eq!(ids, (3, 3));
    std::fs::remove_file(&path).unwrap();
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn postgres_import_of_mysql_dump_rolls_back_and_explains() {
    let (_container, admin, _base) = start_pg().await;
    let path = dump_path("mysql-into-postgres");
    std::fs::write(
        &path,
        "CREATE TABLE plain (id integer);\r\n\r\n-- the next one is MySQL\r\nCREATE TABLE `users` (\r\n  `id` INT AUTO_INCREMENT PRIMARY KEY\r\n) ENGINE=InnoDB;\r\n",
    )
    .unwrap();

    let err = import_dump(&admin, &path).await.unwrap_err();
    assert_eq!(err.line, Some(4));
    assert!(err.snippet.as_deref().unwrap().starts_with("CREATE TABLE `users` ("));
    assert!(err.message.contains("syntax error"), "{}", err.message);
    assert_eq!(err.hint.as_deref(), Some("This looks like a MySQL dump; this connection is PostgreSQL."));

    let DbPool::Postgres(pg) = &admin else { unreachable!() };
    let created: Option<String> = sqlx::query_scalar("SELECT to_regclass('public.plain')::text").fetch_one(pg).await.unwrap();
    assert_eq!(created, None, "the first statement must be rolled back");
    std::fs::remove_file(&path).unwrap();
}

async fn mysql_database(host: &str, port: u16, name: &str) -> (DbPool, sqlx::MySqlPool) {
    let opts = MySqlConnectOptions::new().host(host).port(port).username("root").database(name);
    let pool = MySqlPoolOptions::new().max_connections(2).connect_with(opts).await.unwrap();
    (DbPool::MySql(pool.clone()), pool)
}

async fn mysql_snapshot(pool: &sqlx::MySqlPool) -> Vec<String> {
    let mut rows: Vec<String> = Vec::new();
    for sql in [
        "SELECT CAST(JSON_ARRAY(id, email, bio, HEX(avatar), BIN(flags), CAST(price AS CHAR), \
         CAST(created AS CHAR), doc, email_domain, favorite_order_id) AS CHAR) FROM users ORDER BY id",
        "SELECT CAST(JSON_ARRAY(id, user_id, note) AS CHAR) FROM orders ORDER BY id",
        "SELECT CAST(JSON_ARRAY(email, orders) AS CHAR) FROM user_totals ORDER BY email",
        "SELECT CAST(CONCAT_WS(' ', TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME) AS CHAR) \
         FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() \
         ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
        "SELECT CAST(CONCAT_WS(' ', TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME) AS CHAR) \
         FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() \
         ORDER BY CONSTRAINT_NAME",
    ] {
        rows.extend(sqlx::query_scalar::<_, String>(sqlx::AssertSqlSafe(sql)).fetch_all(pool).await.unwrap());
    }
    rows
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn mysql_round_trip_with_circular_foreign_keys() {
    let container = Mysql::default().start().await.unwrap();
    let port = container.get_host_port_ipv4(3306).await.unwrap();
    let host = container.get_host().await.unwrap().to_string();
    let (source, source_pool) = mysql_database(&host, port, "test").await;
    run_all(&source, &[
        "CREATE DATABASE restored",
        "CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(100) NOT NULL UNIQUE, \
         bio TEXT, avatar BLOB, flags BIT(3), price DECIMAL(10,2) DEFAULT '0.00', created DATETIME, doc JSON, \
         email_domain VARCHAR(100) GENERATED ALWAYS AS (SUBSTRING_INDEX(email, '@', -1)) STORED, \
         favorite_order_id INT, KEY bio_prefix (bio(10)))",
        "CREATE TABLE orders (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, note VARCHAR(50), \
         CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE)",
        "ALTER TABLE users ADD CONSTRAINT users_fav_fk FOREIGN KEY (favorite_order_id) REFERENCES orders (id)",
        "CREATE VIEW user_totals AS SELECT u.email, COUNT(o.id) AS orders FROM users u LEFT JOIN orders o ON o.user_id = u.id GROUP BY u.email",
        "INSERT INTO users (email, bio, avatar, flags, price, created, doc) VALUES \
         ('a@x.io', 'it''s; a \\\\ backslash\\nand newline', X'00CAFE', b'101', 12.34, '2024-01-02 03:04:05', '{\"k\": \"v\\\\\"q\"}'), \
         ('b@y.io', NULL, X'', NULL, NULL, NULL, NULL)",
        "INSERT INTO orders (user_id, note) VALUES (1, '猫 -- not a comment'), (2, NULL)",
        "UPDATE users SET favorite_order_id = 2 WHERE id = 1",
    ]).await;

    let path = dump_path("mysql-round-trip");
    let summary = export_dump(&source, &path).await.unwrap();
    assert_eq!((summary.tables_exported, summary.views_exported, summary.rows_exported), (2, 1, 4));

    let (target, target_pool) = mysql_database(&host, port, "restored").await;
    import_dump(&target, &path).await.unwrap();
    assert_eq!(mysql_snapshot(&source_pool).await, mysql_snapshot(&target_pool).await);

    // AUTO_INCREMENT continues after the imported ids
    target.execute("INSERT INTO users (email) VALUES ('c@z.io')").await.unwrap();
    let id: i32 = sqlx::query_scalar("SELECT MAX(id) FROM users").fetch_one(&target_pool).await.unwrap();
    assert_eq!(id, 3);
    std::fs::remove_file(&path).unwrap();
}
