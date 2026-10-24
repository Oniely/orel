use super::{create_database_on_pool, mysql_user_databases, sqlite_opts, sqlite_pool_max_connections, DbPool};
use sqlx::sqlite::SqlitePoolOptions;
use std::time::Duration;

mod mysql_database_filtering {
    use super::*;

    #[test]
    fn removes_system_databases() {
        let databases = vec![
            "information_schema".to_string(),
            "mysql".to_string(),
            "production".to_string(),
            "sys".to_string(),
        ];

        assert_eq!(mysql_user_databases(databases), vec!["production"]);
    }

    #[test]
    fn matching_is_case_insensitive() {
        let databases = vec!["INFORMATION_SCHEMA".to_string(), "app".to_string()];
        assert_eq!(mysql_user_databases(databases), vec!["app"]);
    }
}

mod sqlite_pooling {
    use super::*;

    #[test]
    fn memory_paths_are_limited_to_one_connection() {
        for path in [
            ":memory:",
            "sqlite::memory:",
            "file::memory:?cache=shared",
            "file:orel?mode=memory&cache=shared",
        ] {
            assert_eq!(sqlite_pool_max_connections(path), 1, "path: {path}");
        }
        assert_eq!(sqlite_pool_max_connections("orel.sqlite3"), 4);
    }

    #[tokio::test]
    async fn memory_pool_cannot_open_an_unrelated_second_database() {
        let path = ":memory:";
        let pool = SqlitePoolOptions::new()
            .max_connections(sqlite_pool_max_connections(path))
            .connect_with(sqlite_opts(path).unwrap())
            .await
            .unwrap();
        let mut first = pool.acquire().await.unwrap();
        sqlx::query("CREATE TABLE visible_from_pool (id INTEGER PRIMARY KEY)")
            .execute(&mut *first)
            .await
            .unwrap();

        assert!(
            tokio::time::timeout(Duration::from_millis(30), pool.acquire())
                .await
                .is_err()
        );
        drop(first);

        let mut reused = pool.acquire().await.unwrap();
        let table_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'visible_from_pool'",
        )
        .fetch_one(&mut *reused)
        .await
        .unwrap();
        assert_eq!(table_count, 1);
    }
}

mod create_database {
    use super::*;

    #[tokio::test]
    #[ignore = "requires Docker"]
    async fn mysql_creates_and_rejects_duplicate() {
        use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
        use testcontainers_modules::{mysql::Mysql, testcontainers::runners::AsyncRunner};

        let container = Mysql::default().start().await.unwrap();
        let port = container.get_host_port_ipv4(3306).await.unwrap();
        let host = container.get_host().await.unwrap().to_string();
        let opts = MySqlConnectOptions::new().host(&host).port(port).username("root").database("test");
        let pool = MySqlPoolOptions::new().max_connections(1).connect_with(opts).await.unwrap();
        let db_pool = DbPool::MySql(pool.clone());

        create_database_on_pool(&db_pool, "fresh_orel_db").await.unwrap();

        let names: Vec<String> = sqlx::query_scalar(
            "SELECT CAST(SCHEMA_NAME AS CHAR) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
        )
        .bind("fresh_orel_db")
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(names, vec!["fresh_orel_db"]);

        // Creating the same database again should surface the driver's error.
        let duplicate = create_database_on_pool(&db_pool, "fresh_orel_db").await;
        assert!(duplicate.is_err());
    }

    #[tokio::test]
    #[ignore = "requires Docker"]
    async fn postgres_creates_and_rejects_duplicate() {
        use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
        use testcontainers_modules::{postgres::Postgres, testcontainers::runners::AsyncRunner};

        let container = Postgres::default().start().await.unwrap();
        let port = container.get_host_port_ipv4(5432).await.unwrap();
        let host = container.get_host().await.unwrap().to_string();
        let opts = PgConnectOptions::new()
            .host(&host)
            .port(port)
            .username("postgres")
            .password("postgres")
            .database("postgres");
        let pool = PgPoolOptions::new().max_connections(1).connect_with(opts).await.unwrap();
        let db_pool = DbPool::Postgres(pool.clone());

        create_database_on_pool(&db_pool, "fresh_orel_db").await.unwrap();

        let names: Vec<String> = sqlx::query_scalar("SELECT datname FROM pg_database WHERE datname = $1")
            .bind("fresh_orel_db")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(names, vec!["fresh_orel_db"]);

        let duplicate = create_database_on_pool(&db_pool, "fresh_orel_db").await;
        assert!(duplicate.is_err());
    }
}
