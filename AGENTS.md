# AGENTS.md

Project structure, stack, and conventions for AI coding agents working on this codebase. If you change the architecture, update this file in the same change.

---

## What this project is

Orel is a cross-platform desktop database GUI for **PostgreSQL**, **MySQL/MariaDB**, and **SQLite**, built with Tauri v2 — a Rust backend paired with a React frontend in the OS's native webview. Ships for macOS (Apple Silicon + Intel), Windows x64, and Linux x64 via signed GitHub Releases with an in-app updater.

---

## Stack

**Frontend** — React 19, TypeScript (strict), Vite 7, TanStack Router / Query v5 / Table v8, Zustand v5, HeroUI v3, Tailwind CSS v4, Monaco Editor, React Hook Form + Zod v4, react-hotkeys-hook, Phosphor + react-icons, Vitest + Testing Library + jsdom.

**Backend** — Tauri v2, sqlx 0.9 (Postgres + MySQL + SQLite, `runtime-tokio`, `tls-rustls`, `mysql-rsa`, `bigdecimal`, `chrono`, `uuid`, `json`), tokio, serde/serde_json, futures-util. Plugins: `updater`, `process`, `os`, `dialog`, `opener`. `testcontainers` for integration tests.

**App data** — Orel's own state lives in a SQLite database (`orel_spacecraft.db`) in the OS app-data dir, created and migrated on startup via `sqlx::migrate!("./migrations")`. `tauri-plugin-store` is not used.

---

## Project structure

```
├── src/                                # React frontend
│   ├── routes/                         # TanStack Router file-based routes
│   │   ├── __root.tsx                  # Shell: theme init, settings modal, update check, global hotkeys
│   │   ├── index.tsx                   # Connection manager — home screen
│   │   ├── dashboard.tsx               # Main workspace (redirects home if no focused connection)
│   │   └── test.tsx                    # Leftover Tauri scaffold — don't build on this
│   ├── components/
│   │   ├── ConnectionManager/          # ConnectionRow
│   │   ├── ConnectionModal.tsx         # Create/edit connection form (RHF + Zod)
│   │   ├── SettingsModal.tsx           # Appearance + Updates
│   │   ├── Dashboard/
│   │   │   ├── DashboardLayout.tsx     # Wires provider, hotkeys, event listeners
│   │   │   ├── DashboardWorkspace.tsx  # Picks table vs SQL workspace for the active tab
│   │   │   ├── Header/  Sidebar/  Tabs/
│   │   │   ├── DataGrid/               # Grid, cells, editor overlay, filter bar, footers, row menu
│   │   │   ├── RowInspector/           # Single-row detail/edit panel
│   │   │   ├── SqlEditor/              # Monaco editor, result grid, workspace shell
│   │   │   ├── Transactions/           # TransactionGuardDialog
│   │   │   └── shared/                 # constants, icons
│   │   └── icons/                      # Hand-rolled SVGs (e.g. SqliteIcon)
│   ├── stores/                         # connection, dashboard (scoped), write-queue, settings, theme
│   ├── hooks/                          # One hook per command group + dashboard/ subfolder
│   ├── lib/                            # themes, monacoTheme, typeColors, format, parseValue, error
│   ├── types/                          # connection, database, dashboard, editor, write-queue
│   ├── utils/parseConnectionUrl.ts     # Paste a connection URL into the form
│   ├── global.css                      # Fonts + fallback vars (JS theme system overrides these)
│   └── main.tsx                        # Entry: QueryClient + RouterProvider
│
└── src-tauri/
    ├── src/
    │   ├── main.rs                     # Thin wrapper calling orel_lib::run()
    │   ├── lib.rs                      # Plugins, native menu, SQLite setup, AppState, invoke_handler
    │   └── commands/
    │       ├── connection.rs           # AppState, DbPool, connect/disconnect/CRUD/database switching
    │       ├── query.rs                # list_tables, fetch_rows (pagination + filters)
    │       ├── editor.rs               # Editor sessions, statement splitting, transaction control
    │       ├── write_queue.rs          # generate_sql, apply_write_queue
    │       ├── sql_util.rs             # Dialect abstraction, type normalization, row-to-JSON builders
    │       └── test/*.test.rs          # Unit + Docker-gated integration tests
    ├── migrations/                     # sqlx migrations for Orel's own SQLite db
    ├── capabilities/ icons/
    └── tauri.conf.json                 # Bundle, updater endpoint + pubkey, window config
```

---

## Key conventions

### Tauri IPC

Everything goes through `invoke()` — no `fetch()`, no HTTP. Commands are keyed by **`connectionId`**, never a connection string: the backend owns the pools, the frontend only passes ids.

```ts
const result = await invoke<QueryResult>("fetch_rows", { connectionId, table, limit, offset, filters });
```

```rust
#[tauri::command]
pub async fn fetch_rows(
    connection_id: String,
    table: String,
    limit: i64,
    offset: i64,
    filters: Vec<FilterRow>,
    state: tauri::State<'_, AppState>,
) -> Result<QueryResult, String> { /* ... */ }
```

Rust structs crossing the bridge use `#[serde(rename_all = "camelCase")]`. TS interfaces in `src/types/` are hand-mirrored from them, not generated — keep both sides in sync.

Every new command must be listed in `lib.rs`'s `invoke_handler!`. Forgetting fails at runtime, not compile time.

### Backend state

`AppState` (`commands/connection.rs`) is the single managed state object:

```rust
pub struct AppState {
    pub db: SqlitePool,                                   // Orel's own app database
    pub pools: Mutex<HashMap<String, DbPool>>,            // live user pools, keyed by connection id
    pub configs: Mutex<HashMap<String, SavedConnection>>, // config per open connection
    pub editor_sessions: tokio::sync::Mutex<HashMap<String, EditorSession>>, // per-editor-tab connections
}
```

- `pools` and `configs` use `std::sync::Mutex` — **never hold that guard across an `await`**. Clone the pool out in a scoped block, drop the lock, then await. Existing commands all follow this shape.
- `editor_sessions` uses `tokio::sync::Mutex` because a session holds a connection across awaits.
- `DbPool` is an enum over `Postgres | MySql | Sqlite`. Handle all three arms or return a clear "unsupported" error.

### Dialect handling lives in `sql_util.rs`

Identifier quoting, type-name normalization, placeholder style, row-to-JSON `SELECT` construction — all of it belongs behind the `Dialect` enum. Don't scatter `match db_type` across command files.

Rows travel as one JSON string per row (`row_to_json` / `JSON_OBJECT` / `json_object`) so every column type arrives as text without per-type decode branches; blobs are hex-encoded rather than pushed through JSON.

Dynamic SQL must be wrapped in `sqlx::AssertSqlSafe` (a sqlx 0.9 requirement). Treat it as a promise you audited the string: quote identifiers through `sql_util`, bind values as parameters.

### SQL editor sessions

Each editor tab owns an `EditorSession` — a dedicated connection keyed by `editorId` — in either `autoCommit` mode or `manual` mode with `TransactionState` of `inactive | active | failed`.

MySQL rejects `BEGIN`/`COMMIT`/`ROLLBACK` through the prepared-statement protocol (error 1295), so those go through `raw_sql` (`COM_QUERY`). An integration test guards this — don't "simplify" it away.

Sessions must be discarded when their tab closes, the database switches, or the connection drops (`discard_sessions_for_connection`). The frontend blocks navigation with an open transaction via `TransactionGuardDialog` / `NavigationIntent` — route any new navigation path through `useDashboardCommands` so the guard still applies. Editor results are capped at `MAX_QUERY_RESULT_ROWS` (100).

### Write queue

Grid edits are **staged, not immediate**. `write-queue.store.ts` accumulates `PendingChange` values (`Update` / `Delete` / `Insert`) per table scope, keyed by `RowIdentity` (PK columns + values). Applying calls `apply_write_queue`, which returns `ApplyResult { applied, failed, not_attempted }` so the UI can report partial success; `generate_sql` renders the same queue as copyable SQL without executing. Rows without a usable primary key can't be identified — handle that explicitly rather than guessing.

### TanStack Query wraps all invoke() calls

Never call `invoke()` directly in a component — wrap it in a hook in `src/hooks/`:

```ts
export function useListTables(connectionId: string | null, database: string | null) {
  return useQuery({
    queryKey: databaseQueryKeys.tables(connectionId, database),
    queryFn: () => invoke<TableInfo[]>("list_tables", { connectionId: connectionId! }),
    enabled: !!connectionId,
  });
}
```

Build every key from `databaseQueryKeys` (`src/hooks/useTables.ts`) — invalidation after writes and database switches depends on the shared prefix shape.

### Routing

Routes live in `src/routes/`; the router plugin regenerates `src/routeTree.gen.ts` — never edit it by hand. `__root.tsx` is the persistent shell. `dashboard.tsx` guards in `beforeLoad` and redirects to `/` with no focused connection. Params and search params are fully typed — never cast with `as`.

### State management

TanStack Query for anything async, Zustand for synchronous UI state, React Hook Form for forms. Never use `useState` for state that outlives a component or is read elsewhere.

Two Zustand shapes are in play:
1. **Global singletons** (`create(...)`) — `connection`, `write-queue`, `settings`, `theme`
2. **Scoped store** (`createStore(...)` + context) — `dashboard.store.tsx`, via `useDashboardStore` / `useDashboardStoreApi`. Dashboard state is per-mounted-dashboard, not app-global.

Dashboard state is keyed by two composite strings — respect them:
- `databaseKey` = `${connectionId}::${database}` — scopes open tabs
- `scopeKey` — scopes filters, pagination, and the write queue to a table view

Use `useShallow` when selecting multiple fields from a store.

### Styling and theming

Prefer HeroUI components; use Tailwind utilities for layout and spacing.

Theming is JS-driven: `src/lib/themes.ts` defines 10 presets as `ThemeColors` token maps in **oklch**; `theme.store.ts` applies them as CSS variables on `<html>` plus a `dark`/`light` class and persists the choice to `localStorage`. `initTheme()` runs at module scope in `__root.tsx` before render to avoid a flash — keep it there. Monaco is themed separately in `src/lib/monacoTheme.ts`, which converts oklch to hex because Monaco can't parse oklch. `global.css` holds only fonts and fallback variables. A new theme must define every `ThemeColors` key — partial themes render broken.

HeroUI gotchas that have bitten this codebase:
- `text-default-300/400/500` do **not** exist — use `text-muted`
- Default `Button` uses `--button-fg: currentColor`, so the parent must set a text color

### Keyboard shortcuts

Registered with `react-hotkeys-hook` in `useDashboardHotkeys` and `__root.tsx`. Always use `mod+` rather than `ctrl+`/`meta+` so bindings work on macOS and Windows. Shared options live in `APP_HOTKEY_OPTIONS`.

`mod+t` new query tab · `mod+w` close tab · `mod+1`–`9` jump to tab · `ctrl+tab` / `ctrl+shift+tab` cycle · `alt+z` sidebar · `mod+r` refresh · `mod+s` apply write queue (or inspected row) · `mod+shift+s` copy SQL · `mod+f` filter bar · `mod+left` / `mod+right` page · `mod+,` settings.

### Native menu

Built in `lib.rs`. Menu items emit Tauri events the frontend listens for (`open-settings`, `refresh`) — emit an event rather than reaching into UI state from Rust. On Windows the menu bar is hidden by default and toggled with `Ctrl+Shift+M`.

### Rust conventions

Commands live in `src-tauri/src/commands/`, one file per domain. Always return `Result<T, String>` — never panic in a command. Pool connections; never open one per query. Never log connection strings, passwords, or row data. Section headers use the `// ── Name ─────` style.

---

## Testing

```bash
pnpm test                   # frontend (Vitest), pnpm test:watch to watch
cd src-tauri && cargo test              # Rust unit tests
cd src-tauri && cargo test -- --ignored # Docker-backed integration tests
```

Rust tests live in `src-tauri/src/commands/test/*.test.rs`, attached with:

```rust
#[cfg(test)]
#[path = "test/editor.test.rs"]
mod tests;
```

Integration tests spin up real Postgres/MySQL containers via `testcontainers` and are marked `#[ignore = "requires Docker"]` so plain `cargo test` stays fast. They catch driver-level regressions (MySQL error 1295, blob/JSON decode failures, type-name inconsistencies) that unit tests can't reach — add one whenever you touch transaction handling or value decoding.

---

## Releases

Pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`: it verifies the tag matches `package.json`, builds all four targets, publishes a GitHub Release, and uploads the signed `latest.json` the in-app updater reads.

Bump the version in **both** `package.json` and `src-tauri/Cargo.toml` (`tauri.conf.json` reads it from `package.json`). The workflow fails fast on a version mismatch or missing `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The updater pubkey and endpoint are in `tauri.conf.json` — changing the signing key breaks updates for every installed copy.

macOS builds are ad-hoc signed (`signingIdentity: "-"`) and not notarized; Windows builds are not code-signed. The resulting OS warnings are known, not bugs to chase.

---

## Do not do these things

- Do not use `fetch()` or axios — use `invoke()`
- Do not pass connection strings from the frontend — pass `connectionId`
- Do not open a DB connection per query — use the pooled `DbPool` in `AppState`
- Do not hold a `std::sync::Mutex` guard across an `await`
- Do not add a command without registering it in `lib.rs`
- Do not interpolate user values into SQL — bind parameters, quote identifiers via `sql_util`
- Do not scatter dialect `match` arms outside `sql_util.rs`
- Do not edit `src/routeTree.gen.ts`
- Do not use `any` in TypeScript
- Do not use SSR features — Tauri serves a static SPA
- Do not panic in Rust commands — always return `Result`
- Do not log or persist credentials beyond the existing `connections` table
- Do not bump the version in only one of `package.json` / `Cargo.toml`
- Do not use Electron — this project uses Tauri deliberately, for performance
