import { randomUUID } from "node:crypto";
import { quoteSchema } from "../../electron/services/knowledge/database/migrations";
import type { SqlConnection, SqlPool } from "../../electron/services/knowledge/database/ports";

/** Never accepts a schema name or clears an existing application's namespace. */
export async function withOwnedTestSchema<T>(
  pool: SqlPool,
  work: (schema: string, connection: SqlConnection) => Promise<T>,
): Promise<T> {
  const schema = `zhiyu_test_${randomUUID().replaceAll("-", "")}`;
  if (!/^zhiyu_test_[a-f0-9]{32}$/.test(schema)) throw new Error("测试 schema 名称无效");
  const quoted = quoteSchema(schema);
  const connection = await pool.connect();
  let created = false;
  let discard = false;
  let primaryError: unknown;
  let failed = false;
  try {
    await connection.query(`CREATE SCHEMA ${quoted}`);
    created = true;
    return await work(schema, connection);
  } catch (error) {
    failed = true;
    primaryError = error;
    throw error;
  } finally {
    try {
      if (created) {
        // A failing SQL statement can leave the callback's transaction aborted.
        await connection.query("ROLLBACK");
        await connection.query(`DROP SCHEMA ${quoted} CASCADE`);
      }
    } catch (error) {
      discard = true;
      if (failed) throw new AggregateError([primaryError, error], "测试及其 schema 清理均失败");
      throw error;
    } finally {
      connection.release(discard);
    }
  }
}
