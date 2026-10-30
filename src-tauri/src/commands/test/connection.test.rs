use super::{
    create_database_on_pool, drop_database_on_pool, load_connections_from, mysql_user_databases,
    reorder_connections_in, sqlite_opts, sqlite_pool_max_connections, DbPool,
};
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

mod drop_database {
    use super::*;

    #[tokio::test]
    #[ignore = "requires Docker"]
    async fn mysql_drops_and_rejects_missing() {
        use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};
        use testcontainers_modules::{mysql::Mysql, testcontainers::runners::AsyncRunner};

        let container = Mysql::default().start().await.unwrap();
        let port = container.get_host_port_ipv4(3306).await.unwrap();
        let host = container.get_host().await.unwrap().to_string();
        let opts = MySqlConnectOptions::new().host(&host).port(port).username("root").database("test");
        let pool = MySqlPoolOptions::new().max_connections(1).connect_with(opts).await.unwrap();
        let db_pool = DbPool::MySql(pool.clone());

        create_database_on_pool(&db_pool, "doomed_orel_db").await.unwrap();
        drop_database_on_pool(&db_pool, "doomed_orel_db").await.unwrap();

        let names: Vec<String> = sqlx::query_scalar(
            "SELECT CAST(SCHEMA_NAME AS CHAR) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
        )
        .bind("doomed_orel_db")
        .fetch_all(&pool)
        .await
        .unwrap();
        assert!(names.is_empty());

        // Dropping a database that no longer exists should surface the driver's error.
        let missing = drop_database_on_pool(&db_pool, "doomed_orel_db").await;
        assert!(missing.is_err());
    }

    #[tokio::test]
    #[ignore = "requires Docker"]
    async fn postgres_drops_and_rejects_missing() {
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

        create_database_on_pool(&db_pool, "doomed_orel_db").await.unwrap();
        drop_database_on_pool(&db_pool, "doomed_orel_db").await.unwrap();

        let names: Vec<String> = sqlx::query_scalar("SELECT datname FROM pg_database WHERE datname = $1")
            .bind("doomed_orel_db")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(names.is_empty());

        let missing = drop_database_on_pool(&db_pool, "doomed_orel_db").await;
        assert!(missing.is_err());
    }
}

mod connection_ordering {
    use super::*;

    async fn app_db() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        for (id, created_at) in [("a", "2026-01-01"), ("b", "2026-01-02"), ("c", "2026-01-03")] {
            sqlx::query("INSERT INTO connections (id, name, type, host, port, username, password, created_at, updated_at) VALUES (?, ?, 'sqlite', 'x', 0, '', '', ?, ?)")
                .bind(id)
                .bind(id)
                .bind(created_at)
                .bind(created_at)
                .execute(&pool)
                .await
                .unwrap();
        }
        pool
    }

    async fn ids(pool: &sqlx::SqlitePool) -> Vec<String> {
        load_connections_from(pool)
            .await
            .unwrap()
            .into_iter()
            .map(|c| c.id)
            .collect()
    }

    #[tokio::test]
    async fn unordered_connections_keep_newest_first() {
        let pool = app_db().await;
        assert_eq!(ids(&pool).await, vec!["c", "b", "a"]);
    }

    #[tokio::test]
    async fn reorder_persists_the_given_order() {
        let pool = app_db().await;
        let order = vec!["b".to_string(), "a".to_string(), "c".to_string()];
        reorder_connections_in(&pool, &order).await.unwrap();
        assert_eq!(ids(&pool).await, order);
    }
}
