import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import {
  applyMigrations,
  quoteSchema,
} from "../../electron/services/knowledge/database/migrations";
import type {
  SqlPool,
  SqlConnection,
  SqlParameter,
} from "../../electron/services/knowledge/database/ports";
import { withOwnedTestSchema } from "./test-schema";

export async function testMigrations() {
  return Promise.all(
    ["001_knowledge.sql", "002_search_indexes.sql", "003_embedding_cache.sql"].map(
      async (file, index) => ({
        version: index + 1,
        sql: await readFile(resolve("db/migrations", file), "utf8"),
      }),
    ),
  );
}
export async function withTestDatabase<T>(
  work: (pool: SqlPool, schema: string) => Promise<T>,
): Promise<T> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("未执行：需要显式的专用 TEST_DATABASE_URL");
  const raw = new Pool({
    connectionString: url,
    max: 6,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  });
  const adapt = (schema?: string): SqlPool => ({
    async connect(): Promise<SqlConnection> {
      const client = await raw.connect();
      try {
        if (schema) await client.query(`SET search_path TO ${quoteSchema(schema)}, public`);
      } catch (error) {
        client.release(true);
        throw error;
      }
      return {
        async query<Row extends object>(sql: string, values: readonly SqlParameter[] = []) {
          const result = await client.query<Row>(sql, [...values]);
          return { rows: result.rows, rowCount: result.rowCount };
        },
        release: (destroy = false) => client.release(destroy),
      };
    },
  });
  try {
    return await withOwnedTestSchema(adapt(), async (schema) => {
      const scoped = adapt(schema);
      await applyMigrations(scoped, await testMigrations(), { schema });
      return work(scoped, schema);
    });
  } finally {
    await raw.end();
  }
}
