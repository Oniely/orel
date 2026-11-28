use super::*;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
use sqlx::postgres::PgPoolOptions;
use sqlx::sqlite::SqlitePoolOptions;
use testcontainers_modules::{mysql::Mysql, postgres::Postgres, testcontainers::runners::AsyncRunner};

fn col(name: &str, data_type: &str, is_primary: bool) -> ColumnInfo {
    ColumnInfo {
        name: name.to_string(),
        data_type: data_type.to_string(),
        is_nullable: true,
        is_primary,
        has_default: false,
        enum_values: Vec::new(),
    }
}

fn users_fk(schema: Option<&str>) -> ForeignKey {
    ForeignKey {
        columns: vec!["user_id".to_string()],
        referenced_schema: schema.map(str::to_string),
        referenced_table: "users".to_string(),
        referenced_columns: vec!["id".to_string()],
        ..Default::default()
    }
}

fn opt(value: &str, label: Option<&str>) -> FkOption {
    FkOption { value: value.to_string(), label: label.map(str::to_string) }
}

#[test]
fn label_prefers_known_names_then_first_text_column() {
    let cols = [col("id", "integer", true), col("bio", "text", false), col("Email", "varchar", false), col("Title", "varchar", false)];
    assert_eq!(pick_label_column(&cols, "id").as_deref(), Some("Title"));

    let cols = [col("id", "integer", true), col("age", "integer", false), col("bio", "character varying", false)];
    assert_eq!(pick_label_column(&cols, "id").as_deref(), Some("bio"));

    // Text keys aren't their own label
    let cols = [col("code", "text", true), col("rank", "integer", false)];
    assert_eq!(pick_label_column(&cols, "code"), None);
}

#[test]
fn options_sql_quotes_identifiers_and_binds_search_per_column() {
    let (sql, binds) = fk_options_sql(Dialect::Postgres, &users_fk(Some("auth")), Some("name"));
    assert_eq!(
        sql,
        "SELECT (\"id\")::text, (\"name\")::text FROM \"auth\".\"users\" WHERE \"id\" IS NOT NULL AND \
         (LOWER((\"id\")::text) LIKE $1 ESCAPE '!' OR LOWER((\"name\")::text) LIKE $2 ESCAPE '!') ORDER BY \"auth\".\"users\".\"id\" LIMIT 100"
    );
    assert_eq!(binds, 2);

    let (sql, binds) = fk_options_sql(Dialect::MySql, &users_fk(None), None);
    assert_eq!(
        sql,
        "SELECT CAST(`id` AS CHAR), CAST(NULL AS CHAR) FROM `users` WHERE `id` IS NOT NULL AND \
         (LOWER(CAST(`id` AS CHAR)) LIKE ? ESCAPE '!') ORDER BY `users`.`id` LIMIT 100"
    );
    assert_eq!(binds, 1);
}

#[test]
fn like_pattern_escapes_wildcards_and_lowercases() {
    assert_eq!(like_pattern(" Ann_100%! "), "%ann!_100!%!!%");
    assert_eq!(like_pattern(""), "%%");
}

const SEED: [&str; 5] = [
    "CREATE TABLE users (id INTEGER PRIMARY KEY, age INTEGER, full_name VARCHAR(50))",
    "CREATE TABLE regions (country VARCHAR(2), code VARCHAR(5), PRIMARY KEY (country, code))",
    // MySQL ignores column-level REFERENCES, so both keys are table constraints
    "CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, country VARCHAR(2), code VARCHAR(5), \
        FOREIGN KEY (user_id) REFERENCES users (id), FOREIGN KEY (country, code) REFERENCES regions (country, code))",
    "INSERT INTO users (id, age, full_name) VALUES (1, 30, 'Ada Lovelace'), (2, 41, 'Alan Turing'), (12, 25, 'Grace 100% Hopper')",
    "INSERT INTO regions VALUES ('US', 'CA')",
];

async fn assert_options(db: &DbPool) {
    let all = fetch_fk_options_on_pool(db, "orders", "user_id", "").await.unwrap();
    assert_eq!(
        all,
        [opt("1", Some("Ada Lovelace")), opt("2", Some("Alan Turing")), opt("12", Some("Grace 100% Hopper"))]
    );
    // Matches the label case-insensitively, or the key
    assert_eq!(fetch_fk_options_on_pool(db, "orders", "user_id", "TURING").await.unwrap(), [opt("2", Some("Alan Turing"))]);
    assert_eq!(
        fetch_fk_options_on_pool(db, "orders", "user_id", "2").await.unwrap(),
        [opt("2", Some("Alan Turing")), opt("12", Some("Grace 100% Hopper"))]
    );
    // Wildcards are literal
    assert_eq!(fetch_fk_options_on_pool(db, "orders", "user_id", "0%").await.unwrap(), [opt("12", Some("Grace 100% Hopper"))]);
    assert_eq!(fetch_fk_options_on_pool(db, "orders", "user_id", "_").await.unwrap(), []);

    let err = fetch_fk_options_on_pool(db, "orders", "country", "").await.unwrap_err();
    assert!(err.contains("single-column"), "{err}");
    assert!(fetch_fk_options_on_pool(db, "orders", "id", "").await.is_err());
}

#[tokio::test]
async fn sqlite_fk_options_search_keys_and_labels() {
    let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
    let db = DbPool::Sqlite(pool);
    for sql in SEED {
        db.execute(sql).await.unwrap();
    }
    assert_options(&db).await;
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn pg_fk_options_search_keys_and_labels() {
    let container = Postgres::default().start().await.unwrap();
    let port = container.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");
    let db = DbPool::Postgres(PgPoolOptions::new().max_connections(1).connect(&url).await.unwrap());
    for sql in SEED {
        db.execute(sql).await.unwrap();
    }
    assert_options(&db).await;

    // A key in another schema still lists, without a label
    db.execute("CREATE SCHEMA crm").await.unwrap();
    db.execute("CREATE TABLE crm.accounts (id INTEGER PRIMARY KEY, name TEXT)").await.unwrap();
    db.execute("INSERT INTO crm.accounts VALUES (7, 'Acme')").await.unwrap();
    db.execute("ALTER TABLE orders ADD COLUMN account_id INTEGER REFERENCES crm.accounts (id)").await.unwrap();
    assert_eq!(fetch_fk_options_on_pool(&db, "orders", "account_id", "").await.unwrap(), [opt("7", None)]);
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn mysql_fk_options_search_keys_and_labels() {
    let container = Mysql::default().start().await.unwrap();
    let port = container.get_host_port_ipv4(3306).await.unwrap();
    let host = container.get_host().await.unwrap().to_string();
    let opts = MySqlConnectOptions::new().host(&host).port(port).username("root").database("test");
    let db = DbPool::MySql(MySqlPoolOptions::new().max_connections(1).connect_with(opts).await.unwrap());
    for sql in SEED {
        db.execute(sql).await.unwrap();
    }
    assert_options(&db).await;
}
