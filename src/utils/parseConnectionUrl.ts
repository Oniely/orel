import type { ConnectionFormData } from "../types/connection";

export function parseConnectionUrl(url: string): Partial<ConnectionFormData> {
  try {
    const parsed = new URL(url.trim());

    const protocol = parsed.protocol.replace(":", "");
    const type = protocol === "mysql" || protocol === "mariadb" ? "mysql" : "postgres";

    const host = parsed.hostname;
    const port = parsed.port ? parseInt(parsed.port, 10) : type === "postgres" ? 5432 : 3306;

    const username = parsed.username ? decodeURIComponent(parsed.username) : "";

    const password = parsed.password ? decodeURIComponent(parsed.password) : "";

    // pathname is "/dbname" — strip the leading slash
    const defaultDatabase = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.slice(1) : undefined;

    // detect ssl from query params e.g. ?sslmode=require
    const sslMode = parsed.searchParams.get("sslmode");
    const ssl = sslMode === "require" || sslMode === "verify-full" || sslMode === "verify-ca";

    return { type, host, port, username, password, defaultDatabase, ssl };
  } catch {
    throw new Error("Invalid connection URL. Expected format: postgres://user:password@host:5432/dbname");
  }
}
