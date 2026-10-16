import { createHash } from "node:crypto";
import { DomainError } from "../../../../src/lib/domain/validation";
import type { SqlPool } from "./ports";

export type Migration = Readonly<{ version: number; sql: string }>;

export function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

export function quoteSchema(schema: string): string {
  if (
    !/^[a-z][a-z0-9_]{0,62}$/.test(schema) ||
    schema.startsWith("pg_") ||
    schema === "information_schema"
  ) {
    throw new DomainError("INVALID_INPUT", "数据库 schema 名称无效");
  }
  return `"${schema}"`;
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DomainError("CANCELLED", "数据库操作已取消");
}

function vectorVersionSupported(version: string): boolean {
  const match = version.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
  return !!match && (Number(match[1]) > 0 || Number(match[2]) >= 8);
}

export async function applyMigrations(
  pool: SqlPool,
  migrations: readonly Migration[],
  options: { schema?: string; signal?: AbortSignal } = {},
): Promise<{ applied: number[] }> {
  const schema = options.schema ?? "public";
  const quoted = quoteSchema(schema);
  const known = new Map<number, { sql: string; checksum: string }>();
  let previous = 0;
  for (const migration of migrations) {
    if (
      !Number.isSafeInteger(migration.version) ||
      migration.version !== previous + 1 ||
      !migration.sql.trim()
    ) {
      throw new DomainError("SCHEMA_MISMATCH", "迁移版本必须从 1 连续递增且 SQL 非空");
    }
    previous = migration.version;
    known.set(migration.version, {
      sql: migration.sql,
      checksum: migrationChecksum(migration.sql),
    });
  }
  checkCancelled(options.signal);
  const connection = await pool.connect().catch(() => {
    throw new DomainError("DATABASE_UNAVAILABLE", "无法连接数据库，请检查连接设置");
  });
  let transactionStarted = false;
  let discard = false;
  try {
    checkCancelled(options.signal);
    await connection.query("BEGIN");
    transactionStarted = true;
    await connection.query(
      "SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true)",
      ["5000"],
    );
    await connection.query("SELECT set_config('search_path', $1, true)", [
      `${quoted}, pg_catalog, public`,
    ]);
    const target = await connection.query<{ schema: string }>("SELECT current_schema() AS schema");
    if (target.rows.length !== 1 || target.rows[0].schema !== schema) {
      throw new DomainError("SCHEMA_MISMATCH", "目标数据库 schema 不存在或不可访问");
    }
    const server = await connection.query<{ version: number }>(
      "SELECT current_setting('server_version_num')::integer AS version",
    );
    if (server.rows.length !== 1 || server.rows[0].version < 170000) {
      throw new DomainError("SCHEMA_MISMATCH", "需要 PostgreSQL 17 或更新版本");
    }
    const extensions = await connection.query<{ name: string; version: string; schema: string }>(
      "SELECT e.extname AS name, e.extversion AS version, n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname IN ('vector', 'pg_trgm')",
    );
    const vector = extensions.rows.find((row) => row.name === "vector");
    if (
      !vector ||
      vector.schema !== "public" ||
      !vectorVersionSupported(vector.version) ||
      !extensions.rows.some((row) => row.name === "pg_trgm" && row.schema === "public")
    ) {
      throw new DomainError("SCHEMA_MISMATCH", "请在 public schema 安装 pgvector >=0.8 和 pg_trgm");
    }
    await connection.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `zhiyu:migrations:${schema}`,
    ]);
    await connection.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY CHECK (version > 0), checksum text NOT NULL CHECK (length(checksum) = 64), applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const existing = await connection.query<{ version: number; checksum: string }>(
      "SELECT version, checksum FROM schema_migrations ORDER BY version",
    );
    let appliedPrefix = 0;
    for (const row of existing.rows) {
      if (row.version !== appliedPrefix + 1 || known.get(row.version)?.checksum !== row.checksum) {
        throw new DomainError("SCHEMA_MISMATCH", "数据库迁移记录与应用不一致，请检查版本与备份");
      }
      appliedPrefix = row.version;
    }
    const applied: number[] = [];
    for (const [version, migration] of known) {
      checkCancelled(options.signal);
      if (version <= appliedPrefix) continue;
      await connection.query(migration.sql);
      await connection.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [
        version,
        migration.checksum,
      ]);
      applied.push(version);
    }
    checkCancelled(options.signal);
    await connection.query("COMMIT");
    transactionStarted = false;
    return { applied };
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.query("ROLLBACK");
      } catch {
        discard = true;
      }
    }
    if (error instanceof DomainError) throw error;
    throw new DomainError("DATABASE_UNAVAILABLE", "数据库迁移失败，请核对迁移记录与数据库状态");
  } finally {
    connection.release(discard);
  }
}
