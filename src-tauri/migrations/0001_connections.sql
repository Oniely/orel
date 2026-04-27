CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    ssl INTEGER NOT NULL DEFAULT 0,
    default_database TEXT NULL,
    color TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);