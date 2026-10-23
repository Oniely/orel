// SQL script splitting, shared by the SQL editor and dump import.

use super::sql_util::Dialect;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StatementSpan {
    pub sql: String,
    /// 1-indexed line the statement's first token is on.
    pub line: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum ScanState {
    Normal,
    /// `true` when backslash escapes apply: MySQL, or a Postgres `E'...'` string.
    SingleQuote(bool),
    DoubleQuote,
    Backtick,
    LineComment,
    BlockComment(usize),
    DollarQuote(String),
}

fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

/// Postgres only honors backslash escapes in `E'...'` strings.
fn is_escape_string(bytes: &[u8], quote: usize, dialect: Dialect) -> bool {
    match dialect {
        Dialect::MySql => true,
        Dialect::Postgres => {
            quote > 0
                && bytes[quote - 1].eq_ignore_ascii_case(&b'e')
                && (quote == 1 || !is_word_byte(bytes[quote - 2]))
        }
        Dialect::Sqlite => false,
    }
}

/// MySQL client `DELIMITER x` directive at `index`: returns the new delimiter
/// and the end of its line. No server understands it, so it's never executed.
fn delimiter_directive(sql: &str, index: usize) -> Option<(String, usize)> {
    let rest = sql.get(index..)?;
    let keyword = rest.get(..9)?;
    if !keyword.eq_ignore_ascii_case("DELIMITER") || !rest[9..].starts_with([' ', '\t']) {
        return None;
    }
    let line_end = rest.find('\n').map_or(sql.len(), |end| index + end);
    let delimiter = sql[index + 9..line_end].split_whitespace().next()?;
    Some((delimiter.to_string(), line_end))
}

/// Splits a script on the current delimiter, skipping comment-only fragments.
/// Quoted strings and identifiers, comments, and dollar-quoted bodies are
/// opaque. On MySQL, `DELIMITER` lines change the delimiter and are dropped.
pub(crate) fn split_sql_statements(sql: &str, dialect: Dialect) -> Vec<StatementSpan> {
    let bytes = sql.as_bytes();
    let mut state = ScanState::Normal;
    let mut statements = Vec::new();
    let mut delimiter = ";".to_string();
    // Byte offset and line of the current statement's first token, once seen
    let mut code_start: Option<(usize, usize)> = None;
    let (mut line, mut line_counted_to) = (1, 0);
    let mut index = 0;
    while index < bytes.len() {
        match &mut state {
            ScanState::Normal => {
                if bytes[index..].starts_with(delimiter.as_bytes()) {
                    if let Some((start, line)) = code_start.take() {
                        statements.push(StatementSpan { sql: sql[start..index].trim_end().to_string(), line });
                    }
                    index += delimiter.len();
                    continue;
                }
                let next = bytes.get(index + 1).copied();
                let starts_comment = (bytes[index] == b'-' && next == Some(b'-'))
                    || (bytes[index] == b'/' && next == Some(b'*'))
                    || (bytes[index] == b'#' && dialect == Dialect::MySql);
                if !starts_comment && !bytes[index].is_ascii_whitespace() && code_start.is_none() {
                    if dialect == Dialect::MySql {
                        if let Some((new_delimiter, line_end)) = delimiter_directive(sql, index) {
                            delimiter = new_delimiter;
                            index = line_end;
                            continue;
                        }
                    }
                    line += bytes[line_counted_to..index].iter().filter(|b| **b == b'\n').count();
                    line_counted_to = index;
                    code_start = Some((index, line));
                }
                match bytes[index] {
                    b'\'' => state = ScanState::SingleQuote(is_escape_string(bytes, index, dialect)),
                    b'"' => state = ScanState::DoubleQuote,
                    b'`' => state = ScanState::Backtick,
                    b'-' | b'#' | b'/' if starts_comment => {
                        if bytes[index] == b'/' {
                            state = ScanState::BlockComment(1);
                        } else {
                            state = ScanState::LineComment;
                        }
                        index += usize::from(bytes[index] != b'#');
                    }
                    b'$' => {
                        if let Some(relative_end) =
                            bytes[index + 1..].iter().position(|byte| *byte == b'$')
                        {
                            let end = index + 1 + relative_end;
                            let tag = &sql[index..=end];
                            if tag[1..tag.len() - 1]
                                .chars()
                                .all(|character| character.is_ascii_alphanumeric() || character == '_')
                            {
                                state = ScanState::DollarQuote(tag.to_string());
                                index = end;
                            }
                        }
                    }
                    _ => {}
                }
            }
            ScanState::SingleQuote(backslash_escapes) => match bytes[index] {
                b'\\' if *backslash_escapes => index += usize::from(index + 1 < bytes.len()),
                b'\'' if bytes.get(index + 1) == Some(&b'\'') => index += 1,
                b'\'' => state = ScanState::Normal,
                _ => {}
            },
            ScanState::DoubleQuote => {
                if bytes[index] == b'"' {
                    if bytes.get(index + 1) == Some(&b'"') {
                        index += 1;
                    } else {
                        state = ScanState::Normal;
                    }
                }
            }
            ScanState::Backtick => {
                if bytes[index] == b'`' {
                    if bytes.get(index + 1) == Some(&b'`') {
                        index += 1;
                    } else {
                        state = ScanState::Normal;
                    }
                }
            }
            ScanState::LineComment => {
                if bytes[index] == b'\n' {
                    state = ScanState::Normal;
                }
            }
            ScanState::BlockComment(depth) => {
                if bytes[index] == b'/' && bytes.get(index + 1) == Some(&b'*') {
                    *depth += 1;
                    index += 1;
                } else if bytes[index] == b'*' && bytes.get(index + 1) == Some(&b'/') {
                    *depth -= 1;
                    index += 1;
                    if *depth == 0 {
                        state = ScanState::Normal;
                    }
                }
            }
            ScanState::DollarQuote(tag) => {
                // Bytes, not `sql[index..]`: index can sit inside a multi-byte character here
                if bytes[index..].starts_with(tag.as_bytes()) {
                    index += tag.len() - 1;
                    state = ScanState::Normal;
                }
            }
        }
        index += 1;
    }
    if let Some((start, line)) = code_start {
        statements.push(StatementSpan { sql: sql[start..].trim_end().to_string(), line });
    }
    statements
}

#[cfg(test)]
#[path = "test/sql_split.test.rs"]
mod tests;
