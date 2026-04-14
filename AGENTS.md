# AGENTS.md

This file describes the project structure, stack, and conventions for AI coding agents (Claude, Cursor, Copilot, etc.) working on this codebase.

---

## What this project is

A cross-platform desktop database GUI application targeting **PostgreSQL** and **MySQL/MariaDB**. Built with Tauri v2 — a Rust backend paired with a React frontend running in the OS's native webview. The goal is a fast, modern alternative to tools like DBeaver and TablePlus.

Runs on **macOS** and **Windows**.

---

## Stack

### Frontend (TypeScript + React)

- **Vite** — dev server and bundler
- **React 19** — UI framework (SPA only, no SSR)
- **TanStack Router** — type-safe file-based routing
- **TanStack Query** — async state and caching for all Tauri `invoke()` calls
- **TanStack Table** — headless virtualized results grid
- **Zustand** — lightweight client state (active connection, open tabs, theme)
- **HeroUI v3** — React component library (built on Tailwind + React Aria)
- **Tailwind CSS v4** — utility-first styling
- **Monaco Editor** (`@monaco-editor/react`) — SQL query editor
- **React Hook Form + Zod** — form state and validation
- **Framer Motion** — animations (via HeroUI)

### Backend (Rust)

- **Tauri v2** — desktop framework, IPC bridge, native APIs
- **sqlx** — async database driver (Postgres + MySQL)
- **tokio** — async runtime
- **serde / serde_json** — serialization between Rust and frontend
- **tauri-plugin-store** — persisting connection configs

---

## Project structure

```
├── src/                          # React frontend
│   ├── routes/                   # TanStack Router file-based routes
│   │   ├── __root.tsx            # Root layout (sidebar + main area)
│   │   ├── index.tsx             # Connection manager — default home screen
│   │   ├── editor.$connectionId.tsx   # Query editor for a given connection
│   │   └── settings.tsx          # App settings
│   ├── components/               # Shared React components
│   ├── stores/                   # Zustand stores
│   │   ├── connection.store.ts   # Active DB connection state
│   │   └── tabs.store.ts         # Open editor tabs state
│   ├── hooks/                    # TanStack Query hooks wrapping invoke()
│   │   ├── useConnections.ts
│   │   ├── useSchema.ts
│   │   └── useQuery.ts
│   └── main.tsx                  # App entry point
│
└── src-tauri/                    # Rust backend
    ├── src/
    │   ├── main.rs               # Tauri app entry point
    │   ├── commands/             # All #[tauri::command] functions
    │   │   ├── connection.rs     # connect, disconnect, test_connection
    │   │   ├── query.rs          # run_query, stream_query
    │   │   └── schema.rs         # get_databases, get_tables, get_columns
    │   └── db/                   # DB driver abstraction layer
    │       ├── mod.rs
    │       ├── postgres.rs
    │       └── mysql.rs
    └── Cargo.toml
```

---

## Key conventions

### Tauri IPC bridge

All communication between frontend and backend goes through Tauri commands using `invoke()`. Never use `fetch()` or any HTTP — everything is local IPC.

```ts
// Frontend: always use invoke() from @tauri-apps/api/core
import { invoke } from "@tauri-apps/api/core";

const result = await invoke<QueryResult>("run_query", {
  connectionString: "postgres://...",
  sql: "SELECT 1",
});
```

```rust
// Backend: all commands are async and return Result<T, String>
// The String error becomes a thrown exception in React
#[tauri::command]
pub async fn run_query(
    connection_string: String,
    sql: String,
) -> Result<serde_json::Value, String> {
    todo!()
}
```

### TanStack Query wraps all invoke() calls

Never call `invoke()` directly in components. Always wrap in a custom hook using `useQuery` or `useMutation`:

```ts
// hooks/useRunQuery.ts
export function useRunQuery(connectionString: string, sql: string) {
  return useQuery({
    queryKey: ["query", connectionString, sql],
    queryFn: () => invoke<QueryResult>("run_query", { connectionString, sql }),
    enabled: !!sql && !!connectionString,
  });
}
```

### Routing conventions (TanStack Router)

- Routes live in `src/routes/`
- File name = route path: `editor.$connectionId.tsx` → `/editor/:connectionId`
- Route params and search params are fully typed — never cast with `as`
- `__root.tsx` contains the persistent shell layout (sidebar + main area)

### State management split

- **TanStack Query** — anything async (DB queries, schema fetching, connection testing)
- **Zustand** — synchronous UI state (which connection is active, which tabs are open, dark/light mode)
- **React Hook Form** — form state (connection manager form, query parameters)
- Never use `useState` for global state — use the appropriate store

### Styling conventions

- Use **HeroUI** components first — `Button`, `Input`, `Modal`, `Select`, `Tabs`, `Tooltip`
- Use **Tailwind** utility classes for layout and spacing
- Dark mode is class-based (`dark` on `<html>`) — HeroUI handles this automatically
- For components HeroUI doesn't have (context menu, tree view), use headless primitives like `@radix-ui/react-context-menu`

### Rust conventions

- All Tauri commands live in `src-tauri/src/commands/`
- Each command file maps to a domain: `connection.rs`, `query.rs`, `schema.rs`
- Always return `Result<T, String>` — never panic in a command
- DB connections should be pooled using `sqlx::Pool` — do not open a new connection per query
- Connection strings are never logged

### TypeScript conventions

- Strict mode enabled — no `any`, no non-null assertions without comment
- All Tauri command return types have a matching TypeScript interface in `src/types/`
- Zod schemas are the source of truth for form validation and connection config shapes

---

## Rust — key things to know for agents

If you are new to Rust, these patterns come up constantly in this codebase:

**Async commands** — all Tauri commands are `async fn` and need `tokio`:

```rust
#[tauri::command]
pub async fn my_command(arg: String) -> Result<String, String> {
    Ok(format!("got: {}", arg))
}
```

**Error handling** — use `.map_err(|e| e.to_string())` to convert errors to the String type that Tauri sends to the frontend:

```rust
let pool = PgPool::connect(&connection_string)
    .await
    .map_err(|e| e.to_string())?;
```

**Registering commands** — every new command must be added to `main.rs`:

```rust
tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
        commands::connection::connect,
        commands::query::run_query,
        commands::schema::get_tables,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

---

## What to build — feature roadmap

### Phase 1 — foundation (build this first)

- [ ] Connection manager — save/load/test Postgres and MySQL connections
- [ ] Query execution — run SQL, return results as JSON
- [ ] Results grid — virtualized table using TanStack Table
- [ ] SQL editor — Monaco with SQL syntax highlighting
- [ ] Schema browser — list databases → tables → columns via `information_schema`
- [ ] Secure storage — encrypt connection strings using OS keychain via `tauri-plugin-store`

### Phase 2 — polish

- [ ] Smart autocomplete — Monaco completions from live schema
- [ ] Multi-tab editor — multiple independent query tabs
- [ ] Query history — persist and search past queries
- [ ] Export results — CSV and JSON export
- [ ] Table preview — click table in schema tree to preview first 100 rows
- [ ] Dark mode toggle

### Phase 3 — power features

- [ ] ERD viewer — visual entity-relationship diagram from live schema
- [ ] Inline cell editing — edit results grid cells, write back to DB
- [ ] Result streaming — stream large result sets progressively
- [ ] SSH tunnels — connect via SSH tunnel
- [ ] Saved queries — bookmarkable query snippet library
- [ ] EXPLAIN visualizer — visual query plan from EXPLAIN ANALYZE

---

## Do not do these things

- Do not use `fetch()` or axios — use `invoke()` for everything
- Do not open a new DB connection per query — use a connection pool
- Do not store connection strings in plaintext — use `tauri-plugin-store` with encryption
- Do not use `any` in TypeScript
- Do not use SSR features — Tauri uses a static SPA only
- Do not panic in Rust commands — always return `Result`
- Do not use `localStorage` or `sessionStorage` — use Tauri's store plugin
- Do not use Electron — this project explicitly uses Tauri for performance
