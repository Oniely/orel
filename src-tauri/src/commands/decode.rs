use bigdecimal::BigDecimal;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{mysql::MySqlRow, postgres::PgRow, sqlite::SqliteRow, Column, Row, TypeInfo, ValueRef};
use uuid::Uuid;

// ── Cell type ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlCell {
    pub kind: &'static str,
    pub display: Option<String>,
}

pub fn cell(kind: &'static str, display: impl Into<String>) -> SqlCell {
    SqlCell { kind, display: Some(display.into()) }
}

pub fn null_cell() -> SqlCell {
    SqlCell { kind: "null", display: None }
}

pub fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(bytes.len() * 2 + 2);
    out.push_str("0x");
    for byte in bytes {
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    out
}

// ── Decode functions ──────────────────────────────────────────────────────────

pub fn decode_pg(row: &PgRow, index: usize) -> SqlCell {
    let raw = match row.try_get_raw(index) {
        Ok(raw) => raw,
        Err(error) => return cell("text", format!("<decode error: {error}>")),
    };
    if raw.is_null() {
        return null_cell();
    }
    let type_name = row.columns()[index].type_info().name().to_ascii_lowercase();
    macro_rules! decoded {
        ($ty:ty, $kind:literal) => {
            if let Ok(value) = row.try_get::<$ty, _>(index) {
                return cell($kind, value.to_string());
            }
        };
    }
    match type_name.as_str() {
        "bool" => decoded!(bool, "boolean"),
        "int2" => decoded!(i16, "number"),
        "int4" => decoded!(i32, "number"),
        "int8" => decoded!(i64, "number"),
        "float4" => decoded!(f32, "number"),
        "float8" => decoded!(f64, "number"),
        "numeric" => decoded!(BigDecimal, "number"),
        "uuid" => decoded!(Uuid, "text"),
        "date" => decoded!(NaiveDate, "text"),
        "time" => decoded!(NaiveTime, "text"),
        "timestamp" => decoded!(NaiveDateTime, "text"),
        "timestamptz" => decoded!(DateTime<Utc>, "text"),
        "json" | "jsonb" => decoded!(Value, "json"),
        // pg_type.typname uses underscore prefix for array types (_jsonb, _text, etc.)
        "_jsonb" | "_json" => {
            if let Ok(values) = row.try_get::<Vec<Value>, _>(index) {
                return cell("json", serde_json::to_string(&values).unwrap_or_default());
            }
        }
        "_text" | "_varchar" | "_bpchar" | "_name" => {
            if let Ok(values) = row.try_get::<Vec<String>, _>(index) {
                return cell("text", serde_json::to_string(&values).unwrap_or_default());
            }
        }
        "bytea" => {
            if let Ok(value) = row.try_get::<Vec<u8>, _>(index) {
                return cell("binary", hex(&value));
            }
        }
        _ => decoded!(String, "text"),
    }
    match raw.as_bytes() {
        Ok(bytes) => match std::str::from_utf8(bytes) {
            Ok(text) => cell("text", text),
            Err(_) => cell("binary", hex(bytes)),
        },
        Err(error) => cell("text", format!("<unsupported {type_name}: {error}>")),
    }
}

pub fn decode_mysql(row: &MySqlRow, index: usize) -> SqlCell {
    if row.try_get_raw(index).map_or(true, |raw| raw.is_null()) {
        return null_cell();
    }
    let type_name = row.columns()[index].type_info().name().to_ascii_lowercase();
    macro_rules! decoded {
        ($ty:ty, $kind:literal) => {
            if let Ok(value) = row.try_get::<$ty, _>(index) {
                return cell($kind, value.to_string());
            }
        };
    }
    match type_name.as_str() {
        "boolean" | "bool" => decoded!(bool, "boolean"),
        "tinyint" | "tinyint unsigned" | "smallint" | "smallint unsigned" | "mediumint"
        | "mediumint unsigned" | "int" | "int unsigned" | "bigint" | "bigint unsigned" => {
            decoded!(i64, "number");
            decoded!(u64, "number");
        }
        "float" | "double" => {
            decoded!(f64, "number");
            decoded!(String, "text");
        }
        "decimal" | "newdecimal" => {
            decoded!(BigDecimal, "number");
            decoded!(String, "text");
        }
        "date" => {
            decoded!(NaiveDate, "text");
            decoded!(String, "text");
        }
        "time" => {
            decoded!(NaiveTime, "text");
            decoded!(String, "text");
        }
        "datetime" => {
            decoded!(NaiveDateTime, "text");
            decoded!(String, "text");
        }
        "timestamp" => {
            if let Ok(value) = row.try_get::<DateTime<Utc>, _>(index) {
                return cell("text", value.format("%Y-%m-%d %H:%M:%S").to_string());
            }
            decoded!(NaiveDateTime, "text");
            decoded!(String, "text");
        }
        "json" => {
            decoded!(Value, "json");
            decoded!(String, "text");
        }
        "tinyblob" | "blob" | "mediumblob" | "longblob" | "binary" | "varbinary" => {
            if let Ok(value) = row.try_get::<Vec<u8>, _>(index) {
                return cell("binary", hex(&value));
            }
        }
        _ => decoded!(String, "text"),
    }
    cell("text", format!("<unsupported {type_name} value>"))
}

pub fn decode_sqlite(row: &SqliteRow, index: usize) -> SqlCell {
    if row.try_get_raw(index).map_or(true, |raw| raw.is_null()) {
        return null_cell();
    }
    let type_name = row.columns()[index].type_info().name().to_ascii_lowercase();
    match type_name.as_str() {
        "boolean" | "bool" => row
            .try_get::<bool, _>(index)
            .map(|value| cell("boolean", value.to_string()))
            .unwrap_or_else(|_| {
                row.try_get::<i64, _>(index)
                    .map(|value| cell("boolean", if value != 0 { "true" } else { "false" }.to_string()))
                    .unwrap_or_else(|error| cell("text", format!("<decode error: {error}>")))
            }),
        "integer" | "int" => row
            .try_get::<i64, _>(index)
            .map(|value| cell("number", value.to_string()))
            .unwrap_or_else(|error| cell("text", format!("<decode error: {error}>"))),
        "real" | "float" => row
            .try_get::<f64, _>(index)
            .map(|value| cell("number", value.to_string()))
            .unwrap_or_else(|error| cell("text", format!("<decode error: {error}>"))),
        "blob" => row
            .try_get::<Vec<u8>, _>(index)
            .map(|value| cell("binary", hex(&value)))
            .unwrap_or_else(|error| cell("text", format!("<decode error: {error}>"))),
        _ => row
            .try_get::<String, _>(index)
            .map(|value| cell("text", value))
            .unwrap_or_else(|error| cell("text", format!("<decode error: {error}>"))),
    }
}
