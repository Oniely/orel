use super::*;

fn split(sql: &str, dialect: Dialect) -> Vec<(String, usize)> {
    split_sql_statements(sql, dialect)
        .into_iter()
        .map(|s| (s.sql, s.line))
        .collect()
}

#[test]
fn ignores_semicolons_inside_quoted_strings() {
    let sql = "INSERT INTO t VALUES ('a;b', 'it''s;');\nINSERT INTO t VALUES (\"x;y\");";
    let statements = split(sql, Dialect::Postgres);
    assert_eq!(statements.len(), 2);
    assert_eq!(statements[0], ("INSERT INTO t VALUES ('a;b', 'it''s;')".to_string(), 1));
    assert_eq!(statements[1].1, 2);
}

#[test]
fn backslash_escapes_follow_the_dialect() {
    // MySQL: \' stays inside the string
    let mysql = split("INSERT INTO t VALUES ('a\\';b');\nSELECT 1;", Dialect::MySql);
    assert_eq!(mysql.len(), 2);

    // SQLite and plain Postgres strings treat a backslash literally, so 'C:\' ends the string
    let sqlite = split("INSERT INTO t VALUES ('C:\\');\nSELECT 1;", Dialect::Sqlite);
    assert_eq!(sqlite.len(), 2);
    let pg = split("INSERT INTO t VALUES ('C:\\', E'q\\';');\nSELECT 1;", Dialect::Postgres);
    assert_eq!(pg.len(), 2);
    assert_eq!(pg[1], ("SELECT 1".to_string(), 2));
}

#[test]
fn block_comment_with_semicolon_is_not_a_split_point() {
    let sql = "/* setup; part one */\nCREATE TABLE a (id int);\n\nCREATE /* inline; */ TABLE b (id int);";
    let statements = split(sql, Dialect::Postgres);
    assert_eq!(statements.len(), 2);
    assert_eq!(statements[0], ("CREATE TABLE a (id int)".to_string(), 2));
    assert_eq!(statements[1].1, 4);
    assert!(statements[1].0.contains("inline;"));
}

#[test]
fn line_comments_and_comment_only_fragments_are_skipped() {
    let sql = "-- header; still a comment\n# mysql comment;\nSELECT 1; -- trailing;\n-- nothing here;\n";
    let statements = split(sql, Dialect::MySql);
    assert_eq!(statements, vec![("SELECT 1".to_string(), 3)]);
}

#[test]
fn mysql_delimiter_blocks() {
    let sql = "CREATE TABLE t (id INT);\n\
               DELIMITER $$\n\
               CREATE PROCEDURE p()\n\
               BEGIN\n\
                 INSERT INTO t VALUES (1);\n\
                 INSERT INTO t VALUES (2);\n\
               END$$\n\
               DELIMITER ;\n\
               INSERT INTO t VALUES (3);\n";
    let statements = split(sql, Dialect::MySql);
    assert_eq!(statements.len(), 3);
    assert_eq!(statements[0].1, 1);
    assert!(statements[1].0.starts_with("CREATE PROCEDURE p()"));
    assert!(statements[1].0.ends_with("END"));
    assert_eq!(statements[1].1, 3);
    assert_eq!(statements[2], ("INSERT INTO t VALUES (3)".to_string(), 9));
    assert!(statements.iter().all(|(sql, _)| !sql.contains("DELIMITER")));
}

#[test]
fn postgres_dollar_quoted_bodies_stay_whole() {
    let sql = "CREATE FUNCTION f() RETURNS void AS $$\nBEGIN\n  PERFORM 1;\n  PERFORM 2;\nEND;\n$$ LANGUAGE plpgsql;\n\
               CREATE FUNCTION g() RETURNS text AS $body$ SELECT 'é;'; $body$ LANGUAGE sql;\n\
               SELECT f();";
    let statements = split(sql, Dialect::Postgres);
    assert_eq!(statements.len(), 3);
    assert!(statements[0].0.ends_with("$$ LANGUAGE plpgsql"));
    assert_eq!(statements[1].1, 7);
    assert!(statements[1].0.contains("$body$ SELECT 'é;'; $body$"));
    assert_eq!(statements[2], ("SELECT f()".to_string(), 8));
}

#[test]
fn crlf_line_endings() {
    let sql = "CREATE TABLE a (id int);\r\n\r\n-- note\r\nINSERT INTO a VALUES (1);\r\nDELIMITER //\r\nSELECT 2//\r\nDELIMITER ;\r\nSELECT 3;";
    let statements = split(sql, Dialect::MySql);
    assert_eq!(
        statements,
        vec![
            ("CREATE TABLE a (id int)".to_string(), 1),
            ("INSERT INTO a VALUES (1)".to_string(), 4),
            ("SELECT 2".to_string(), 6),
            ("SELECT 3".to_string(), 8),
        ]
    );
}

#[test]
fn final_statement_without_terminator_is_kept() {
    assert_eq!(split("SELECT 1;\n  SELECT 2  ", Dialect::Sqlite), vec![
        ("SELECT 1".to_string(), 1),
        ("SELECT 2".to_string(), 2),
    ]);
}
