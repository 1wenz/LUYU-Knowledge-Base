import { Pool } from "pg";
import {
  databaseSettingsSchema,
  type PublicSettings,
  type SafeLogger,
} from "../../../../src/lib/contracts";
import { DomainError } from "../../../../src/lib/domain/validation";
import { quoteSchema } from "./migrations";
import { databaseError } from "./transactions";
import type { SqlPool, SqlConnection, SqlParameter } from "./ports";

export type ManagedSqlPool = SqlPool & { close(): Promise<void> };

export function createPostgresPool(
  settings: PublicSettings["database"],
  password: string | null,
  logger: SafeLogger,
  schema = "public",
): ManagedSqlPool {
  const validated = databaseSettingsSchema.safeParse(settings);
  if (!validated.success) throw new DomainError("INVALID_INPUT", "数据库设置无效", "database");
  const quoted = quoteSchema(schema);
  const pool = new Pool({
    host: validated.data.host,
    port: validated.data.port,
    user: validated.data.user,
    database: validated.data.database,
    // A function also prevents node-postgres from substituting PGPASSWORD for an intentional empty password.
    password: () => password ?? "",
    ssl: validated.data.sslMode === "verify-full" ? { rejectUnauthorized: true } : false,
    max: 6,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 5_000,
    query_timeout: 6_000,
    application_name: "Zhiyu",
    options: `-c search_path=${quoted},public`,
  });
  pool.on("error", () => logger.error("database.idle-error", { code: "DATABASE_UNAVAILABLE" }));
  let closed = false;
  return {
    async connect(): Promise<SqlConnection> {
      if (closed) throw new DomainError("DATABASE_UNAVAILABLE", "数据库连接池已关闭");
      try {
        const client = await pool.connect();
        return {
          async query<Row extends object>(text: string, values: readonly SqlParameter[] = []) {
            const result = await client.query<Row>(text, [...values]);
            return { rows: result.rows, rowCount: result.rowCount };
          },
          release: (destroy = false) => client.release(destroy),
        };
      } catch (error) {
        throw databaseError(error);
      }
    },
    async close() {
      if (!closed) {
        closed = true;
        await pool.end();
      }
    },
  };
}
