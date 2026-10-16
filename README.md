# Orel

A cross-platform database GUI built with Tauri and React for PostgreSQL, MySQL, and SQLite.

## Getting Started

### 1. Prerequisites

- [Node.js](https://nodejs.org/) (v20+) & [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/tools/install)
- [Docker](https://www.docker.com/) & Docker Compose

### 2. Start Local Databases (Docker)

To make it easy to develop and debug against real databases immediately after cloning, Orel includes pre-configured PostgreSQL and MySQL Docker containers with sample relational data and schemas:

```bash
# Start PostgreSQL (5432) and MySQL (3306) in the background
docker compose up -d

# Check logs
docker compose logs -f

# Stop containers when done
docker compose down

# Reset data back to initial seed state
docker compose down -v && docker compose up -d
```

### 3. Local Database Connections

You can connect directly in Orel using either the form fields or by pasting the connection URL into Orel's **Add Connection** dialog:

| Database | Host | Port | Database Name | User | Password | Quick Connect URL |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **PostgreSQL** | `localhost` | `5432` | `orel_dev` | `postgres` | `postgres` | `postgres://postgres:postgres@localhost:5432/orel_dev` |
| **MySQL** | `localhost` | `3306` | `orel_dev` | `root` / `orel` | `root` / `orel_password` | `mysql://root:root@localhost:3306/orel_dev` |

Both databases are pre-populated with realistic e-commerce sample data (`users`, `categories`, `products`, `orders`, `order_items`, `activity_logs`) with foreign keys, indexes, JSON columns, and timestamps. Each container also provides a blank `test` database.

Port overrides and custom credentials can be configured by copying `.env.example` to `.env`.

### 4. Run Orel in Development

```bash
pnpm install
pnpm tauri dev
```

## Publishing a release

Releases are created only when a semantic version tag is pushed. The tag must match the `version` in `package.json`.

Before the first release, add the updater signing credentials to the GitHub repository as secrets named
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Keep an offline backup of both values; losing
them prevents existing installations from accepting future updates. Never commit the private key.

To publish a release:

```bash
# First update package.json and src-tauri/Cargo.toml to the new version, then commit it.
RELEASE_VERSION="$(node -p "require('./package.json').version")"
git tag "v${RELEASE_VERSION}"
git push origin main "v${RELEASE_VERSION}"
```

GitHub Actions builds macOS, Windows, and Linux packages, creates the GitHub Release, and publishes the signed
`latest.json` manifest used by the in-app updater.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
