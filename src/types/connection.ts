import { z } from "zod";

// What the user fills in to create a connection
export const connectionSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().min(1, "Connection name is required"),
    type: z.enum(["postgres", "mysql", "sqlite"]),
    host: z.string().min(1, "Host / file path is required"),
    port: z.coerce.number().int().min(0).max(65535),
    // Optional — if omitted we connect to the server's default DB
    // (postgres for PG, first available for MySQL)
    defaultDatabase: z.string().optional(),
    username: z.string(),
    password: z.string(),
    ssl: z.boolean().default(false),
    color: z.string().optional(), // for visual identification in the UI later
  })
  .superRefine((data, ctx) => {
    if (data.type !== "sqlite" && (!data.username || data.username.length < 1)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Username is required",
        path: ["username"],
      });
    }
  });

export type ConnectionFormData = z.infer<typeof connectionSchema>;
export type DbType = ConnectionFormData["type"];

// A connection as saved to db — includes the id and timestamps
export interface SavedConnection extends ConnectionFormData {
  id: string;
  createdAt: string;
  updatedAt: string;
}

// Runtime state — what we track once a connection is active in the app
export interface ActiveConnection {
  config: SavedConnection;
  status: "connecting" | "connected" | "error" | "disconnected";
  error?: string;
  // All databases available on this server — populated after connecting
  databases: string[];
  // Which database the user is currently looking at within this connection
  activeDatabase: string | null;
}
